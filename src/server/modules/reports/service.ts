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
import { reportSessionFence, requireReportConsent } from "./fence";
import {
  buildReportSource,
  ownedWorkspace,
  ReportError,
  type ReportReviewData,
  reportFile,
  reportReviewSchema,
  reportText,
  sourceDigest,
  validateOriginalSelection,
} from "./source";
import { createReportExports, type ReportDependencies } from "./storage";

export const saveReportSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  content: z.string().trim().min(1).max(30000),
  maskIdentifiers: z.boolean(),
  excludedFileIds: z
    .array(opaqueIdSchema)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const generateReportSchema = z.strictObject({
  expectedRevision: z.number().int().positive().optional(),
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
  const row = async (a: Actor, id: string) => {
    opaqueIdSchema.parse(id);
    const session = reportSessionFence(deps.sessionId);
    const result = await core
      .statement(
        `SELECT r.* FROM v2_reports r JOIN v2_workspaces w ON w.id=r.workspace_id WHERE r.id=? AND w.owner_id=? AND EXISTS(SELECT 1 FROM user WHERE id=w.owner_id) AND coalesce((SELECT value FROM app_metadata WHERE key='account-type:'||w.owner_id),'customer')='customer' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=w.owner_id) OR (target_kind='workspace' AND target_id=w.id) OR (target_kind='report' AND target_id=r.id)) ${session.sql}`,
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
    const r = await row(a, id);
    const body = await readSnapshot(
      core,
      a,
      r.snapshot_id,
      "report",
      id,
      r.workspace_revision,
      v2ReportBodySchema(deps.guideHosts),
    );
    if (!body) throw new ReportError("NOT_FOUND");
    const reviewHead = await core
      .statement(
        "SELECT id FROM v2_private_snapshots WHERE owner_id=? AND target_id=? AND purpose='report' AND revision=? AND state='published'",
        [a.ownerId, id, r.workspace_revision + 1],
      )
      .first<{ id: string }>();
    const savedReview = reviewHead
      ? await readSnapshot(
          core,
          a,
          reviewHead.id,
          "report",
          id,
          r.workspace_revision + 1,
          reportReviewSchema,
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
    const final = await row(a, id);
    if (r.snapshot_id !== final.snapshot_id || r.revision !== final.revision)
      throw new ReportError("STALE_REVISION");
    return { row: r, body, review };
  };
  const view = async (a: Actor, id: string) => {
    const data = await read(a, id);
    const stale = data.review.sourceDigest !== (await sourceDigest(core, a, data.row.workspace_id));
    const saved = await core
      .statement(
        "SELECT r.id,r.created_at,(SELECT count(*) FROM v2_report_selections WHERE report_id=r.id AND original_selected=1) AS file_count FROM v2_reports r JOIN v2_blobs b ON b.id=r.zip_blob_id WHERE r.workspace_id=? AND r.revision=? AND r.id LIKE 'export-%' AND r.state='ready' AND b.state='stored' AND b.kind='original_zip' ORDER BY r.created_at DESC,r.rowid DESC LIMIT 1",
        [data.row.workspace_id, data.row.revision],
      )
      .first<{ id: string; created_at: string; file_count: number }>();
    const archive = saved ? await read(a, saved.id) : null;
    await row(a, id);
    return {
      ...(saved && archive?.review.parentReportId === id && saved.file_count > 0
        ? { savedZip: { id: saved.id, fileCount: saved.file_count, createdAt: saved.created_at } }
        : {}),
      id,
      caseId: data.row.workspace_id,
      revision: data.row.revision,
      title: data.review.title,
      content: data.review.content,
      updatedAt: data.row.created_at,
      stale,
      basis: {
        workspaceRevision: data.row.workspace_revision,
        summaryRevision: data.row.summary_revision,
        generatedAt: data.body.generatedAt,
      },
      pdfAvailable: data.row.state === "ready" && !!data.row.pdf_blob_id,
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
    selectedOriginals: readonly string[] = [],
  ) {
    idempotencyKeySchema.parse(key);
    await requireReportConsent(core, a);
    const replay = await accounting.findOperation(a, route, key, requestHash);
    if (replay?.kind === "conflict") throw new ReportError("IDEMPOTENCY_CONFLICT");
    if (replay?.kind === "replay") {
      const previous = await core
        .statement("SELECT id FROM v2_reports WHERE operation_id=?", [replay.operation.id])
        .first<string>("id");
      if (!previous) throw new ReportError("NOT_FOUND");
      return previous;
    }
    const current = await ownedWorkspace(core, a, caseId);
    if (current.status !== "active" || !current.confirmed_summary_revision)
      throw new ReportError("REVIEW_REQUIRED");
    if (review.sourceDigest !== (await sourceDigest(core, a, caseId)))
      throw new ReportError("STALE_REVISION");
    const id = review.parentReportId ? `export-${crypto.randomUUID()}` : crypto.randomUUID();
    const snapshotId = await stage(a, caseId, current.revision, id, body);
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
      jobId = `report-local-${crypto.randomUUID()}`,
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
        `w.status='active' AND w.current_job_id IS NULL AND coalesce((SELECT value FROM app_metadata WHERE key='account-type:'||w.owner_id),'customer')='customer' AND EXISTS(SELECT 1 FROM user_consents WHERE user_id=w.owner_id AND terms_version=? AND privacy_version=? AND ai_notice_version=? AND over_14_confirmed=1) AND w.confirmed_summary_revision=? AND EXISTS(SELECT 1 FROM v2_private_snapshots WHERE id=? AND owner_id=w.owner_id AND workspace_revision=w.revision AND state='sealed') AND NOT EXISTS(SELECT 1 FROM v2_idempotency WHERE owner_id=w.owner_id AND route=? AND key=? AND expires_at>?) AND coalesce((SELECT max(revision) FROM v2_reports WHERE workspace_id=w.id AND id NOT LIKE 'export-%'),0)=? ${session.sql}`,
        [
          CURRENT_POLICY_VERSIONS.termsVersion,
          CURRENT_POLICY_VERSIONS.privacyVersion,
          CURRENT_POLICY_VERSIONS.aiNoticeVersion,
          current.confirmed_summary_revision,
          snapshotId,
          route,
          key,
          a.now,
          review.parentReportId ? ((await latest(a, caseId))?.revision ?? 0) : version - 1,
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
      core.statement(
        `UPDATE v2_private_snapshots SET state='published' WHERE id=? AND ${sqlClaim}`,
        [snapshotId, claimId],
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
        "UPDATE v2_mutation_claims SET verified=CASE WHEN (SELECT count(*) FROM v2_report_selections WHERE report_id=?)=? THEN 1 ELSE 0 END WHERE id=?",
        [id, selections.length, claimId],
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
  const exports = createReportExports(core, deps, { row, read, canonical, actor });
  return {
    async get(ownerId: string, caseId: string) {
      const a = actor(ownerId),
        prior = await latest(a, caseId);
      if (prior) return view(a, prior.id);
      const source = await buildReportSource(core, a, caseId, [], deps.guideHosts);
      const review: ReportReviewData = {
        format: "client_review_v1",
        title: "사건 상담 준비 리포트",
        content: reportText(source.body, source.coverage),
        excludedFileIds: [],
        maskIdentifiers: false,
        sourceDigest: source.digest,
        parentReportId: null,
      };
      const id = await createRecord(
        a,
        caseId,
        `initial-${source.digest}`,
        source.digest,
        `/api/v2/cases/${caseId}/reports`,
        source.body,
        review,
        1,
      );
      return view(a, id);
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
      if (old.review.sourceDigest !== (await sourceDigest(core, a, caseId)))
        throw new ReportError("STALE_REVISION");
      const source = await buildReportSource(
        core,
        a,
        caseId,
        value.excludedFileIds,
        deps.guideHosts,
      );
      // Exclusions rebuild source-derived text so material cannot survive in a stale free-text
      // copy. The previous immutable report retains any earlier manual editing.
      const exclusionsChanged =
        JSON.stringify([...value.excludedFileIds].sort()) !==
        JSON.stringify([...old.review.excludedFileIds].sort());
      if (exclusionsChanged && value.content !== old.review.content)
        throw new ReportError("EDITS_REQUIRE_SAVE");
      const review = {
        ...old.review,
        ...value,
        content: exclusionsChanged ? reportText(source.body, source.coverage) : value.content,
        format: "client_review_v1" as const,
        sourceDigest: source.digest,
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
      if (value.expectedRevision !== undefined && value.expectedRevision !== prior?.revision)
        throw new ReportError("STALE_REVISION");
      const source = await buildReportSource(
        core,
        a,
        caseId,
        value.excludedFileIds ?? [],
        deps.guideHosts,
      );
      const review: ReportReviewData = {
        format: "client_review_v1",
        title: "사건 상담 준비 리포트",
        content: reportText(source.body, source.coverage),
        excludedFileIds: value.excludedFileIds ?? [],
        maskIdentifiers: false,
        sourceDigest: source.digest,
        parentReportId: null,
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
      );
      return view(a, id);
    },
    async pdf(ownerId: string, id: string) {
      return exports.pdf(actor(ownerId), id);
    },
    async html(ownerId: string, id: string) {
      const a = actor(ownerId);
      const report = await view(a, id);
      const document = createReportHtml(report);
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
      if (data.review.sourceDigest !== (await sourceDigest(core, a, data.row.workspace_id)))
        throw new ReportError("STALE_REVISION");
      const exportId = await createRecord(
        a,
        data.row.workspace_id,
        key,
        await runtimeDigest({ id, selectedFileIds }),
        `/api/v2/reports/${id}/zip`,
        data.body,
        { ...data.review, parentReportId: id },
        data.row.revision,
        selectedFileIds,
      );
      return exports.zip(a, exportId, selectedFileIds);
    },
    renderText: (review: ReportReviewData) =>
      review.maskIdentifiers ? maskReportText(review.content) : review.content,
  };
}
export type ReportsService = ReturnType<typeof createReportsService>;
