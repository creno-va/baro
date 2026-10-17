import { expect, test } from "bun:test";
import { type V2Summary, v2ActionSchema, v2TimelineEntrySchema } from "../src/contracts/v2";
import { snapshotStatements } from "../src/server/db/v2-core";
import { createV2OfficialSourceRepository } from "../src/server/db/v2-official-sources";
import { OFFICIAL_CATALOG } from "../src/server/modules/legal-retrieval/v2/registry";
import { makeChunk } from "../src/server/modules/legal-retrieval/v2/source";
import { buildReportSource } from "../src/server/modules/reports/source";
import { readWorkspaceContext } from "../src/server/modules/workspace/context";
import { createWorkspacePipeline } from "../src/server/modules/workspace/pipeline";
import { reportFixture } from "./helpers/report-fixture";

// Real SQLite/AES repositories and product source/report/chat consumers. The
// source text and gateway are explicit fixtures, not external-provider evidence.
test("identical source renewal recovers report facts/actions/timeline and subsequent chat without rewriting history", async () => {
  const f = await reportFixture(),
    repo = createV2OfficialSourceRepository(f.core);
  const original = await makeChunk(
    {
      sourceType: "statute",
      officialId: "1706",
      version: "284415",
      section: "제1조",
      canonicalUrl: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=284415",
      title: "합성 공식 출처",
      body: "합성 원문 😀: 실제 법률을 설명하지 않습니다.",
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
  const guard = () => ({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() });
  expect(await repo.put(original.source, original.citation)).toBe(true);
  expect(await repo.bindCitation(guard(), original.citation)).toBe(true);
  const reference = { kind: "official_source" as const, citationId: original.citation.id };
  const summary: V2Summary = {
    schemaVersion: "2",
    revision: 2,
    intakeRevision: 1,
    createdAt: f.actor.now,
    overview: "합성 출처를 포함한 사건 요약",
    parties: [],
    unknowns: [],
    notices: ["합성 검증"],
    facts: [
      {
        id: "original_fact",
        text: original.source.body,
        attribution: "official_source",
        certainty: "observed",
        significance: "neutral",
        references: [reference],
        conflictingFactIds: [],
        userEdited: false,
      },
    ],
  };
  const snapshotId = crypto.randomUUID(),
    summaryId = crypto.randomUUID(),
    claimId = crypto.randomUUID();
  await f.core.binding.batch([
    f.core.claim(guard(), claimId),
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
      claimId,
    )),
    f.core.finish(claimId),
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
  const action = v2ActionSchema.parse({
    id: "original_action",
    revision: 1,
    kind: "official_guide_check",
    title: "공식 원문 확인",
    instructions: "합성 원문을 확인합니다.",
    caution: "합성 검증",
    status: "todo",
    factIds: ["original_fact"],
    references: [reference],
  });
  const timeline = v2TimelineEntrySchema.parse({
    id: "original_timeline",
    revision: 1,
    date: null,
    datePrecision: "unknown",
    event: "합성 출처 확인 기록",
    certainty: "uncertain",
    references: [reference],
    factIds: ["original_fact"],
    userEdited: false,
  });
  const actionId = crypto.randomUUID(),
    timelineId = crypto.randomUUID();
  f.db.sqlite
    .query(
      "INSERT INTO v2_actions(id,entity_id,workspace_id,revision,kind,status,encrypted_payload) VALUES(?,?,?,1,?,?,?)",
    )
    .run(
      actionId,
      action.id,
      f.workspaceId,
      action.kind,
      action.status,
      await f.core.encrypt("v2_actions", actionId, f.actor.ownerId, 1, action),
    );
  f.db.sqlite
    .query(
      "INSERT INTO v2_timeline(id,entity_id,workspace_id,revision,encrypted_payload) VALUES(?,?,?,1,?)",
    )
    .run(
      timelineId,
      timeline.id,
      f.workspaceId,
      await f.core.encrypt("v2_timeline", timelineId, f.actor.ownerId, 1, timeline),
    );
  const first = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const originalBody = (await buildReportSource(f.core, f.actor, f.workspaceId, [])).body;
  const history = () => ({
    binding: f.db.sqlite
      .query("SELECT * FROM v2_citation_bindings WHERE id=?")
      .get(original.citation.id),
    summary: f.db.sqlite.query("SELECT * FROM v2_private_snapshots WHERE id=?").get(snapshotId),
    action: f.db.sqlite.query("SELECT * FROM v2_actions WHERE id=?").get(actionId),
    timeline: f.db.sqlite.query("SELECT * FROM v2_timeline WHERE id=?").get(timelineId),
    report: f.db.sqlite.query("SELECT * FROM v2_reports WHERE id=?").get(first.id),
  });
  const saved = history();
  f.actor.now = new Date(Date.parse(f.actor.now) + 25 * 3600000).toISOString();
  await expect(buildReportSource(f.core, f.actor, f.workspaceId, [])).rejects.toThrow(
    "LEGAL_SOURCE_UNAVAILABLE",
  );
  const refreshed = await makeChunk(
    { ...original.source, fetchedAt: f.actor.now, verifiedAt: f.actor.now },
    f.actor.now.slice(0, 10),
  );
  expect(await repo.put(refreshed.source, refreshed.citation)).toBe(true);
  expect(await repo.bindCitation(guard(), refreshed.citation)).toBe(true);
  const renewedBody = (await buildReportSource(f.core, f.actor, f.workspaceId, [])).body;
  expect(renewedBody.facts).toEqual(originalBody.facts);
  expect(renewedBody.actions).toEqual([action]);
  expect(renewedBody.timeline).toEqual([timeline]);
  expect(renewedBody.citations).toEqual([original.citation]);
  const next = await f.reports.generate(f.actor.ownerId, f.workspaceId, "renewal-report-fixture", {
    expectedRevision: first.revision,
  });
  expect(next.revision).toBe(first.revision + 1);
  expect(next.stale).toBe(false);
  expect(history()).toEqual(saved);
  const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId, {
    schemaVersion: "2",
    id: "new_question",
    operationId: "new_operation",
    workspaceRevision: f.rev(),
    createdAt: f.actor.now,
    role: "user",
    text: "공식 원문을 다시 확인합니다.",
    selectedFileIds: [],
  });
  expect(context.citations).toContainEqual(original.citation);
  expect(
    context.sourceRetrieval?.chunks.find((c) => c.citation.id === original.citation.id)?.source
      .verifiedAt,
  ).toBe(refreshed.source.verifiedAt);
  const pipeline = createWorkspacePipeline(
    {
      call: async (phase) =>
        phase === "workspace_audit"
          ? {
              pass: true,
              findings: [],
              unsupportedFactIds: [],
              legalClaimsSupported: true,
              strategyDetected: false,
            }
          : {
              text: original.source.body,
              references: [reference],
              warnings: [],
              facts: [],
              parties: [],
              actions: [],
              timeline: [],
              requestedSources: [],
              sourceClaims: [
                {
                  id: "new_claim",
                  kind: "quotation",
                  text: original.source.body,
                  citationId: original.citation.id,
                  startUtf16: 0,
                  endUtf16: original.source.body.length,
                },
              ],
            },
    },
    { reserve: async () => true, invocation: () => crypto.randomUUID() },
  );
  expect((await pipeline.chat(context, "synthetic_renewed_chat")).citations).toEqual([
    original.citation,
  ]);
  expect(history()).toEqual(saved);
  f.actor.now = refreshed.source.expiresAt;
  await expect(buildReportSource(f.core, f.actor, f.workspaceId, [])).rejects.toThrow(
    "LEGAL_SOURCE_UNAVAILABLE",
  );
});
