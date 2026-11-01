import { expect, test } from "bun:test";
import { createSummaryReconciliationService } from "../src/server/modules/intake/summary-reconciliation";
import {
  createSummaryReconciliationStorage,
  summaryReconciliationRecordSchema,
} from "../src/server/modules/workspace/summary-reconciliation-storage";
import { reconfirmationContext, reconfirmationSummary } from "./helpers/intake-reconfirmation";
import {
  nativeReconciliationFixture,
  nativeReconciliationPorts,
} from "./helpers/summary-reconciliation-storage";

function storedRequest() {
  const message = reconfirmationContext().latestMessage;
  if (!message) throw new Error("Missing synthetic issued message");
  return {
    format: "summary-reconciliation-v1",
    state: {
      contractVersion: "conversation-report-v1",
      workspaceRevision: 12,
      status: "pending",
      request: {
        id: message.id,
        input: {
          expectedRevision: 11,
          summaryRevision: 3,
          kind: "addition",
          explanation: message.text,
        },
        createdAt: message.createdAt,
      },
      proposal: null,
      currentJobId: "synthetic-reconciliation-job",
      failure: null,
      confirmedSummaryRevision: null,
      confirmedWorkspaceRevision: null,
    },
    baseSummary: reconfirmationSummary(),
    baseSummaryId: "synthetic-current-summary",
    sourceDigest: "a".repeat(64),
    requestMessage: message,
  };
}

test("private encrypted record binds explanation, issued message revision and exact summary", () => {
  const record = storedRequest();
  expect(summaryReconciliationRecordSchema.safeParse(record).success).toBe(true);
  for (const change of [
    { requestMessage: { ...record.requestMessage, id: "another-message" } },
    { requestMessage: { ...record.requestMessage, text: "임의로 바꾼 설명" } },
    { requestMessage: { ...record.requestMessage, workspaceRevision: 11 } },
    { baseSummary: { ...record.baseSummary, revision: 4 } },
    { baseSummary: null },
    { state: { ...record.state, status: "stale", currentJobId: null } },
  ])
    expect(summaryReconciliationRecordSchema.safeParse({ ...record, ...change }).success).toBe(
      false,
    );
});

async function fixture(confirmed = true) {
  const f = await nativeReconciliationFixture(confirmed);
  const harness = nativeReconciliationPorts(f);
  const storage = createSummaryReconciliationStorage(f.core, harness.ports);
  const service = createSummaryReconciliationService(storage);
  const original = await service.read(f.actor);
  const input = {
    expectedRevision: original.state.workspaceRevision,
    summaryRevision: original.summary.revision,
    kind: "addition" as const,
    explanation: "일부 금액을 돌려받았지만 정확한 금액은 아직 모르겠어요.",
  };
  const request = (key = crypto.randomUUID()) => service.request(f.actor, key, input);
  return { ...f, ...harness, storage, service, original, input, request, harness };
}

for (const confirmed of [false, true]) {
  test(`${confirmed ? "active" : "initial"} native admission/proposal/confirmation preserves canonical state until explicit atomic confirmation`, async () => {
    const f = await fixture(confirmed);
    try {
      const key = crypto.randomUUID();
      const pending = await f.request(key);
      expect(pending.status).toBe("pending");
      expect(await f.request(key)).toEqual(pending);
      expect(
        f.db.sqlite.query("SELECT count(*) n FROM v2_jobs WHERE kind='chat_response'").get(),
      ).toEqual({ n: 1 });
      const proposed = await f.service.execute(f.actor, pending.request?.id ?? "missing");
      expect(proposed.status).toBe("proposed");
      expect((await f.service.read(f.actor)).summary).toEqual(f.original.summary);
      expect((await f.service.read(f.actor)).state).toEqual(proposed);
      expect(f.harness.generateCalls).toBe(1);
      expect((await f.service.execute(f.actor, pending.request?.id ?? "missing")).status).toBe(
        "proposed",
      );
      expect(f.harness.generateCalls).toBe(1);
      expect(
        JSON.stringify(f.db.sqlite.query("SELECT encrypted_payload FROM v2_rework_parts").all()),
      ).not.toContain(f.input.explanation);
      const confirm = {
        expectedRevision: proposed.workspaceRevision,
        proposalId: proposed.proposal?.id,
        summaryRevision: f.original.summary.revision,
      };
      const confirmKey = crypto.randomUUID();
      const result = await f.service.confirm(f.actor, confirmKey, confirm);
      expect(result.status).toBe("confirmed");
      expect(await f.service.confirm(f.actor, confirmKey, confirm)).toEqual(result);
      const current = await f.service.read(f.actor);
      const after = proposed.proposal?.after;
      if (!after) throw new Error("Missing synthetic after snapshot");
      expect(current.summary).toEqual(after);
      expect(current.state).toEqual(result);
      expect(current.context.intake.status).toBe("confirmed");
      expect(current.context.intake.batches).toEqual(f.original.context.intake.batches);
      expect(
        f.db.sqlite
          .query("SELECT count(*) n FROM v2_summaries WHERE workspace_id=?")
          .get(f.actor.caseId),
      ).toEqual({ n: 2 });
      const history = await f.records.read(
        f.actor,
        f.actor.caseId,
        "reconciliation",
        f.actor.caseId,
        summaryReconciliationRecordSchema,
      );
      expect(history?.value.baseSummary).toBeNull();
      expect(history?.value.state.proposal?.before).toEqual(f.original.summary);
    } finally {
      f.db.close();
    }
  });
}

test("cancel while generating fences late publication; a new explicit request reuses no old candidate", async () => {
  const f = await fixture();
  try {
    const pending = await f.request();
    let cancelled: unknown;
    f.onGenerate(async () => {
      const current = await f.service.read(f.actor);
      cancelled = await f.service.cancel(f.actor, "synthetic-cancel-running", {
        expectedRevision: current.state.workspaceRevision,
        requestId: pending.request?.id,
      });
    });
    await expect(
      f.service.execute(f.actor, pending.request?.id ?? "missing"),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(cancelled).toMatchObject({ status: "cancelled" });
    expect((await f.service.read(f.actor)).summary).toEqual(f.original.summary);
    f.onGenerate(undefined);
    const current = await f.service.read(f.actor);
    const next = await f.service.request(f.actor, "synthetic-new-request", {
      ...f.input,
      expectedRevision: current.state.workspaceRevision,
    });
    expect(next.request?.id).not.toBe(pending.request?.id);
    expect((await f.service.execute(f.actor, next.request?.id ?? "missing")).status).toBe(
      "proposed",
    );
  } finally {
    f.db.close();
  }
});

test("a queued request can be cancelled and the cancellation receipt survives reconnect", async () => {
  const f = await fixture();
  try {
    const pending = await f.request();
    const input = { expectedRevision: pending.workspaceRevision, requestId: pending.request?.id };
    const cancelled = await f.service.cancel(f.actor, "synthetic-cancel-queued", input);
    const reconnect = createSummaryReconciliationService(
      createSummaryReconciliationStorage(f.core, f.ports),
    );
    expect(await reconnect.cancel(f.actor, "synthetic-cancel-queued", input)).toEqual(cancelled);
    expect((await reconnect.read(f.actor)).state.status).toBe("cancelled");
    expect(
      f.db.sqlite.query("SELECT status FROM v2_jobs WHERE kind='chat_response'").get(),
    ).toEqual({ status: "cancelled" });
    expect((await reconnect.read(f.actor)).summary).toEqual(f.original.summary);
  } finally {
    f.db.close();
  }
});

test("source changes make a proposal stale without rewriting immutable history or canonical summary", async () => {
  const f = await fixture();
  try {
    const pending = await f.request();
    const proposed = await f.service.execute(f.actor, pending.request?.id ?? "missing");
    f.changeSources();
    const read = await f.service.read(f.actor);
    expect(read.state.status).toBe("stale");
    expect(read.summary).toEqual(f.original.summary);
    await expect(
      f.service.confirm(f.actor, "synthetic-stale-confirm", {
        expectedRevision: read.state.workspaceRevision,
        proposalId: proposed.proposal?.id,
        summaryRevision: read.summary.revision,
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    const record = await f.records.read(
      f.actor,
      f.actor.caseId,
      "reconciliation",
      f.actor.caseId,
      summaryReconciliationRecordSchema,
    );
    expect(record?.value.state.status).toBe("proposed");
    expect(record?.value.state.proposal).toEqual(proposed.proposal);
  } finally {
    f.db.close();
  }
});

test("post-staging account revocation and peer revision fail the atomic confirm and preserve old summary", async () => {
  for (const change of ["consent", "revision"]) {
    const f = await fixture();
    try {
      const pending = await f.request();
      const proposed = await f.service.execute(f.actor, pending.request?.id ?? "missing");
      f.onConfirm(async () => {
        if (change === "consent")
          f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
        else
          f.db.sqlite
            .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
            .run(f.actor.caseId);
      });
      await expect(
        f.service.confirm(f.actor, "synthetic-confirm-raced", {
          expectedRevision: proposed.workspaceRevision,
          proposalId: proposed.proposal?.id,
          summaryRevision: f.original.summary.revision,
        }),
      ).rejects.toMatchObject({ code: "STALE_REVISION" });
      expect((await f.repository.readIntake(f.actor, f.actor.caseId))?.summary).toEqual(
        f.original.summary,
      );
      expect(
        (
          await f.records.read(
            f.actor,
            f.actor.caseId,
            "reconciliation",
            f.actor.caseId,
            summaryReconciliationRecordSchema,
          )
        )?.value.state.status,
      ).toBe("proposed");
    } finally {
      f.db.close();
    }
  }
});

test("failed independent audit stores a failure without replacing canonical facts or generating more questions", async () => {
  const f = await fixture();
  try {
    f.rejectAudit();
    const pending = await f.request();
    const failed = await f.service.execute(f.actor, pending.request?.id ?? "missing");
    expect(failed).toMatchObject({ status: "failed", failure: "POLICY_REJECTED", proposal: null });
    const read = await f.service.read(f.actor);
    expect(read.summary).toEqual(f.original.summary);
    expect(read.context.intake.batches).toEqual(f.original.context.intake.batches);
  } finally {
    f.db.close();
  }
});

test("wrong owner, deleted case and revoked consent cannot resume model work or write proposals", async () => {
  for (const boundary of ["owner", "consent", "delete"]) {
    const f = await fixture();
    try {
      const pending = await f.request();
      const actor = { ...f.actor };
      if (boundary === "owner") actor.ownerId = "another-owner";
      if (boundary === "consent")
        f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
      if (boundary === "delete")
        f.db.sqlite.query("DELETE FROM v2_workspaces WHERE id=?").run(f.actor.caseId);
      await expect(
        f.service.execute(actor, pending.request?.id ?? "missing"),
      ).rejects.toMatchObject({ code: boundary === "consent" ? "CONSENT_REQUIRED" : "NOT_FOUND" });
      expect(f.harness.generateCalls).toBe(0);
    } finally {
      f.db.close();
    }
  }
});

test("two concurrent executions acquire a single live lease and generate only one proposal", async () => {
  const f = await fixture();
  try {
    const pending = await f.request();
    const id = pending.request?.id ?? "missing";
    const results = await Promise.allSettled([
      f.service.execute(f.actor, id),
      f.service.execute(f.actor, id),
    ]);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    expect(f.harness.generateCalls).toBe(1);
    expect((await f.service.read(f.actor)).state.status).toBe("proposed");
    expect((await f.service.read(f.actor)).summary).toEqual(f.original.summary);
  } finally {
    f.db.close();
  }
});

test("record replacement during decryption is retried instead of exposing a false idle state", async () => {
  const f = await fixture();
  const decrypt = f.core.cipher.decrypt.bind(f.core.cipher);
  try {
    const pending = await f.request();
    const proposed = await f.service.execute(f.actor, pending.request?.id ?? "missing");
    const previous = await f.records.read(
      f.actor,
      f.actor.caseId,
      "reconciliation",
      f.actor.caseId,
      summaryReconciliationRecordSchema,
    );
    if (!previous) throw new Error("Missing native record");
    let raced = false;
    f.core.cipher.decrypt = async (envelope, context) => {
      const result = await decrypt(envelope, context);
      if (context.table === "v2_rework_parts" && !raced) {
        raced = true;
        await f.records.write(
          {
            ownerId: f.actor.ownerId,
            workspaceId: f.actor.caseId,
            expectedRevision: proposed.workspaceRevision,
            now: f.now,
          },
          {
            kind: "reconciliation",
            expectedVersion: previous.revision,
            value: previous.value,
            schema: summaryReconciliationRecordSchema,
          },
        );
      }
      return result;
    };
    const read = await f.service.read(f.actor);
    expect(raced).toBe(true);
    expect(read.state.status).toBe("proposed");
    expect(read.state.proposal).toEqual(proposed.proposal);
  } finally {
    f.core.cipher.decrypt = decrypt;
    f.db.close();
  }
});

test("repeated publication-head drift is bounded and returns stale rather than an idle/new request", async () => {
  const f = await fixture();
  try {
    const pending = await f.request();
    const proposed = await f.service.execute(f.actor, pending.request?.id ?? "missing");
    let writes = 0;
    f.onAuthorize(async () => {
      const previous = await f.records.read(
        f.actor,
        f.actor.caseId,
        "reconciliation",
        f.actor.caseId,
        summaryReconciliationRecordSchema,
      );
      if (!previous) throw new Error("Missing native record");
      await f.records.write(
        {
          ownerId: f.actor.ownerId,
          workspaceId: f.actor.caseId,
          expectedRevision: proposed.workspaceRevision,
          now: f.now,
        },
        {
          kind: "reconciliation",
          expectedVersion: previous.revision,
          value: previous.value,
          schema: summaryReconciliationRecordSchema,
        },
      );
      writes++;
    });
    await expect(f.service.read(f.actor)).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(writes).toBe(2);
  } finally {
    f.db.close();
  }
});

test("missing or altered issued-message text cannot authorize model generation", async () => {
  for (const altered of [false, true]) {
    const f = await fixture();
    try {
      const pending = await f.request();
      const original = f.ports.authorize;
      const service = createSummaryReconciliationService(
        createSummaryReconciliationStorage(f.core, {
          ...f.ports,
          authorize: async (a, options) => {
            const source = await original(a, options);
            return {
              ...source,
              context: {
                ...source.context,
                messages: altered
                  ? source.context.messages.map((m) => ({ ...m, text: "실제 요청과 다른 문장" }))
                  : [],
                latestMessage:
                  altered && source.context.latestMessage
                    ? { ...source.context.latestMessage, text: "실제 요청과 다른 문장" }
                    : null,
              },
            };
          },
        }),
      );
      await expect(
        service.execute(f.actor, pending.request?.id ?? "missing"),
      ).rejects.toMatchObject({ code: "STALE_REVISION" });
      expect(f.harness.generateCalls).toBe(0);
      expect((await f.service.read(f.actor)).summary).toEqual(f.original.summary);
    } finally {
      f.db.close();
    }
  }
});

test("existing model timestamp projection keeps statement authorization and the original issued timestamp", async () => {
  const f = await fixture();
  try {
    const pending = await f.request();
    const original = f.ports.authorize;
    const service = createSummaryReconciliationService(
      createSummaryReconciliationStorage(f.core, {
        ...f.ports,
        authorize: async (a, options) => {
          const source = await original(a, options);
          return {
            ...source,
            context: {
              ...source.context,
              messages: source.context.messages.map((m) => ({
                ...m,
                createdAt: "1970-01-01T00:00:00.000Z",
              })),
              latestMessage: source.context.latestMessage
                ? { ...source.context.latestMessage, createdAt: "1970-01-01T00:00:00.000Z" }
                : null,
            },
          };
        },
      }),
    );
    const result = await service.execute(f.actor, pending.request?.id ?? "missing");
    expect(result.status).toBe("proposed");
    const record = await f.records.read(
      f.actor,
      f.actor.caseId,
      "reconciliation",
      f.actor.caseId,
      summaryReconciliationRecordSchema,
    );
    expect(record?.value.requestMessage.createdAt).toBe(f.now);
    expect(record?.value.requestMessage.text).toBe(f.input.explanation);
  } finally {
    f.db.close();
  }
});

test("a sealed confirmation interrupted before commit can retry the same request without publishing twice", async () => {
  const f = await fixture();
  try {
    const pending = await f.request();
    const proposed = await f.service.execute(f.actor, pending.request?.id ?? "missing");
    const input = {
      expectedRevision: proposed.workspaceRevision,
      proposalId: proposed.proposal?.id,
      summaryRevision: f.original.summary.revision,
    };
    const key = crypto.randomUUID();
    f.onConfirm(async () => {
      throw new Error("Synthetic interrupted confirmation");
    });
    await expect(f.service.confirm(f.actor, key, input)).rejects.toThrow("Synthetic interrupted");
    expect((await f.service.read(f.actor)).summary).toEqual(f.original.summary);
    f.onConfirm(undefined);
    const confirmed = await f.service.confirm(f.actor, key, input);
    expect(confirmed.status).toBe("confirmed");
    expect(await f.service.confirm(f.actor, key, input)).toEqual(confirmed);
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_summaries WHERE workspace_id=?")
        .get(f.actor.caseId),
    ).toEqual({ n: 2 });
  } finally {
    f.db.close();
  }
});

test("lost confirmation acknowledgement is recovered from a durable receipt before revision validation", async () => {
  const f = await fixture();
  try {
    const pending = await f.request();
    const proposed = await f.service.execute(f.actor, pending.request?.id ?? "missing");
    const input = {
      expectedRevision: proposed.workspaceRevision,
      proposalId: proposed.proposal?.id,
      summaryRevision: f.original.summary.revision,
    };
    const key = crypto.randomUUID();
    let lost = true;
    const service = createSummaryReconciliationService(
      createSummaryReconciliationStorage(f.core, {
        ...f.ports,
        publishConfirmedSummary: async (args, prepare) => {
          const result = await f.ports.publishConfirmedSummary(args, prepare);
          if (lost) {
            lost = false;
            throw new Error("Synthetic lost acknowledgement");
          }
          return result;
        },
      }),
    );
    await expect(service.confirm(f.actor, key, input)).rejects.toThrow("Synthetic lost");
    const result = await service.confirm(f.actor, key, input);
    expect(result.status).toBe("confirmed");
    const after = proposed.proposal?.after;
    if (!after) throw new Error("Missing synthetic after snapshot");
    expect((await service.read(f.actor)).summary).toEqual(after);
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_summaries WHERE workspace_id=?")
        .get(f.actor.caseId),
    ).toEqual({ n: 2 });
  } finally {
    f.db.close();
  }
});

test("request receipt rejects changed explanations under the same key without creating another job", async () => {
  const f = await fixture();
  try {
    const key = crypto.randomUUID();
    await f.request(key);
    await expect(
      f.service.request(f.actor, key, {
        ...f.input,
        explanation: "다른 내용을 같은 키로 덮으려는 요청입니다.",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(
      f.db.sqlite.query("SELECT count(*) n FROM v2_jobs WHERE kind='chat_response'").get(),
    ).toEqual({ n: 1 });
    expect(f.harness.generateCalls).toBe(0);
  } finally {
    f.db.close();
  }
});

test("native source fixture distinguishes initial review from an active confirmed summary", async () => {
  for (const confirmed of [false, true]) {
    const f = await nativeReconciliationFixture(confirmed);
    try {
      const source = await f.authorize(f.actor, { write: false });
      expect(source.context.intake.status).toBe(confirmed ? "confirmed" : "reviewing_summary");
      expect(source.context.confirmedSummary !== null).toBe(confirmed);
      expect(source.context.intake.batches).toHaveLength(1);
      expect(source.context.intake.batches[0]?.answers[0]?.status).toBe("unknown");
    } finally {
      f.db.close();
    }
  }
});
