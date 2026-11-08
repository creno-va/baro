import { z } from "zod";
import { createReportHtml } from "../../../components/reports/document";
import { maskReportText } from "../../../components/reports/download";
import { idempotencyKeySchema, opaqueIdSchema } from "../../../contracts";
import { CURRENT_POLICY_VERSIONS } from "../../../contracts/consent";
import {
  type V2ReportBody,
  v2ReportBodySchema,
  v2ReportCreateRequestSchema,
} from "../../../contracts/v2";
import { reportMarkdownBlocks, reportPhotoIds } from "../../../utils/report-markdown";
import { createV2AccountingRepository, operationStatements } from "../../db/v2-accounting";
import {
  type Actor,
  fragmentText,
  readSnapshot,
  snapshotStatements,
  sqlClaim,
  utf8Bytes,
  type V2Core,
} from "../../db/v2-core";
import { jobInsertStatements } from "../../db/v2-jobs";
import { runtimeDigest } from "../../db/v2-paid-runtime";
import { createV2ReportsRepository } from "../../db/v2-reports";
import { createV2StagingRepository } from "../../db/v2-staging";
import {
  bindPreparedReportAnalysis,
  markReportAnalysisEdited,
  missingReportAnalysis,
  reportAnalysisIdentity,
  reportAnalysisSummary,
  reportAnalysisText,
} from "./analysis";
import { reportReadStep } from "./diagnostics";
import { reportSessionFence, requireReportConsent } from "./fence";
import { loadReportPhotos, photoCandidates, validatePhotos } from "./photos";
import {
  buildReportSource,
  ownedWorkspace,
  ReportError,
  type ReportReviewData,
  reportFile,
  reportReviewSchema,
  reportSourceDigest,
  reportSourceOptions,
  reportSourceRows,
  reportText,
  sourceDigest,
  validateOriginalSelection,
} from "./source";
import { createReportExports, type ReportDependencies } from "./storage";

export const saveReportSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  content: z.string().trim().min(1).max(30000),
  maskIdentifiers: z.boolean(),
  includedPhotoIds: z
    .array(opaqueIdSchema)
    .max(12)
    .refine((ids) => new Set(ids).size === ids.length)
    .optional(),
  excludedFileIds: z
    .array(opaqueIdSchema)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const generateReportSchema = z.strictObject({
  // Explicit initial intent: null expects no prior report. Omission preserves web compatibility.
  expectedRevision: z.number().int().positive().nullable().optional(),
  excludedFileIds: z
    .array(opaqueIdSchema)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length)
    .optional(),
});
type Row = {
  id: string;
  workspace_id: string;
  revision: number;
  workspace_revision: number;
  summary_revision: number;
  snapshot_id: string;
  review_snapshot_id?: string | null;
  latest_canonical_revision?: number;
  operation_id: string;
  current_job_id: string | null;
  state: string;
  pdf_blob_id: string | null;
  zip_blob_id: string | null;
  encrypted_payload: string;
  created_at: string;
};
export function createReportsService(core: V2Core, deps: ReportDependencies) {
  const clock = deps.clock ?? (() => new Date().toISOString());
  const actor = (ownerId: string): Actor => ({
    ownerId: opaqueIdSchema.parse(ownerId),
    now: clock(),
  });
  const canonical = createV2ReportsRepository(core, deps.guideHosts);
  const accounting = createV2AccountingRepository(core);
  const hasPreparedReader = Boolean(deps.readPreparedAnalysisForScope || deps.readPreparedAnalysis);
  const preparedSource = async (
    a: Actor,
    caseId: string,
    excluded: readonly string[],
    mask = false,
    includeTitle = false,
  ) => {
    const options = hasPreparedReader
      ? {
          includeAnalysis: true as const,
          scope: { excludedFileIds: excluded, maskIdentifiers: mask },
        }
      : undefined;
    const source = await buildReportSource(
      core,
      a,
      caseId,
      excluded,
      deps.guideHosts,
      options,
      includeTitle,
    );
    if (!hasPreparedReader) return { ...source, analysis: undefined, analysisIdentity: undefined };
    const scope = { excludedFileIds: excluded, maskIdentifiers: mask };
    const snapshot = deps.readPreparedAnalysisForScope
      ? await deps.readPreparedAnalysisForScope(a, caseId, scope)
      : ((await deps.readPreparedAnalysis?.(a, caseId)) ?? null);
    const scopeMatches =
      snapshot &&
      (deps.readPreparedAnalysisForScope
        ? true
        : deps.preparedAnalysisMatchesScope
          ? await deps.preparedAnalysisMatchesScope(a, caseId, snapshot, scope)
          : false);
    const needsScopeProof =
      Boolean(deps.readPreparedAnalysisForScope || deps.preparedAnalysisMatchesScope) ||
      mask ||
      excluded.length > 0;
    const compatible = needsScopeProof && !scopeMatches ? null : snapshot;
    const bound = await bindPreparedReportAnalysis(
      core,
      a,
      caseId,
      source.body,
      source.current.confirmed_summary_revision ?? 0,
      compatible,
      mask,
      deps.guideHosts,
      Boolean(scopeMatches),
    );
    return { ...source, ...bound, analysisIdentity: reportAnalysisIdentity(snapshot) };
  };
  const sourceContent = (source: Awaited<ReturnType<typeof preparedSource>>) => {
    const base = [
      reportText(source.body, source.coverage, source.display),
      "",
      "자료 처리 범위",
      ...(source.display.materialScopes?.length
        ? source.display.materialScopes.map((text) => `- ${text.replace(/\r?\n/gu, "\n  ")}`)
        : [
            "이 리포트에 포함된 자료가 없습니다. 자료가 없다는 것만으로 사실의 유무를 판단하지 않습니다.",
          ]),
      "",
      "안내",
      ...source.body.notices.map((text) => `- ${text.replace(/\r?\n/gu, "\n  ")}`),
    ].join("\n");
    return reportAnalysisText(source.body, base, source.analysis ?? missingReportAnalysis());
  };
  const checkAnalysis = async (a: Actor, caseId: string, review: ReportReviewData) => {
    if (review.analysisIdentity === undefined || !hasPreparedReader) return;
    const scope = {
      excludedFileIds: review.excludedFileIds,
      maskIdentifiers: review.maskIdentifiers,
    };
    const current = deps.readPreparedAnalysisForScope
      ? await deps.readPreparedAnalysisForScope(a, caseId, scope)
      : ((await deps.readPreparedAnalysis?.(a, caseId)) ?? null);
    // A scope change can make the authorized loader return null immediately
    // after saving. A report that intentionally omitted all derived analysis is
    // still current; a later compatible snapshot makes it eligible for refresh.
    if (!current && review.analysis?.snapshot === null) return;
    if (review.analysisIdentity !== reportAnalysisIdentity(current))
      throw new ReportError("STALE_REVISION");
    if (
      current &&
      review.analysis?.snapshot &&
      !deps.readPreparedAnalysisForScope &&
      deps.preparedAnalysisMatchesScope &&
      !(await deps.preparedAnalysisMatchesScope(a, caseId, current, {
        excludedFileIds: review.excludedFileIds,
        maskIdentifiers: review.maskIdentifiers,
      }))
    )
      throw new ReportError("STALE_REVISION");
  };
  const row = async (a: Actor, id: string, includeReview = false) => {
    opaqueIdSchema.parse(id);
    const session = reportSessionFence(deps.sessionId);
    const result = await core
      .statement(
        `SELECT r.*${includeReview ? ", (SELECT s.id FROM v2_private_snapshots s WHERE s.owner_id=w.owner_id AND s.target_id=r.id AND s.purpose='report' AND s.revision=r.workspace_revision+1 AND s.state='published') AS review_snapshot_id, (SELECT coalesce(max(p.revision),0) FROM v2_reports p WHERE p.workspace_id=r.workspace_id AND p.id NOT LIKE 'export-%') AS latest_canonical_revision" : ""} FROM v2_reports r JOIN v2_workspaces w ON w.id=r.workspace_id WHERE r.id=? AND w.owner_id=? AND EXISTS(SELECT 1 FROM user WHERE id=w.owner_id) AND coalesce((SELECT value FROM app_metadata WHERE key='account-type:'||w.owner_id),'customer') IN ('customer','lawyer') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=w.owner_id) OR (target_kind='workspace' AND target_id=w.id) OR (target_kind='report' AND target_id=r.id)) ${session.sql}`,
        [id, a.ownerId, ...session.values],
      )
      .first<Row>();
    if (!result) throw new ReportError("NOT_FOUND");
    return result;
  };
  const latest = async (a: Actor, caseId: string) => {
    await ownedWorkspace(core, a, caseId);
    return core
      .statement(
        "SELECT id,revision FROM v2_reports WHERE workspace_id=? AND id NOT LIKE 'export-%' ORDER BY revision DESC,created_at DESC,id DESC LIMIT 1",
        [caseId],
      )
      .first<{ id: string; revision: number }>();
  };
  const read = async (a: Actor, id: string) => {
    const r = await row(a, id, true);
    const body = await readSnapshot(
      core,
      a,
      r.snapshot_id,
      "report",
      id,
      r.workspace_revision,
      v2ReportBodySchema(deps.guideHosts),
      { batchInitialRead: true },
    );
    if (!body) throw new ReportError("NOT_FOUND");
    const savedReview = r.review_snapshot_id
      ? await readSnapshot(
          core,
          a,
          r.review_snapshot_id,
          "report",
          id,
          r.workspace_revision + 1,
          reportReviewSchema,
          { batchInitialRead: true },
        )
      : null;
    // Existing canonical reports predate the editable client snapshot. Keep
    // their content visible, but require explicit regeneration before export:
    // there is no historical source digest from which to prove freshness.
    const review: ReportReviewData = savedReview ?? {
      format: "client_review_v1",
      title: "사건 상담 준비 리포트",
      content: reportText(body, ["기존 리포트의 처리 범위는 새 버전에서 다시 확인해 주세요."]),
      excludedFileIds: [],
      maskIdentifiers: true,
      sourceDigest: "0".repeat(64),
      parentReportId: null,
    };
    const final = await row(a, id, true);
    if (
      r.snapshot_id !== final.snapshot_id ||
      r.revision !== final.revision ||
      r.review_snapshot_id !== final.review_snapshot_id
    )
      throw new ReportError("STALE_REVISION");
    return { row: r, body, review };
  };
  const view = async (a: Actor, id: string) => {
    const data = await read(a, id);
    let stale =
      data.review.sourceDigest !==
      (await sourceDigest(core, a, data.row.workspace_id, reportSourceOptions(data.review)));
    try {
      await checkAnalysis(a, data.row.workspace_id, data.review);
    } catch (error) {
      if (error instanceof ReportError && error.code === "STALE_REVISION") stale = true;
      else throw error;
    }
    const saved = await core
      .statement(
        "SELECT r.id,r.created_at,(SELECT count(*) FROM v2_report_selections WHERE report_id=r.id AND original_selected=1) AS file_count FROM v2_reports r JOIN v2_blobs b ON b.id=r.zip_blob_id WHERE r.workspace_id=? AND r.revision=? AND r.id LIKE 'export-%' AND r.state='ready' AND b.state='stored' AND b.kind='original_zip' ORDER BY r.created_at DESC,r.rowid DESC LIMIT 1",
        [data.row.workspace_id, data.row.revision],
      )
      .first<{ id: string; created_at: string; file_count: number }>();
    const archive = saved ? await read(a, saved.id) : null;
    const candidates = stale ? [] : await photoCandidates(core, a, data.body);
    await row(a, id);
    return {
      ...(saved && archive?.review.parentReportId === id && saved.file_count > 0
        ? { savedZip: { id: saved.id, fileCount: saved.file_count, createdAt: saved.created_at } }
        : {}),
      id,
      caseId: data.row.workspace_id,
      revision: data.row.revision,
      title: data.review.maskIdentifiers ? maskReportText(data.review.title) : data.review.title,
      content: data.review.content,
      updatedAt: data.row.created_at,
      stale,
      basis: {
        workspaceRevision: data.row.workspace_revision,
        summaryRevision: data.row.summary_revision,
        generatedAt: data.body.generatedAt,
      },
      pdfAvailable: data.row.state === "ready" && !!data.row.pdf_blob_id,
      includedPhotoIds: data.review.includedPhotoIds ?? [],
      photoCandidates: candidates,
      excludedFileIds: data.review.excludedFileIds,
      maskIdentifiers: data.review.maskIdentifiers,
    };
  };
  const stage = async (
    a: Actor,
    caseId: string,
    revision: number,
    reportId: string,
    body: V2ReportBody,
  ) => {
    const id = crypto.randomUUID(),
      text = JSON.stringify(body),
      parts = fragmentText(text);
    const repository = createV2StagingRepository(core),
      guard = { ...a, workspaceId: caseId, expectedRevision: revision };
    if (
      !(await repository.begin(guard, {
        id,
        purpose: "report",
        targetId: reportId,
        revision,
        partCount: parts.length,
        byteLength: utf8Bytes(text),
      }))
    )
      throw new ReportError("STALE_REVISION");
    for (const [index, part] of parts.entries())
      if (!(await repository.append(guard, id, index, part)))
        throw new ReportError("STALE_REVISION");
    if (
      !(await repository.seal(guard, id, {
        schemaVersion: "2",
        purpose: "report",
        targetId: reportId,
        revision,
      }))
    )
      throw new ReportError("STALE_REVISION");
    return id;
  };
  async function createRecord(
    a: Actor,
    caseId: string,
    key: string,
    requestHash: string,
    route: string,
    body: V2ReportBody,
    review: ReportReviewData,
    version: number,
    generationBasis?: { workspaceRevision: number },
    selectedOriginals: readonly string[] = [],
    kind: "canonical" | "originals_export" = "canonical",
    parent?: Row,
  ) {
    // Only the private zip() call copies a reviewed parent for original export.
    // It still performs a fresh full analysis check in build(), before lease
    // acquisition/render/storage, and another after rendering. Canonical report
    // creation and editing must validate before publishing their visible body.
    if (
      kind === "originals_export" &&
      (!review.parentReportId || !selectedOriginals.length || parent?.id !== review.parentReportId)
    )
      throw new ReportError("VALIDATION_ERROR");
    idempotencyKeySchema.parse(key);
    await requireReportConsent(core, a);
    const replay = await accounting.findOperation(a, route, key, requestHash);
    if (replay?.kind === "conflict") throw new ReportError("IDEMPOTENCY_CONFLICT");
    if (replay?.kind === "replay") {
      // A ZIP replay still requires current parent sources. New export copies
      // perform this same check below, before staging; do not read both here
      // and in zip() for every new copy.
      if (
        review.parentReportId &&
        review.sourceDigest !== (await sourceDigest(core, a, caseId, reportSourceOptions(review)))
      )
        throw new ReportError("STALE_REVISION");
      const previous = await core
        .statement("SELECT id FROM v2_reports WHERE operation_id=?", [replay.operation.id])
        .first<string>("id");
      if (!previous) throw new ReportError("NOT_FOUND");
      return previous;
    }
    const current = await ownedWorkspace(core, a, caseId);
    if (generationBasis && generationBasis.workspaceRevision !== current.revision)
      throw new ReportError("STALE_REVISION");
    if (current.status !== "active" || !current.confirmed_summary_revision)
      throw new ReportError("REVIEW_REQUIRED");
    // Current ownership/S/status was read immediately above. Hash freshly read
    // source rows with that basis; the publication claim still compares current
    // W/S/owner and the parent identity atomically after encryption.
    const currentDigest =
      kind === "canonical"
        ? await sourceDigest(core, a, caseId, reportSourceOptions(review))
        : await reportSourceDigest(
            current.confirmed_summary_revision,
            current.status,
            await reportSourceRows(core, a, caseId, undefined, reportSourceOptions(review)),
            reportSourceOptions(review),
          );
    if (review.sourceDigest !== currentDigest) throw new ReportError("STALE_REVISION");
    if (kind === "canonical") await checkAnalysis(a, caseId, review);
    const id = review.parentReportId ? `export-${crypto.randomUUID()}` : crypto.randomUUID();
    // A bounded copy of an already read private body can be encrypted in the
    // publication batch. Visible canonical reports and larger copies retain
    // their existing staged/checked path and limits.
    const inlineBody =
      kind === "originals_export" && utf8Bytes(JSON.stringify(body)) <= 98304
        ? v2ReportBodySchema(deps.guideHosts).parse(body)
        : null;
    const inlineText = inlineBody ? JSON.stringify(inlineBody) : null;
    const snapshotId = inlineBody
      ? crypto.randomUUID()
      : await stage(a, caseId, current.revision, id, body);
    const request = v2ReportCreateRequestSchema.parse({
      expectedRevision: current.revision,
      selectedFileIds: body.selectedFiles.map((f) => f.id),
      editedFields: [],
      maskingChoices: [],
      reviewConfirmed: true,
      includeOriginals: selectedOriginals.length > 0,
      ...(selectedOriginals.length
        ? { originalsUnmaskedAcknowledged: true, selectedOriginalFileIds: selectedOriginals }
        : {}),
    });
    const operationId = crypto.randomUUID(),
      jobId = `native-v1-report-${crypto.randomUUID()}`,
      claimId = crypto.randomUUID();
    const payload = await core.encrypt("v2_reports", id, a.ownerId, version, { request });
    const g = { ...a, workspaceId: caseId, expectedRevision: current.revision };
    const selections = [];
    for (const file of body.selectedFiles) {
      const actual = await reportFile(core, a, file.id);
      if (
        actual?.status !== "ready" ||
        actual.revision !== file.revision ||
        actual.name !== file.name ||
        actual.manifest?.contentHash !== file.contentHash ||
        actual.manifest.byteLength !== file.byteLength
      )
        throw new ReportError("STALE_REVISION");
      const sid = crypto.randomUUID();
      selections.push({
        id: sid,
        fileId: file.id,
        revision: file.revision,
        ordinal: selections.length,
        original: selectedOriginals.includes(file.id) ? 1 : 0,
        encrypted: await core.encrypt("v2_report_selections", sid, a.ownerId, 1, file),
      });
    }
    const reviewId = crypto.randomUUID();
    const session = reportSessionFence(deps.sessionId);
    const statements = [
      core.claim(
        g,
        claimId,
        `w.status='active' AND w.current_job_id IS NULL AND coalesce((SELECT value FROM app_metadata WHERE key='account-type:'||w.owner_id),'customer') IN ('customer','lawyer') AND EXISTS(SELECT 1 FROM user_consents WHERE user_id=w.owner_id AND terms_version=? AND privacy_version=? AND ai_notice_version=?) AND w.confirmed_summary_revision=? AND ${inlineBody ? "NOT EXISTS(SELECT 1 FROM v2_private_snapshots WHERE id=?)" : "EXISTS(SELECT 1 FROM v2_private_snapshots WHERE id=? AND owner_id=w.owner_id AND workspace_revision=w.revision AND state='sealed')"} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='report' AND target_id=?) AND NOT EXISTS(SELECT 1 FROM v2_idempotency WHERE owner_id=w.owner_id AND route=? AND key=? AND expires_at>?) AND coalesce((SELECT max(revision) FROM v2_reports WHERE workspace_id=w.id AND id NOT LIKE 'export-%'),0)=? ${parent ? "AND EXISTS(SELECT 1 FROM v2_reports parent WHERE parent.id=? AND parent.workspace_id=w.id AND parent.revision=? AND parent.snapshot_id=? AND parent.encrypted_payload=? AND parent.workspace_revision=? AND parent.summary_revision=? AND parent.operation_id=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='report' AND target_id=parent.id))" : ""} ${session.sql}`,
        [
          CURRENT_POLICY_VERSIONS.termsVersion,
          CURRENT_POLICY_VERSIONS.privacyVersion,
          CURRENT_POLICY_VERSIONS.aiNoticeVersion,
          current.confirmed_summary_revision,
          snapshotId,
          id,
          route,
          key,
          a.now,
          parent?.latest_canonical_revision ??
            (review.parentReportId ? ((await latest(a, caseId))?.revision ?? 0) : version - 1),
          ...(parent
            ? [
                parent.id,
                parent.revision,
                parent.snapshot_id,
                parent.encrypted_payload,
                parent.workspace_revision,
                parent.summary_revision,
                parent.operation_id,
              ]
            : []),
          ...session.values,
        ],
      ),
      ...operationStatements(
        core,
        a,
        {
          id: operationId,
          workspaceId: caseId,
          kind: "report",
          revision: current.revision,
          route,
          key,
          requestHash,
        },
        claimId,
      ),
      ...(inlineBody
        ? await snapshotStatements(
            core,
            {
              id: snapshotId,
              ownerId: a.ownerId,
              workspaceId: caseId,
              targetId: id,
              purpose: "report",
              revision: current.revision,
              now: a.now,
            },
            inlineBody,
            claimId,
          )
        : []),
      core.statement(
        `UPDATE v2_private_snapshots SET state='published'${inlineBody ? ",workspace_revision=?" : ""} WHERE id=? AND ${sqlClaim}`,
        [...(inlineBody ? [current.revision] : []), snapshotId, claimId],
      ),
      ...(await snapshotStatements(
        core,
        {
          id: reviewId,
          ownerId: a.ownerId,
          workspaceId: caseId,
          targetId: id,
          purpose: "report",
          revision: current.revision + 1,
          now: a.now,
        },
        reportReviewSchema.parse(review),
        claimId,
      )),
      core.statement(
        `INSERT INTO v2_reports(id,revision,workspace_id,workspace_revision,summary_revision,snapshot_id,operation_id,state,current_job_id,encrypted_payload,created_at) SELECT ?,?,?,?,?,?,?,'queued',?,?,? WHERE ${sqlClaim}`,
        [
          id,
          version,
          caseId,
          current.revision,
          current.confirmed_summary_revision,
          snapshotId,
          operationId,
          jobId,
          payload,
          a.now,
          claimId,
        ],
      ),
      core.statement(
        `INSERT INTO v2_report_selections(id,report_id,file_id,file_revision,original_selected,ordinal,encrypted_payload) SELECT json_extract(value,'$.id'),?,f.id,f.revision,json_extract(value,'$.original'),json_extract(value,'$.ordinal'),json_extract(value,'$.encrypted') FROM json_each(?) JOIN v2_files f ON f.id=json_extract(value,'$.fileId') WHERE f.workspace_id=? AND f.revision=json_extract(value,'$.revision') AND f.state='ready' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id) AND ${sqlClaim}`,
        [id, JSON.stringify(selections), caseId, claimId],
      ),
      core.statement(
        `UPDATE v2_mutation_claims SET verified=CASE WHEN (SELECT count(*) FROM v2_report_selections WHERE report_id=?)=? ${inlineText ? "AND EXISTS(SELECT 1 FROM v2_private_snapshots s WHERE s.id=? AND s.owner_id=? AND s.workspace_id=? AND s.target_id=? AND s.purpose='report' AND s.revision=? AND s.workspace_revision=s.revision AND s.state='published' AND s.part_count=? AND s.byte_length=? AND (SELECT count(*) FROM v2_private_parts p WHERE p.snapshot_id=s.id)=s.part_count AND (SELECT min(p.part_index) FROM v2_private_parts p WHERE p.snapshot_id=s.id)=0 AND (SELECT max(p.part_index) FROM v2_private_parts p WHERE p.snapshot_id=s.id)=s.part_count-1 AND (SELECT sum(p.byte_length) FROM v2_private_parts p WHERE p.snapshot_id=s.id)=s.byte_length)" : ""} THEN 1 ELSE 0 END WHERE id=?`,
        [
          id,
          selections.length,
          ...(inlineText
            ? [
                snapshotId,
                a.ownerId,
                caseId,
                id,
                current.revision,
                fragmentText(inlineText).length,
                utf8Bytes(inlineText),
              ]
            : []),
          claimId,
        ],
      ),
      ...jobInsertStatements(
        core,
        a,
        {
          schemaVersion: "2",
          id: jobId,
          operationId,
          target: { kind: "report", caseId, reportId: id, snapshotRevision: current.revision },
          kind: "report_build",
          status: "queued",
          phase: "admission",
          progressPercent: 0,
          attempts: 0,
          failure: null,
          retryable: false,
          updatedAt: a.now,
        },
        claimId,
      ),
      core.bump(g, claimId),
      core.finish(claimId),
    ];
    try {
      if (!(await core.changed(statements))) {
        await requireReportConsent(core, a);
        throw new ReportError("STALE_REVISION");
      }
    } catch (error) {
      const receipt = await accounting.findOperation(a, route, key, requestHash);
      if (receipt?.kind === "replay") {
        const previous = await core
          .statement("SELECT id FROM v2_reports WHERE operation_id=?", [receipt.operation.id])
          .first<string>("id");
        if (previous) return previous;
      }
      throw error;
    }
    return id;
  }
  const exports = createReportExports(core, deps, { row, read, canonical, actor, checkAnalysis });
  return {
    /** Opt-in, read-only entry point. Opening a conversation panel creates nothing. */
    async peek(ownerId: string, caseId: string) {
      const a = actor(ownerId),
        prior = await latest(a, caseId);
      if (!prior) return null;
      const value = await view(a, prior.id),
        data = await read(a, prior.id);
      return { ...value, analysisReview: reportAnalysisSummary(data.review.analysis) };
    },
    async get(ownerId: string, caseId: string) {
      const a = actor(ownerId),
        prior = await reportReadStep("latest", () => latest(a, caseId));
      if (prior) return reportReadStep("view", () => view(a, prior.id));
      const source = await reportReadStep("source", () =>
        preparedSource(a, caseId, [], false, true),
      );
      const review: ReportReviewData = {
        format: "client_review_v1",
        title: source.display.title ?? "내 사건 이해와 해결 준비",
        content: sourceContent(source),
        excludedFileIds: [],
        maskIdentifiers: false,
        sourceDigest: source.digest,
        parentReportId: null,
        ...(source.analysis
          ? {
              sourceFormat: "analysis_sources_v1" as const,
              analysis: source.analysis,
              analysisIdentity: source.analysisIdentity,
            }
          : {}),
      };
      const id = await reportReadStep("create", () =>
        createRecord(
          a,
          caseId,
          `initial-${source.digest}`,
          source.digest,
          `/api/v2/cases/${caseId}/reports`,
          source.body,
          review,
          1,
          { workspaceRevision: source.current.revision },
        ),
      );
      return reportReadStep("view", () => view(a, id));
    },
    async save(ownerId: string, caseId: string, key: string, input: unknown) {
      const value = saveReportSchema.parse(input),
        a = actor(ownerId),
        path = `/api/v2/cases/${caseId}/reports`;
      const identity = { method: "PATCH", ...value };
      // Retain existing small-request receipt identities. A 30,000-character
      // Korean review exceeds the generic financial-proof bound; hash its exact
      // UTF-8 content before composing a bounded, versioned request identity.
      const hash =
        utf8Bytes(JSON.stringify(identity)) <= 65536
          ? await runtimeDigest(identity)
          : await runtimeDigest({
              ...identity,
              format: "large_report_review_v1",
              content: Array.from(
                new Uint8Array(
                  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.content)),
                ),
                (byte) => byte.toString(16).padStart(2, "0"),
              ).join(""),
            });
      const replay = await accounting.findOperation(a, path, key, hash);
      if (replay?.kind === "conflict") throw new ReportError("IDEMPOTENCY_CONFLICT");
      if (replay?.kind === "replay") {
        const id = await core
          .statement("SELECT id FROM v2_reports WHERE operation_id=?", [replay.operation.id])
          .first<string>("id");
        if (!id) throw new ReportError("NOT_FOUND");
        return view(a, id);
      }
      const prior = await latest(a, caseId);
      if (!prior || prior.revision !== value.expectedRevision)
        throw new ReportError("STALE_REVISION");
      const old = await read(a, prior.id);
      if (
        old.review.sourceDigest !==
        (await sourceDigest(core, a, caseId, reportSourceOptions(old.review)))
      )
        throw new ReportError("STALE_REVISION");
      await checkAnalysis(a, caseId, old.review);
      const source = await preparedSource(a, caseId, value.excludedFileIds, value.maskIdentifiers);
      // Exclusions rebuild source-derived text so material cannot survive in a stale free-text
      // copy. The previous immutable report retains any earlier manual editing.
      const exclusionsChanged =
        JSON.stringify([...value.excludedFileIds].sort()) !==
        JSON.stringify([...old.review.excludedFileIds].sort());
      const maskingChanged =
        old.review.analysis !== undefined && value.maskIdentifiers !== old.review.maskIdentifiers;
      const scopeChanged = exclusionsChanged || maskingChanged;
      if (scopeChanged && value.content !== old.review.content)
        throw new ReportError("EDITS_REQUIRE_SAVE");
      const inlinePhotos = reportMarkdownBlocks(
        scopeChanged ? sourceContent(source) : value.content,
      ).filter((block) => block.kind === "photo");
      const includedPhotoIds =
        value.includedPhotoIds ??
        (inlinePhotos.length ? reportPhotoIds(value.content) : (old.review.includedPhotoIds ?? []));
      if (inlinePhotos.some((photo) => !includedPhotoIds.includes(photo.id)))
        throw new ReportError("VALIDATION_ERROR");
      if (
        inlinePhotos.length > 12 ||
        inlinePhotos.reduce(
          (sum, photo) =>
            sum + (source.body.selectedFiles.find((file) => file.id === photo.id)?.byteLength ?? 0),
          0,
        ) > 8_000_000
      )
        throw new ReportError("EXPORT_LIMIT_EXCEEDED");
      await validatePhotos(core, a, source.body, includedPhotoIds, value.excludedFileIds);
      const analysis = scopeChanged
        ? (source.analysis ?? (old.review.analysis ? missingReportAnalysis() : undefined))
        : old.review.analysis
          ? {
              ...old.review.analysis,
              userEdited: old.review.analysis.userEdited || value.content !== old.review.content,
            }
          : source.analysis
            ? missingReportAnalysis()
            : undefined;
      const review = {
        ...old.review,
        ...value,
        includedPhotoIds,
        content: scopeChanged
          ? sourceContent(source)
          : old.review.analysis && value.content !== old.review.content
            ? markReportAnalysisEdited(value.content)
            : value.content,
        format: "client_review_v1" as const,
        sourceDigest: source.digest,
        ...(analysis ? { analysis } : {}),
        ...(source.analysis ? { sourceFormat: "analysis_sources_v1" as const } : {}),
        ...(source.analysisIdentity !== undefined
          ? { analysisIdentity: source.analysisIdentity }
          : {}),
      };
      const { expectedRevision: _, ...persisted } = review;
      const id = await createRecord(
        a,
        caseId,
        key,
        hash,
        path,
        source.body,
        persisted,
        prior.revision + 1,
      );
      return view(a, id);
    },
    async generate(ownerId: string, caseId: string, key: string, input: unknown) {
      const value = generateReportSchema.parse(input),
        a = actor(ownerId),
        path = `/api/v2/cases/${caseId}/reports`,
        hash = await runtimeDigest({ method: "POST", ...value });
      const replay = await accounting.findOperation(a, path, key, hash);
      if (replay?.kind === "conflict") throw new ReportError("IDEMPOTENCY_CONFLICT");
      if (replay?.kind === "replay") {
        const id = await core
          .statement("SELECT id FROM v2_reports WHERE operation_id=?", [replay.operation.id])
          .first<string>("id");
        if (!id) throw new ReportError("NOT_FOUND");
        return view(a, id);
      }
      const prior = await latest(a, caseId);
      if (
        (value.expectedRevision === null && prior) ||
        (value.expectedRevision !== undefined &&
          value.expectedRevision !== null &&
          value.expectedRevision !== prior?.revision)
      )
        throw new ReportError("STALE_REVISION");
      const old = prior && hasPreparedReader ? await read(a, prior.id) : null;
      const excludedFileIds = value.excludedFileIds ?? old?.review.excludedFileIds ?? [];
      const maskIdentifiers = old?.review.maskIdentifiers ?? false;
      const source = await preparedSource(a, caseId, excludedFileIds, maskIdentifiers, true);
      const retainedPhotoIds =
        old?.review.includedPhotoIds?.filter((id) => {
          const previous = old.body.selectedFiles.find((file) => file.id === id);
          return (
            previous &&
            source.body.selectedFiles.some(
              (file) =>
                file.id === id &&
                file.revision === previous.revision &&
                file.contentHash === previous.contentHash,
            )
          );
        }) ?? [];
      const review: ReportReviewData = {
        format: "client_review_v1",
        title: source.display.title ?? "내 사건 이해와 해결 준비",
        content: sourceContent(source),
        excludedFileIds,
        maskIdentifiers,
        ...(old ? { includedPhotoIds: retainedPhotoIds } : {}),
        sourceDigest: source.digest,
        parentReportId: null,
        ...(source.analysis
          ? {
              sourceFormat: "analysis_sources_v1" as const,
              analysis: source.analysis,
              analysisIdentity: source.analysisIdentity,
            }
          : {}),
      };
      const id = await createRecord(
        a,
        caseId,
        key,
        hash,
        path,
        source.body,
        review,
        (prior?.revision ?? 0) + 1,
        { workspaceRevision: source.current.revision },
      );
      return view(a, id);
    },
    async pdf(ownerId: string, id: string) {
      return exports.pdf(actor(ownerId), id);
    },
    async photo(ownerId: string, id: string, fileId: string) {
      const a = actor(ownerId),
        data = await read(a, id);
      opaqueIdSchema.parse(fileId);
      const selected = data.body.selectedFiles.find((file) => file.id === fileId);
      if (!selected || data.review.excludedFileIds.includes(fileId) || data.review.maskIdentifiers)
        throw new ReportError("NOT_FOUND");
      const authorize = async () => {
        await row(actor(ownerId), id);
        await ownedWorkspace(core, actor(ownerId), data.row.workspace_id);
        const current = await core
          .statement(
            "SELECT count(*) AS n FROM v2_files f WHERE f.id=? AND f.workspace_id=? AND f.revision=? AND f.state='ready' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id)",
            [fileId, data.row.workspace_id, selected.revision],
          )
          .first<number>("n");
        if (current !== 1) throw new ReportError("STALE_REVISION");
      };
      const photos = await loadReportPhotos(
        core,
        a,
        data.row.workspace_id,
        data.body,
        data.review.content,
        [opaqueIdSchema.parse(fileId)],
        data.review.excludedFileIds,
        deps.files,
        authorize,
      );
      const photo = photos[0];
      if (!photo) throw new ReportError("NOT_FOUND");
      const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/u.exec(photo.dataUrl);
      if (!match?.[1] || !match[2]) throw new ReportError("STORAGE_UNAVAILABLE");
      const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
      await authorize();
      return { bytes, contentType: match[1] };
    },
    async html(ownerId: string, id: string) {
      const a = actor(ownerId);
      const report = await view(a, id);
      const data = await read(a, id);
      const authorize = async () => {
        await row(a, id);
        await ownedWorkspace(core, a, data.row.workspace_id);
        const selectedPhotos = data.body.selectedFiles.filter((file) =>
          data.review.includedPhotoIds?.includes(file.id),
        );
        const current = await core
          .statement(
            "SELECT count(*) AS n FROM v2_files f JOIN json_each(?) selected ON f.id=json_extract(selected.value,'$.id') AND f.revision=json_extract(selected.value,'$.revision') WHERE f.workspace_id=? AND f.state='ready' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id)",
            [
              JSON.stringify(
                selectedPhotos.map((file) => ({ id: file.id, revision: file.revision })),
              ),
              data.row.workspace_id,
            ],
          )
          .first<number>("n");
        if (current !== selectedPhotos.length) throw new ReportError("STALE_REVISION");
      };
      const photos =
        report.maskIdentifiers || !data.review.includedPhotoIds?.length
          ? []
          : await loadReportPhotos(
              core,
              a,
              data.row.workspace_id,
              data.body,
              data.review.content,
              data.review.includedPhotoIds,
              data.review.excludedFileIds,
              deps.files,
              authorize,
            );
      const document = createReportHtml({ ...report, photos });
      // Saved-report presentation only; no new AI processing, report revision or blob.
      // Recheck ownership and deletion after all asynchronous source reads.
      await row(a, id);
      return document;
    },
    async savedZip(ownerId: string, id: string) {
      const a = actor(ownerId),
        data = await read(a, id);
      const parentId = data.review.parentReportId;
      if (!parentId) throw new ReportError("NOT_FOUND");
      const parent = await row(a, parentId);
      if (parent.workspace_id !== data.row.workspace_id || parent.revision !== data.row.revision)
        throw new ReportError("NOT_FOUND");
      return exports.storedZip(a, id, parentId);
    },
    async zip(ownerId: string, id: string, key: string, selectedFileIds: readonly string[]) {
      const a = actor(ownerId),
        data = await read(a, id);
      validateOriginalSelection(data.body, data.review.excludedFileIds, selectedFileIds);
      const exportId = await createRecord(
        a,
        data.row.workspace_id,
        key,
        await runtimeDigest({ id, selectedFileIds }),
        `/api/v2/reports/${id}/zip`,
        data.body,
        { ...data.review, parentReportId: id },
        data.row.revision,
        undefined,
        selectedFileIds,
        "originals_export",
        data.row,
      );
      return exports.zip(a, exportId, selectedFileIds, id);
    },
    renderText: (review: ReportReviewData) =>
      review.maskIdentifiers ? maskReportText(review.content) : review.content,
  };
}
export type ReportsService = ReturnType<typeof createReportsService>;
