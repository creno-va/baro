import { expect, test } from "bun:test";
import { casesApi } from "../../src/client/api/cases";

// Synthetic HTTP boundary reproduces a server commit followed by lost acknowledgement.
// The normal server receipt can replay the original body; this checks whether the adapter reaches it.
for (const operation of ["saveSummary", "confirmSummary"] as const) {
  test(`real ${operation} retries a committed operation after lost acknowledgement`, async () => {
    const originalFetch = globalThis.fetch;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const workspace = {
      schemaVersion: "2",
      id,
      title: "사건 작업 공간",
      subjectContext: "individual",
      jurisdiction: "KR",
      status: "intake",
      archivedFrom: null,
      workspaceRevision: 5,
      intakeRevision: 3,
      confirmedSummaryRevision: null,
      currentJobId: null,
      legacySnapshotId: null,
      createdAt: now,
      updatedAt: now,
    };
    const metadata = {
      schemaVersion: "2",
      revision: 3,
      status: "reviewing_summary",
      narrative: "합성 사건 HTTP 재시도 경계입니다.",
      batches: [],
      confirmedSummaryRevision: null,
      currentJobId: null,
      summary: { id: "synthetic-summary", revision: 2 },
    };
    const summary = {
      schemaVersion: "2",
      revision: 2,
      intakeRevision: 3,
      createdAt: now,
      overview: "합성 요약",
      facts: [],
      parties: [],
      unknowns: [],
      notices: ["합성 테스트입니다."],
    };
    let writes = 0;
    globalThis.fetch = (async (input, init) => {
      const path = String(input);
      if (init?.method && init.method !== "GET") {
        writes++;
        if (writes === 1) {
          workspace.workspaceRevision++;
          if (operation === "saveSummary") metadata.summary.revision++;
          else metadata.revision++;
          throw new Error("Synthetic response lost after commit");
        }
        return Response.json(metadata);
      }
      return Response.json(
        path.endsWith("/workspace") ? workspace : path.endsWith("/summary") ? summary : metadata,
      );
    }) as typeof fetch;
    try {
      const input = { expectedRevision: 5, summary: "수정한 합성 요약" };
      await expect(casesApi[operation](id, input)).rejects.toMatchObject({ code: "UNAVAILABLE" });
      const retried = await casesApi[operation](id, input).then(
        (value) => ({ code: "SUCCESS", id: value.id, writes }),
        (error) => ({ code: (error as { code: string }).code, id, writes }),
      );
      expect(retried).toEqual({ code: "SUCCESS", id, writes: 2 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
