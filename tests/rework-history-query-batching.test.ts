import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2WorkspaceResponseRepository } from "../src/server/db/v2-workspace-response";
import { createReportsService } from "../src/server/modules/reports/service";
import { createReworkCaseService } from "../src/server/modules/rework/case-context";
import { createReworkStateService } from "../src/server/modules/rework/state";
import { countD1Calls } from "./helpers/d1-call-count";
import { reportFixture } from "./helpers/report-fixture";

const bodySql =
  "SELECT encrypted_payload FROM v2_messages WHERE id=? AND workspace_id=? AND revision=?";
type Fixture = Awaited<ReturnType<typeof historyFixture>>;
type CipherRow = { encrypted_payload: string };

async function historyFixture(count: number) {
  const f = await reportFixture();
  try {
    const context = createReworkCaseService(f.core, { clock: () => f.actor.now });
    await context.update(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: f.rev(),
      casePurpose: "prepare_claim",
      subjectContext: "individual",
      procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
    });
    const messages: {
      id: string;
      jobId: string;
      operationId: string;
      publicationRevision: number;
      intent: "add_material" | "prepare_report" | null;
    }[] = [];
    const jobs = createV2JobsRepository(f.core);
    for (let index = 0; index < count; index++) {
      const jobId = crypto.randomUUID(),
        operationId = crypto.randomUUID(),
        id = crypto.randomUUID();
      const guard = () => ({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() });
      expect(
        await jobs.admitWorkspace(
          guard(),
          { operationId, key: crypto.randomUUID(), requestHash: "d".repeat(64) },
          jobId,
          "chat_response",
          {
            id: crypto.randomUUID(),
            request: {
              expectedRevision: f.rev(),
              text: "합성 기록을 확인해 주세요.",
              selectedFileIds: [],
            },
          },
        ),
      ).toBe(true);
      const admissionRevision = f.rev();
      const acquired = await jobs.acquire(
        f.actor,
        jobId,
        crypto.randomUUID(),
        new Date(Date.parse(f.actor.now) + 240000).toISOString(),
      );
      if (!acquired) throw new Error("Missing synthetic lease");
      const intent = index % 3 === 0 ? "add_material" : index % 3 === 1 ? "prepare_report" : null;
      expect(
        await createV2WorkspaceResponseRepository(f.core).commit(guard(), acquired.lease, {
          message: {
            schemaVersion: "2",
            id,
            operationId,
            workspaceRevision: admissionRevision,
            createdAt: f.actor.now,
            role: "assistant",
            safety: "validated",
            text: "합성 응답입니다.",
            references: [],
            citations: [],
            warnings: [],
          },
          facts: [],
          parties: [],
          actions: [],
          timeline: [],
          ...(intent ? { conversationIntent: intent } : {}),
        }),
      ).toBe(true);
      messages.push({ id, jobId, operationId, publicationRevision: admissionRevision + 1, intent });
    }
    return { ...f, context, messages };
  } catch (error) {
    f.db.close();
    throw error;
  }
}

/** The sequential adapter executes the same immutable body SELECTs one by one.
 * It is a test-only baseline for the former .first() round trips, not a runtime mode. */
function measured(
  f: Fixture,
  options: {
    sequential?: boolean;
    cipher?: Fixture["core"]["cipher"];
    beforeBody?: () => Promise<void> | void;
    afterBody?: (
      results: D1Result<CipherRow>[],
      group: number,
    ) => Promise<D1Result<CipherRow>[]> | D1Result<CipherRow>[];
  } = {},
) {
  const meter = countD1Calls(f.db.binding);
  const sources = new WeakMap<D1PreparedStatement, { source: D1PreparedStatement; sql: string }>();
  const bodyGroups: number[] = [];
  const wrap = (source: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const wrapped = new Proxy(source, {
      get(target, key) {
        if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values), sql);
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    sources.set(wrapped, { source, sql });
    return wrapped;
  };
  const binding = {
    ...meter.binding,
    prepare: (sql: string) => wrap(meter.binding.prepare(sql), sql),
    async batch<T>(statements: D1PreparedStatement[]) {
      const inputs = statements.map((statement) => {
        const input = sources.get(statement);
        if (!input) throw new Error("Missing measured statement");
        return input;
      });
      const bodies = inputs.some((input) => input.sql === bodySql);
      if (bodies) {
        expect(inputs.every((input) => input.sql === bodySql)).toBe(true);
        bodyGroups.push(inputs.length);
        await options.beforeBody?.();
      }
      let results: D1Result<T>[];
      if (bodies && options.sequential) {
        results = [];
        for (const input of inputs) results.push(await input.source.all<T>());
      } else results = await meter.binding.batch<T>(inputs.map((input) => input.source));
      if (bodies && options.afterBody)
        results = (await options.afterBody(
          results as D1Result<CipherRow>[],
          bodyGroups.length,
        )) as D1Result<T>[];
      return results;
    },
  } as D1Database;
  const core = createV2Core(binding, options.cipher ?? f.core.cipher);
  const service = createReworkStateService(core, {
    clock: () => f.actor.now,
    peekReport: (ownerId, id) => createReportsService(core, f.deps).peek(ownerId, id),
  });
  return { service, meter, bodyGroups };
}

function storedCounts(f: Fixture) {
  return ["v2_operations", "v2_jobs", "v2_reports"].map((table) =>
    f.db.sqlite.query(`SELECT count(*) count FROM ${table}`).get(),
  );
}

describe("bounded rework history body reads", () => {
  for (const count of [0, 1, 4, 5, 100])
    test(`${count} completed messages preserve the full projection and reduce only body round trips`, async () => {
      const f = await historyFixture(count);
      try {
        const before = storedCounts(f);
        const sequential = measured(f, { sequential: true }),
          batched = measured(f);
        const old = await sequential.service.getProgress(f.actor.ownerId, f.workspaceId);
        const next = await batched.service.getProgress(f.actor.ownerId, f.workspaceId);
        expect(next).toEqual(old);
        const expected = [...f.messages]
          .sort((left, right) => (left.id < right.id ? 1 : -1))
          .flatMap((message) =>
            message.intent
              ? [
                  {
                    messageId: message.id,
                    requestId: `intent-${message.id}`,
                    intent: message.intent,
                    workspaceRevision: message.publicationRevision,
                  },
                ]
              : [],
          );
        expect(next.state.intents).toEqual(expected);
        expect(batched.bodyGroups.length).toBe(Math.ceil(count / 4));
        expect(batched.bodyGroups.every((size) => size >= 1 && size <= 4)).toBe(true);
        expect(batched.bodyGroups.reduce((sum, size) => sum + size, 0)).toBe(count);
        expect(sequential.meter.work.calls - batched.meter.work.calls).toBe(
          count - Math.ceil(count / 4),
        );
        expect(batched.meter.work.statements).toBe(sequential.meter.work.statements);
        expect(storedCounts(f)).toEqual(before);
        console.info(
          JSON.stringify({
            environment: "local synthetic",
            completedMessages: count,
            sequentialCalls: sequential.meter.work.calls,
            batchedCalls: batched.meter.work.calls,
            sqlStatements: batched.meter.work.statements,
            bodyReadCallsBefore: count,
            bodyReadCallsAfter: batched.bodyGroups.length,
            maximumBodyBatch: Math.max(0, ...batched.bodyGroups),
          }),
        );
      } finally {
        f.db.close();
      }
    }, 20000);

  test("a foreign owner and a failed completion cannot launch body reads", async () => {
    const f = await historyFixture(1);
    try {
      const foreign = measured(f);
      await expect(
        foreign.service.getProgress(crypto.randomUUID(), f.workspaceId),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(foreign.bodyGroups).toEqual([]);
      f.db.sqlite
        .query("UPDATE v2_jobs SET status='failed',failure_code='MODEL_UNAVAILABLE' WHERE id=?")
        .run(f.messages[0]?.jobId ?? "");
      const failed = measured(f);
      expect(
        (await failed.service.getProgress(f.actor.ownerId, f.workspaceId)).state.intents,
      ).toEqual([]);
      expect(failed.bodyGroups).toEqual([]);
    } finally {
      f.db.close();
    }
  });

  for (const target of ["workspace", "account"] as const)
    test(`a ${target} tombstone during the body batch discards the projection`, async () => {
      const f = await historyFixture(1);
      try {
        const read = measured(f, {
          afterBody: (results) => {
            f.db.sqlite
              .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES(?,?,?)")
              .run(target, target === "workspace" ? f.workspaceId : f.actor.ownerId, f.actor.now);
            return results;
          },
        });
        await expect(
          read.service.getProgress(f.actor.ownerId, f.workspaceId),
        ).rejects.toMatchObject({ code: "STALE_REVISION" });
      } finally {
        f.db.close();
      }
    });

  for (const target of ["workspace", "account"] as const)
    test(`a ${target} tombstone after awaited message decryption cannot escape the final fence`, async () => {
      const f = await historyFixture(1);
      try {
        let bodiesStarted = false;
        let revoked = false;
        const cipher: Fixture["core"]["cipher"] = {
          ...f.core.cipher,
          async decrypt(envelope, context) {
            const plaintext = await f.core.cipher.decrypt(envelope, context);
            if (bodiesStarted && context.table === "v2_messages" && !revoked) {
              revoked = true;
              f.db.sqlite
                .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES(?,?,?)")
                .run(target, target === "workspace" ? f.workspaceId : f.actor.ownerId, f.actor.now);
            }
            return plaintext;
          },
        };
        const read = measured(f, {
          cipher,
          afterBody: (results) => {
            bodiesStarted = true;
            return results;
          },
        });
        await expect(
          read.service.getProgress(f.actor.ownerId, f.workspaceId),
        ).rejects.toMatchObject({ code: "STALE_REVISION" });
        expect(revoked).toBe(true);
      } finally {
        f.db.close();
      }
    });

  test("a real context publication during a body batch rejects mixed revisions", async () => {
    const f = await historyFixture(1);
    try {
      const read = measured(f, {
        afterBody: async (results) => {
          await f.context.update(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
            expectedRevision: f.rev(),
            casePurpose: "respond_to_claim",
            subjectContext: "individual",
            procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
          });
          return results;
        },
      });
      await expect(read.service.getProgress(f.actor.ownerId, f.workspaceId)).rejects.toMatchObject({
        code: "STALE_REVISION",
      });
    } finally {
      f.db.close();
    }
  });

  test("a deleted message after header selection is a stale read", async () => {
    const f = await historyFixture(1);
    try {
      const read = measured(f, {
        beforeBody: () => {
          f.db.sqlite.query("DELETE FROM v2_messages WHERE id=?").run(f.messages[0]?.id ?? "");
        },
      });
      await expect(read.service.getProgress(f.actor.ownerId, f.workspaceId)).rejects.toMatchObject({
        code: "STALE_REVISION",
      });
    } finally {
      f.db.close();
    }
  });

  for (const failure of [
    "throw",
    "missing_result",
    "extra_result",
    "unsuccessful",
    "missing_rows",
    "extra_row",
  ] as const)
    test(`an invalid second body batch (${failure}) cannot return a partial successful history`, async () => {
      const f = await historyFixture(5);
      try {
        const read = measured(f, {
          afterBody: (results, group) => {
            if (group !== 2) return results;
            const first = results[0];
            if (!first) throw new Error("Missing measured body result");
            if (failure === "throw") throw new Error("Synthetic body batch unavailable");
            if (failure === "missing_result") return [];
            if (failure === "extra_result") return [...results, first];
            if (failure === "unsuccessful")
              return [{ ...first, success: false }] as unknown as D1Result<CipherRow>[];
            if (failure === "missing_rows")
              return [{ ...first, results: undefined }] as unknown as D1Result<CipherRow>[];
            return [{ ...first, results: [...first.results, ...first.results] }];
          },
        });
        await expect(read.service.getProgress(f.actor.ownerId, f.workspaceId)).rejects.toThrow();
        expect(read.bodyGroups).toEqual([4, 1]);
      } finally {
        f.db.close();
      }
    });

  for (const corruption of ["ciphertext", "id", "operationId", "workspaceRevision"] as const)
    test(`a ${corruption} mismatch retains ciphertext and immutable intent checks`, async () => {
      const f = await historyFixture(1);
      try {
        const message = f.messages[0];
        if (!message) throw new Error("Missing synthetic message");
        const row = f.db.sqlite
          .query("SELECT revision,encrypted_payload FROM v2_messages WHERE id=?")
          .get(message.id) as { revision: number; encrypted_payload: string };
        let envelope = "synthetic-damaged-envelope";
        if (corruption !== "ciphertext") {
          const value = await f.core.decrypt(
            "v2_messages",
            message.id,
            f.actor.ownerId,
            row.revision,
            row.encrypted_payload,
            z.record(z.string(), z.unknown()),
          );
          value[corruption] =
            corruption === "workspaceRevision"
              ? message.publicationRevision + 10
              : "synthetic-mismatch";
          envelope = await f.core.encrypt(
            "v2_messages",
            message.id,
            f.actor.ownerId,
            row.revision,
            value,
          );
        }
        const read = measured(f, {
          afterBody: (results) =>
            results.map((result) => ({
              ...result,
              results: result.results.map(() => ({ encrypted_payload: envelope })),
            })),
        });
        await expect(read.service.getProgress(f.actor.ownerId, f.workspaceId)).rejects.toThrow();
      } finally {
        f.db.close();
      }
    });
});
