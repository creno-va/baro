import { expect, test } from "bun:test";
import { type V2Summary, v2ActionSchema, v2TimelineEntrySchema } from "../src/contracts/v2";
import { snapshotStatements } from "../src/server/db/v2-core";
import { createV2OfficialSourceRepository } from "../src/server/db/v2-official-sources";
import { OFFICIAL_CATALOG } from "../src/server/modules/legal-retrieval/v2/registry";
import { makeChunk } from "../src/server/modules/legal-retrieval/v2/source";
import { workspaceChatOutputSchema } from "../src/server/modules/llm-gateway/v2/schemas";
import { buildReportSource } from "../src/server/modules/reports/source";
import { readWorkspaceContext } from "../src/server/modules/workspace/context";
import {
  createWorkspacePipeline,
  WorkspaceOutputPolicyError,
} from "../src/server/modules/workspace/pipeline";
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
  const draft = workspaceChatOutputSchema.parse({
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
  });
  const modes = [
    "valid",
    "explanation",
    "new_fact",
    "retrieval_missing",
    "excerpt_missing",
    "excerpt_span_bounds",
    "claim_schema",
    "quotation_mismatch",
    "citation_allowlist",
    "retrieval_hash",
  ] as const;
  for (const mode of modes) {
    const input = structuredClone(context),
      output = structuredClone(draft);
    const claim = output.sourceClaims[0],
      cited = input.citations.find((c) => c.id === original.citation.id);
    if (!claim || !cited) throw new Error("Missing synthetic claim/citation");
    if (mode === "explanation") claim.kind = "legal_explanation";
    if (mode === "new_fact")
      output.facts = [
        { ...summary.facts[0], id: "new_official_fact" } as V2Summary["facts"][number],
      ];
    if (mode === "retrieval_missing") delete input.sourceRetrieval;
    if (mode === "excerpt_missing") input.sourceTexts = [];
    if (mode === "excerpt_span_bounds")
      input.sourceTexts = [{ citationId: original.citation.id, text: "합성" }];
    if (mode === "claim_schema") output.sourceClaims.push({ ...claim });
    if (mode === "quotation_mismatch") {
      output.text = "합성 변조 문장";
      claim.text = output.text;
    }
    if (mode === "citation_allowlist")
      input.citations = input.citations.map((c) =>
        c.id === cited.id ? { ...c, title: "다른 합성 제목" } : c,
      );
    if (mode === "retrieval_hash") {
      if (!input.sourceRetrieval) throw new Error("Missing synthetic retrieval");
      input.sourceRetrieval.retrievalHash = "f".repeat(64);
    }
    let audited = 0;
    const pipeline = createWorkspacePipeline(
      {
        call: async (phase) => {
          if (phase !== "workspace_audit") return output;
          audited++;
          return {
            pass: true,
            findings: [],
            unsupportedFactIds: [],
            legalClaimsSupported: true,
            strategyDetected: false,
          };
        },
      },
      { reserve: async () => true, invocation: () => crypto.randomUUID() },
    );
    if (mode === "valid" || mode === "explanation" || mode === "new_fact") {
      expect((await pipeline.chat(input, "synthetic_renewed_chat")).citations).toEqual([
        original.citation,
      ]);
    } else {
      try {
        await pipeline.chat(input, "synthetic_rejected_renewed_chat");
        throw new Error("Invalid synthetic claim was accepted");
      } catch (error) {
        expect(error).toBeInstanceOf(WorkspaceOutputPolicyError);
        expect(error).toMatchObject({ reason: "unsupported_fact", claimFailure: mode });
        expect(JSON.stringify((error as WorkspaceOutputPolicyError).claimFailure)).not.toContain(
          original.citation.id,
        );
      }
    }
    // All malformed claims below pass the independent synthetic audit before the
    // unchanged integrity guard rejects them. This is not provider evidence.
    expect(audited).toBe(1);
  }
  expect(history()).toEqual(saved);
  f.actor.now = refreshed.source.expiresAt;
  await expect(buildReportSource(f.core, f.actor, f.workspaceId, [])).rejects.toThrow(
    "LEGAL_SOURCE_UNAVAILABLE",
  );
});
