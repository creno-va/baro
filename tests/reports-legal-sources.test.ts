import { expect, test } from "bun:test";
import { snapshotStatements } from "../src/server/db/v2-core";
import { createV2OfficialSourceRepository } from "../src/server/db/v2-official-sources";
import { OFFICIAL_CATALOG } from "../src/server/modules/legal-retrieval/v2/registry";
import { makeChunk } from "../src/server/modules/legal-retrieval/v2/source";
import { buildReportSource } from "../src/server/modules/reports/source";
import { reportFixture } from "./helpers/report-fixture";

test.each(["body", "version", "extractor_version", "rights_provenance", "availability"])(
  "report originals and cached reports reject changed %s",
  async (column) => {
    const f = await reportFixture(),
      repo = createV2OfficialSourceRepository(f.core);
    const guard = { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() };
    const chunk = await makeChunk(
      {
        sourceType: "statute",
        officialId: "1706",
        version: "284415",
        section: "제1조",
        canonicalUrl: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=284415",
        title: "합성 출처 검토",
        body: "합성 공식 원문",
        sourceDate: "2026-10-01",
        fetchedAt: f.actor.now,
        verifiedAt: f.actor.now,
        rightsProvenance: OFFICIAL_CATALOG[0].rights,
        court: null,
        caseNumber: null,
        institutionId: null,
        endpointId: null,
      },
      f.actor.now.slice(0, 10),
    );
    expect(await repo.put(chunk.source, chunk.citation)).toBe(true);
    expect(await repo.bindCitation(guard, chunk.citation)).toBe(true);
    const snapshotId = crypto.randomUUID(),
      summaryId = crypto.randomUUID(),
      claim = crypto.randomUUID();
    const summary = {
      schemaVersion: "2",
      revision: 2,
      intakeRevision: 1,
      createdAt: f.actor.now,
      overview: "합성 검증",
      facts: [
        {
          id: crypto.randomUUID(),
          text: chunk.source.body,
          attribution: "official_source",
          certainty: "observed",
          significance: "neutral",
          references: [{ kind: "official_source", citationId: chunk.citation.id }],
          conflictingFactIds: [],
          userEdited: false,
        },
      ],
      parties: [],
      unknowns: [],
      notices: ["합성 검증"],
    };
    await f.core.binding.batch([
      f.core.claim(guard, claim),
      ...(await snapshotStatements(
        f.core,
        {
          id: snapshotId,
          ownerId: f.actor.ownerId,
          workspaceId: f.workspaceId,
          targetId: f.workspaceId,
          revision: 2,
          purpose: "summary",
          now: f.actor.now,
        },
        summary,
        claim,
      )),
      f.core.finish(claim),
    ]);
    f.db.sqlite
      .query(
        "INSERT INTO v2_summaries(id,workspace_id,revision,intake_revision,snapshot_id,created_at) VALUES(?,?,2,1,?,?)",
      )
      .run(summaryId, f.workspaceId, snapshotId, f.actor.now);
    f.db.sqlite
      .query("UPDATE v2_intakes SET summary_id=?,confirmed_summary_revision=2 WHERE id=?")
      .run(summaryId, f.workspaceId);
    f.db.sqlite
      .query("UPDATE v2_workspaces SET confirmed_summary_revision=2 WHERE id=?")
      .run(f.workspaceId);
    const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
    expect(report.stale).toBe(false);
    if (column === "availability")
      expect(await repo.put(chunk.source, chunk.citation, "limited")).toBe(true);
    else
      f.db.sqlite
        .query(`UPDATE v2_official_sources SET ${column}=? WHERE source_id=?`)
        .run("altered-synthetic", chunk.source.sourceId);
    expect((await f.reports.get(f.actor.ownerId, f.workspaceId)).stale).toBe(true);
    await expect(buildReportSource(f.core, f.actor, f.workspaceId, [])).rejects.toThrow(
      "LEGAL_SOURCE_UNAVAILABLE",
    );
  },
);
