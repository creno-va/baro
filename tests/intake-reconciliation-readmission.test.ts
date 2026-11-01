import { expect, test } from "bun:test";
import { z } from "zod";
import {
  v2ConversationStateSchema,
  v2QuestionBatchSchema,
  v2SummaryReconciliationSchema,
  v2SummarySchema,
  v2WorkspaceSchema,
} from "../src/contracts/v2";
import { createReworkRuntimeFixture } from "./helpers/rework-runtime-fixture";

type Fixture = Awaited<ReturnType<typeof createReworkRuntimeFixture>>;
const intakeSchema = z.object({
  revision: z.number(),
  batches: z.array(v2QuestionBatchSchema),
  currentJobId: z.string().nullable(),
  summary: z.object({ revision: z.number() }).nullable(),
});
async function wire(f: Fixture, path: string, input?: unknown, method?: string) {
  const response = await f.request(`/api/v2/cases/${f.info.caseId}${path}`, input, method);
  const value: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.object({ code: z.string() }) }).parse(value);
    throw new Error(`SYNTHETIC_READMISSION_HTTP_${response.status}_${error.error.code}`);
  }
  return value;
}
const read = async <T>(f: Fixture, path: string, schema: z.ZodType<T>): Promise<T> =>
  schema.parse(await wire(f, path));
async function until<T>(readValue: () => Promise<T>, ready: (value: T) => boolean) {
  for (let attempt = 0; attempt < 500; attempt++) {
    try {
      const value = await readValue();
      if (ready(value)) return value;
    } catch (cause) {
      // Only a proven readonly CAS conflict can be read again. Never replay POSTs.
      if (
        !(cause instanceof Error) ||
        cause.message !== "SYNTHETIC_READMISSION_HTTP_409_STALE_REVISION"
      )
        throw cause;
    }
    await Bun.sleep(10);
  }
  throw new Error("SYNTHETIC_READMISSION_WAIT_LIMIT");
}

for (const purpose of ["prepare_claim", "respond_to_claim"] as const) {
  test(`${purpose}: signed runtime admits a second explanation after later automatic research`, async () => {
    const f = await createReworkRuntimeFixture({
      browserOrigin: "http://127.0.0.1:4396",
      purpose,
      native: "unavailable",
    });
    try {
      for (let round = 0; round < 2; round++) {
        const w = await read(f, "/workspace", v2WorkspaceSchema);
        await wire(f, "/intake/advance", { expectedRevision: w.workspaceRevision });
        const intake = await until(
          () => read(f, "/intake", intakeSchema),
          (value) => value.batches.length === round + 1 && !value.currentJobId,
        );
        const batch = intake.batches[round];
        if (!batch) throw new Error("SYNTHETIC_READMISSION_BATCH_MISSING");
        expect(batch.questions).toHaveLength(3);
        await wire(
          f,
          "/intake/answers",
          {
            expectedRevision: intake.revision,
            answers: batch.questions.map((question) => ({
              questionId: question.id,
              status: "unknown",
            })),
          },
          "PUT",
        );
      }
      const w = await read(f, "/workspace", v2WorkspaceSchema);
      await wire(f, "/intake/advance", { expectedRevision: w.workspaceRevision });
      await until(
        () => read(f, "/intake", intakeSchema),
        (value) => !!value.summary && !value.currentJobId,
      );
      const before = await read(f, "/summary", v2SummarySchema);
      const current = await read(f, "/workspace", v2WorkspaceSchema);
      await wire(f, "/rework/summary-reconciliation/request", {
        expectedRevision: current.workspaceRevision,
        summaryRevision: before.revision,
        kind: "addition",
        explanation: f.info.reconciliationExplanation,
      });
      const proposal = await until(
        () => read(f, "/rework/summary-reconciliation", v2SummaryReconciliationSchema),
        (value) => ["proposed", "failed", "stale"].includes(value.status),
      );
      expect(proposal.status).toBe("proposed");
      if (!proposal.proposal) throw new Error("SYNTHETIC_READMISSION_PROPOSAL_MISSING");
      await wire(f, "/rework/summary-reconciliation/confirm", {
        expectedRevision: proposal.workspaceRevision,
        proposalId: proposal.proposal.id,
        summaryRevision: before.revision,
      });
      const prepared = await until(
        () => read(f, "/rework/conversation", v2ConversationStateSchema()),
        (value) => value.analysis.status === "ready" && value.report.status === "ready",
      );
      expect(prepared.snapshot?.citations.length).toBeGreaterThan(0);
      const canonical = await read(f, "/summary", v2SummarySchema);
      const fresh = await read(f, "/workspace", v2WorkspaceSchema);
      const input = {
        expectedRevision: fresh.workspaceRevision,
        summaryRevision: canonical.revision,
        kind: "addition",
        explanation: "합성 후속 진술: 원본은 제가 보관하며 추가 자료의 날짜는 아직 모릅니다.",
      };
      const pending = v2SummaryReconciliationSchema.parse(
        await wire(f, "/rework/summary-reconciliation/request", input),
      );
      expect(pending.status).toBe("pending");
      const next = await until(
        () => read(f, "/rework/summary-reconciliation", v2SummaryReconciliationSchema),
        (value) => ["proposed", "failed", "stale"].includes(value.status),
      );
      expect(next.request?.id).toBe(pending.request?.id);
      expect(next.status).toBe("proposed");
      expect(next.proposal?.before).toEqual(canonical);
      expect(await read(f, "/summary", v2SummarySchema)).toEqual(canonical);
      expect((await read(f, "/intake", intakeSchema)).batches).toHaveLength(2);
    } finally {
      await f.close();
    }
  });
}
