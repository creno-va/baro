import { expect, test } from "bun:test";
import { createWorkspaceClient } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { z } from "zod";
import { v2JobSchema, v2SummaryReconciliationSchema, v2WorkspaceSchema } from "../src/contracts/v2";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2ReworkRepository } from "../src/server/db/v2-rework";
import { createWorkspaceService } from "../src/server/modules/workspace/service";
import {
  intake as wireIntake,
  job as wireJob,
  summary as wireSummary,
  workspace as wireWorkspace,
} from "./fixtures/contracts/v2";
import { reportFixture } from "./helpers/report-fixture";
import { createReworkRuntimeFixture } from "./helpers/rework-runtime-fixture";

const intake = z.object({
  revision: z.number(),
  currentJobId: z.string().nullable(),
  batches: z.array(z.object({ questions: z.array(z.object({ id: z.string() })) })),
  summary: z.object({ revision: z.number() }).nullable(),
});
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean) {
  for (let step = 0; step < 500; step++) {
    const value = await read();
    if (ready(value)) return value;
    await Bun.sleep(10);
  }
  throw new Error("SYNTHETIC_READ_WAIT_LIMIT");
}

for (const purpose of ["prepare_claim", "respond_to_claim"] as const)
  test(`${purpose}: actual reconciliation and automatic analysis remain readable through the installed workspace facade`, async () => {
    const f = await createReworkRuntimeFixture({
      browserOrigin: "http://127.0.0.1:4396",
      purpose,
      native: "unavailable",
    });
    const base = `/api/v2/cases/${f.info.caseId}`;
    const read = async (path: string) => {
      const response = await f.request(base + path);
      if (!response.ok) throw new Error(`SYNTHETIC_READ_${response.status}`);
      return await response.json();
    };
    const write = async (path: string, body: unknown, method = "POST") => {
      const response = await f.request(base + path, body, method);
      expect(response.ok).toBe(true);
      return await response.json();
    };
    try {
      for (let round = 0; round < 2; round++) {
        const w = v2WorkspaceSchema.parse(await read("/workspace"));
        await write("/intake/advance", { expectedRevision: w.workspaceRevision });
        const value = await until(
          async () => intake.parse(await read("/intake")),
          (value) => !value.currentJobId && value.batches.length === round + 1,
        );
        await write(
          "/intake/answers",
          {
            expectedRevision: value.revision,
            answers: value.batches[round]!.questions.map((q) => ({
              questionId: q.id,
              status: "unknown",
            })),
          },
          "PUT",
        );
      }
      const w = v2WorkspaceSchema.parse(await read("/workspace"));
      await write("/intake/advance", { expectedRevision: w.workspaceRevision });
      const value = await until(
        async () => intake.parse(await read("/intake")),
        (value) => !!value.summary && !value.currentJobId,
      );
      if (!value.summary) throw new Error("Missing synthetic summary");
      const before = v2WorkspaceSchema.parse(await read("/workspace"));
      await write("/rework/summary-reconciliation/request", {
        expectedRevision: before.workspaceRevision,
        summaryRevision: value.summary.revision,
        kind: "addition",
        explanation: f.info.reconciliationExplanation,
      });
      const proposal = await until(
        async () =>
          v2SummaryReconciliationSchema.parse(await read("/rework/summary-reconciliation")),
        (state) => state.status === "proposed",
      );
      if (!proposal.proposal) throw new Error("Missing synthetic proposal");
      // Completed reconciliation is an authenticated private job, not a missing chat response.
      expect(await read("/workspace-jobs/latest")).toBeNull();
      await write("/rework/summary-reconciliation/confirm", {
        expectedRevision: proposal.workspaceRevision,
        proposalId: proposal.proposal.id,
        summaryRevision: proposal.proposal.baseSummaryRevision,
      });
      const conversation = z.object({
        report: z.object({ status: z.string(), id: z.string().nullable() }),
      });
      const ready = await until(
        async () => conversation.parse(await read("/rework/conversation")),
        (state) => state.report.status === "ready",
      );
      expect(
        v2SummaryReconciliationSchema.parse(await read("/rework/summary-reconciliation")).status,
      ).toBe("confirmed");
      const counters = z.object({ models: z.array(z.string()), sources: z.number() });
      const beforeStats = counters.parse(
        await (await f.control(new Request("http://127.0.0.1:4396/__rework-test/stats")))!.json(),
      );
      const client = createWorkspaceClient({
        scope: createSessionScope(),
        newKey: () => crypto.randomUUID(),
        request: async (path) => f.request(path),
        listFiles: async (id) => {
          const response = await f.request(`/api/v2/cases/${id}/files`);
          expect(response.ok).toBe(true);
          const files = z.array(z.unknown()).parse(await response.json());
          expect(files).toHaveLength(0);
          return []; // Actual metadata is empty: this scenario admits no uploads.
        },
      });
      const current = await client.get(f.info.caseId);
      expect(current.case.stage).toBe("active");
      expect(current.messages.some((message) => message.id.startsWith("job:"))).toBe(false);
      expect(await read("/workspace-jobs/latest")).toBeNull();
      expect(conversation.parse(await read("/rework/conversation")).report.id).toBe(
        ready.report.id,
      );
      const afterStats = counters.parse(
        await (await f.control(new Request("http://127.0.0.1:4396/__rework-test/stats")))!.json(),
      );
      expect(afterStats.models).toEqual(beforeStats.models);
      expect(afterStats.sources).toBe(beforeStats.sources);
    } finally {
      await f.close();
    }
  });

test("an ordinary completed chat still rejects a missing assistant after bounded fresh reads", async () => {
  let latestReads = 0;
  const client = createWorkspaceClient({
    scope: createSessionScope(),
    newKey: () => crypto.randomUUID(),
    listFiles: async () => [],
    request: async (path) => {
      if (path.endsWith("/workspace")) {
        return Response.json({ ...wireWorkspace, workspaceRevision: 4 });
      }
      if (path.endsWith("/intake")) return Response.json(wireIntake);
      if (path.endsWith("/summary")) return Response.json(wireSummary);
      if (path.endsWith("/workspace-jobs/latest")) {
        latestReads++;
        return Response.json({
          ...wireJob,
          status: "completed",
          phase: "finished",
          progressPercent: 100,
        });
      }
      if (path.includes("/messages?") || path.endsWith("/actions") || path.endsWith("/timeline"))
        return Response.json({ items: [], nextCursor: null });
      throw new Error("UNEXPECTED_SYNTHETIC_REQUEST");
    },
  });
  await expect(client.get(wireWorkspace.id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(latestReads).toBe(3);
});

for (const proof of ["ordinary", "valid", "wrong_operation", "damaged"] as const)
  test(`private current job projection requires the encrypted ${proof} admission proof and preserves raw locking`, async () => {
    const f = await reportFixture();
    try {
      const jobs = createV2JobsRepository(f.core),
        id = crypto.randomUUID(),
        operationId = crypto.randomUUID();
      const before = f.rev(),
        guard = () => ({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() });
      expect(
        await jobs.admitWorkspace(
          guard(),
          { operationId, key: crypto.randomUUID(), requestHash: "d".repeat(64) },
          id,
          "chat_response",
          {
            id: crypto.randomUUID(),
            request: {
              expectedRevision: before,
              text: "합성 비공개 작업 분류를 검증합니다.",
              selectedFileIds: [],
            },
          },
        ),
      ).toBe(true);
      if (proof === "ordinary") {
        const service = createWorkspaceService(f.core, { clock: () => f.actor.now });
        expect((await service.find(f.actor.ownerId, f.workspaceId)).currentJobId).toBe(id);
        expect((await service.latestJob(f.actor.ownerId, f.workspaceId))?.id).toBe(id);
        return;
      }
      const acquired = await jobs.acquire(
        f.actor,
        id,
        crypto.randomUUID(),
        new Date(Date.parse(f.actor.now) + 240000).toISOString(),
      );
      if (!acquired) throw new Error("Missing synthetic lease");
      const record = await createV2ReworkRepository(f.core, { clock: () => f.actor.now }).write(
        guard(),
        {
          kind: "task",
          entityId: id,
          expectedVersion: 0,
          lease: acquired.lease,
          schema: z.unknown(),
          value: {
            format: "legal-analysis-task-v1",
            kind: "legal_analysis",
            jobId: id,
            operationId: proof === "wrong_operation" ? crypto.randomUUID() : operationId,
            beforeWorkspaceRevision: before,
            targetWorkspaceRevision: f.rev(),
          },
        },
      );
      if (!record) throw new Error("Missing synthetic private admission proof");
      if (proof === "damaged")
        expect(() =>
          f.db.sqlite
            .query("UPDATE v2_rework_parts SET encrypted_payload='damaged' WHERE record_id=?")
            .run(record.id),
        ).toThrow("V2_IMMUTABLE_REWORK");
      const core =
        proof === "damaged"
          ? {
              ...f.core,
              cipher: {
                ...f.core.cipher,
                decrypt: async (...args: Parameters<typeof f.core.cipher.decrypt>) => {
                  if (args[1].table === "v2_rework_parts")
                    throw new Error("SYNTHETIC_CRYPTO_FAILURE");
                  return f.core.cipher.decrypt(...args);
                },
              },
            }
          : f.core;
      const service = createWorkspaceService(core, { clock: () => f.actor.now });
      if (proof === "valid") {
        expect((await service.find(f.actor.ownerId, f.workspaceId)).currentJobId).toBeNull();
        expect(await service.latestJob(f.actor.ownerId, f.workspaceId)).toBeNull();
        expect(v2JobSchema.parse(await service.job(f.actor.ownerId, f.workspaceId, id)).id).toBe(
          id,
        );
        expect(
          f.db.sqlite
            .query("SELECT current_job_id FROM v2_workspaces WHERE id=?")
            .get(f.workspaceId),
        ).toEqual({ current_job_id: id });
        await expect(service.find(crypto.randomUUID(), f.workspaceId)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      } else {
        await expect(service.find(f.actor.ownerId, f.workspaceId)).rejects.toBeDefined();
        await expect(service.latestJob(f.actor.ownerId, f.workspaceId)).rejects.toBeDefined();
      }
    } finally {
      f.db.close();
    }
  });
