import { expect, test } from "bun:test";
import type { WorkspaceMockRuntime, WorkspaceMockState } from "../src/client/api/mock/workspace";
import { workspaceConversationFixture } from "./helpers/workspace-conversation-client-fixture";

function fixture() {
  let saved: WorkspaceMockState = {
    session: {
      user: { id: "synthetic-owner", name: "합성 사용자", accountType: "customer" },
      needsConsent: false,
    },
    cases: {
      example: {
        id: "example",
        title: "합성 사건",
        subjectContext: "individual",
        stage: "active",
        revision: 8,
        updatedAt: "2026-11-01T00:00:00.000Z",
        summary: "합성 사실",
        schemaVersion: "2",
      },
    },
    caseOwners: { example: "synthetic-owner" },
    workspace: {},
    files: {
      example: [
        {
          id: "file",
          revision: 1,
          name: "합성.txt",
          mimeType: "text/plain",
          sizeBytes: 8,
          status: "processing",
          coverage: "처리 중",
          extractedText: "",
        },
      ],
    },
    fileProcessing: { file: { at: Date.now() + 60_000, failed: false } },
    fileExtractions: { file: "이미 접수한 합성 원문" },
  };
  const runtime: WorkspaceMockRuntime = {
    read: () => structuredClone(saved),
    update: (mutate) => {
      const next = structuredClone(saved);
      const result = mutate(next);
      saved = next;
      return result;
    },
  };
  return { runtime, client: workspaceConversationFixture(runtime) };
}

test("isolated progress observes due admitted processing without a whole-workspace read or early success", async () => {
  const { runtime, client } = fixture();
  const before = await client.getConversationProgress("example");
  expect(before.state.pendingEvidenceIds).toEqual(["file"]);
  expect(before.state.workspaceRevision).toBe(8);
  expect(runtime.read().files.example?.[0]?.status).toBe("processing");
  runtime.update((state) => {
    if (state.fileProcessing?.file) state.fileProcessing.file.at = 0;
  });
  const completed = await client.getConversationProgress("example");
  expect(completed.state.pendingEvidenceIds).toEqual([]);
  expect(completed.state.workspaceRevision).toBe(9);
  expect(completed.state.analysis.status).toBe("not_started");
  expect(completed.state.report.status).toBe("not_started");
  expect(completed.reportContinuation).toBeNull();
  expect(runtime.read().files.example?.[0]?.extractedText).toBe("이미 접수한 합성 원문");
  expect((await client.getConversationProgress("example")).state.workspaceRevision).toBe(9);
});

test("a due failed processor remains failed and never invents extracted evidence", async () => {
  const { runtime, client } = fixture();
  runtime.update((state) => {
    state.fileProcessing = { file: { at: 0, failed: true } };
  });
  const progress = await client.getConversationProgress("example");
  expect(progress.state.pendingEvidenceIds).toEqual([]);
  expect(runtime.read().files.example?.[0]?.status).toBe("failed");
  expect(runtime.read().files.example?.[0]?.extractedText).toBe("");
  expect(progress.reportContinuation).toBeNull();
});

test("foreign owner or aborted reads cannot observe or advance prior-account processing", async () => {
  const { runtime, client } = fixture();
  runtime.update((state) => {
    state.fileProcessing = { file: { at: 0, failed: false } };
  });
  await expect(
    client.getConversationProgress("example", { expectedOwner: "other-owner" }),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(
    client.getConversationProgress("example", { signal: AbortSignal.abort() }),
  ).rejects.toBeDefined();
  expect(runtime.read().files.example?.[0]?.status).toBe("processing");
  expect(runtime.read().cases.example?.revision).toBe(8);
});
