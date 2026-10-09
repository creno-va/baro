import { z } from "zod";
import { idempotencyKeySchema, opaqueIdSchema } from "../../../contracts";
import { CURRENT_POLICY_VERSIONS } from "../../../contracts/consent";
import {
  v2CoverageSchema,
  v2FileObservationSchema,
  v2ObservationEditRequestSchema,
} from "../../../contracts/v2";
import { type Actor, aliveWorkspace, readSnapshot, type V2Core } from "../../db/v2-core";
import { createV2FileEditsRepository } from "../../db/v2-file-edits";
import { createV2FileStagingRepository } from "../../db/v2-file-staging";
import { createV2FilesRepository } from "../../db/v2-files";
import { digest } from "./binary";

export class FileReviewError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "STALE_REVISION" | "CONSENT_REQUIRED" | "INVALID_STATE",
  ) {
    super(code);
  }
}
const consentSql = `EXISTS(SELECT 1 FROM user_consents c WHERE c.user_id=w.owner_id AND c.terms_version=? AND c.privacy_version=? AND c.ai_notice_version=? AND c.over_14_confirmed=1) AND coalesce((SELECT value FROM app_metadata WHERE key='account-type:'||w.owner_id),'customer')='customer'`;
const consentValues = [
  CURRENT_POLICY_VERSIONS.termsVersion,
  CURRENT_POLICY_VERSIONS.privacyVersion,
  CURRENT_POLICY_VERSIONS.aiNoticeVersion,
];
type Stage = {
  id: string;
  source_revision: number;
  target_revision: number;
  workspace_revision: number;
  target_coverage_id: string;
  observation_count: number;
  derivative_count: number;
  expires_at: string;
  coverage_count: number;
  coverage_done: number;
  observations_done: number;
  derivatives_done: number;
};
export function fileRecovery(code: string | null) {
  if (!code) return null;
  const details: Record<string, [string, string[]]> = {
    FILE_REJECTED: [
      "파일 형식이나 내용을 처리할 수 없어요.",
      ["replace_file", "download_original", "delete"],
    ],
    UPLOAD_EXPIRED: [
      "업로드 시간이 만료됐어요. 파일을 다시 선택해 주세요.",
      ["replace_file", "delete"],
    ],
    COVERAGE_INCOMPLETE: [
      "일부 페이지나 시간 구간을 처리하지 못했어요. 표시된 위치를 원본과 확인해 주세요.",
      ["review_original", "retry", "delete"],
    ],
    BUDGET_UNAVAILABLE: [
      "현재 처리 예산을 사용할 수 없어요. 잠시 후 다시 확인해 주세요.",
      ["wait", "download_original", "delete"],
    ],
    USER_QUOTA_EXCEEDED: [
      "저장 공간이 부족해요. 불필요한 자료를 정리해 주세요.",
      ["free_storage", "delete"],
    ],
    CRYPTO_DECRYPT_FAILED: [
      "저장한 자료를 안전하게 읽지 못했어요. 다시 업로드하거나 지원을 요청해 주세요.",
      ["replace_file", "contact_support", "delete"],
    ],
    POLICY_REJECTED: [
      "요청한 처리를 제공할 수 없어요. 자료 내용을 확인해 주세요.",
      ["review_original", "delete"],
    ],
  };
  const [message, actions] = details[code] ?? [
    "자료 처리를 완료하지 못했어요. 원본은 보관돼요. 다시 시도하거나 원본을 확인해 주세요.",
    ["retry", "download_original", "delete"],
  ];
  return { code, message, actions };
}
/** Existing encrypted staging tables hold resumable corrections; one request copies at most
 * one coverage fragment and four observations/derivatives. No new jobs or AI calls. */
export function createFileReviewService(core: V2Core, clock = () => new Date().toISOString()) {
  const files = createV2FilesRepository(core),
    pages = createV2FileStagingRepository(core);
  const guarded: V2Core = {
    ...core,
    claim: (g, id, extra = "1", values = []) =>
      core.claim(g, id, `(${extra}) AND ${consentSql} AND w.status='active'`, [
        ...values,
        ...consentValues,
      ]),
  };
  const edits = createV2FileEditsRepository(guarded);
  const actor = (ownerId: string): Actor => ({
    ownerId: opaqueIdSchema.parse(ownerId),
    now: clock(),
  });
  async function owned(a: Actor, caseId: string, fileId: string) {
    opaqueIdSchema.parse(caseId);
    opaqueIdSchema.parse(fileId);
    const row = await core
      .statement(
        `SELECT w.revision workspace_revision,f.revision,f.coverage_snapshot_id FROM v2_files f JOIN v2_workspaces w ON w.id=f.workspace_id WHERE f.id=? AND w.id=? AND w.owner_id=? AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id)`,
        [fileId, caseId, a.ownerId],
      )
      .first<{
        workspace_revision: number;
        revision: number;
        coverage_snapshot_id: string | null;
      }>();
    if (!row) throw new FileReviewError("NOT_FOUND");
    return row;
  }
  const stage = (a: Actor, caseId: string, fileId: string, id?: string) =>
    core
      .statement(
        `SELECT e.*,(SELECT part_count FROM v2_private_snapshots WHERE id=e.source_coverage_id) coverage_count,(SELECT count(*) FROM v2_file_edit_receipts WHERE stage_id=e.id AND kind='coverage') coverage_done,(SELECT count(*) FROM v2_file_edit_receipts WHERE stage_id=e.id AND kind='observation') observations_done,(SELECT count(*) FROM v2_file_edit_receipts WHERE stage_id=e.id AND kind='derivative') derivatives_done FROM v2_file_edit_stages e WHERE e.owner_id=? AND e.workspace_id=? AND e.file_id=? ${id ? "AND e.id=?" : ""} ORDER BY e.source_revision DESC LIMIT 1`,
        [a.ownerId, caseId, fileId, ...(id ? [id] : [])],
      )
      .first<Stage>();
  function progress(s: Stage, workspaceRevision: number) {
    return {
      reviewId: s.id,
      status:
        s.expires_at <= clock() || s.workspace_revision !== workspaceRevision
          ? ("conflict" as const)
          : ("saving" as const),
      revision: s.source_revision,
      workspaceRevision: s.workspace_revision,
      completed: s.coverage_done + s.observations_done + s.derivatives_done,
      total: s.coverage_count + s.observation_count + s.derivative_count,
    };
  }
  async function requireConsent(a: Actor, caseId: string) {
    if (
      !(await core
        .statement(
          `SELECT 1 FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND ${consentSql}`,
          [caseId, a.ownerId, ...consentValues],
        )
        .first())
    )
      throw new FileReviewError("CONSENT_REQUIRED");
  }
  const complete = (
    fileId: string,
    reviewId: string,
    revision: number,
    workspaceRevision: number,
  ) => ({
    fileId,
    reviewId,
    status: "ready" as const,
    revision,
    workspaceRevision,
    completed: 1,
    total: 1,
  });
  async function advance(ownerId: string, caseId: string, fileId: string, reviewId: string) {
    opaqueIdSchema.parse(reviewId);
    const a = actor(ownerId),
      current = await owned(a, caseId, fileId);
    await requireConsent(a, caseId);
    const s = await stage(a, caseId, fileId, reviewId);
    if (!s) {
      if (current.coverage_snapshot_id === `coverage-${reviewId}`)
        return complete(fileId, reviewId, current.revision, current.workspace_revision);
      throw new FileReviewError("NOT_FOUND");
    }
    if (progress(s, current.workspace_revision).status === "conflict")
      throw new FileReviewError("STALE_REVISION");
    const g = { ...a, workspaceId: caseId, expectedRevision: s.workspace_revision };
    if (
      s.coverage_done < s.coverage_count &&
      !(await edits.copyCoveragePart(g, s.id, s.coverage_done))
    )
      throw new FileReviewError("STALE_REVISION");
    if (
      (s.observations_done < s.observation_count || s.derivatives_done < s.derivative_count) &&
      !(await edits.copyPage(g, s.id, {
        observationOrdinal: s.observations_done,
        derivativeOrdinal: s.derivatives_done,
      }))
    )
      throw new FileReviewError("STALE_REVISION");
    const next = await stage(a, caseId, fileId, reviewId);
    if (!next) throw new FileReviewError("STALE_REVISION");
    if (
      next.coverage_done === next.coverage_count &&
      next.observations_done === next.observation_count &&
      next.derivatives_done === next.derivative_count
    ) {
      if (!(await edits.publish(g, s.id))) throw new FileReviewError("STALE_REVISION");
      const final = await owned(a, caseId, fileId);
      return complete(fileId, reviewId, final.revision, final.workspace_revision);
    }
    return { fileId, ...progress(next, current.workspace_revision) };
  }
  return {
    async read(ownerId: string, caseId: string, fileId: string, afterOrdinal = -1) {
      z.number().int().min(-1).max(9999).parse(afterOrdinal);
      const a = actor(ownerId),
        before = await owned(a, caseId, fileId),
        file = await files.metadata(a, fileId);
      if (!file) throw new FileReviewError("NOT_FOUND");
      const coverage = before.coverage_snapshot_id
        ? await readSnapshot(
            core,
            a,
            before.coverage_snapshot_id,
            "file_coverage",
            fileId,
            before.revision,
            v2CoverageSchema,
          )
        : null;
      const observations = [];
      for (const entry of await pages.observations(a, fileId, afterOrdinal, 4)) {
        const original = await core
          .statement(
            `SELECT o.id,o.revision,o.encrypted_payload FROM v2_file_observations o WHERE o.file_id=? AND o.entity_id=? AND o.file_revision<=? AND (o.snapshot_id IS NULL OR EXISTS(SELECT 1 FROM v2_private_snapshots s WHERE s.id=o.snapshot_id AND s.state='published')) ORDER BY o.file_revision LIMIT 1`,
            [fileId, entry.value.id, before.revision],
          )
          .first<{ id: string; revision: number; encrypted_payload: string }>();
        if (!original) throw new FileReviewError("INVALID_STATE");
        observations.push({
          ...entry,
          original: await core.decrypt(
            "v2_file_observations",
            original.id,
            ownerId,
            original.revision,
            original.encrypted_payload,
            v2FileObservationSchema,
          ),
        });
      }
      const last = observations.at(-1)?.ordinal ?? afterOrdinal;
      const more = await core
        .statement(
          "SELECT 1 FROM v2_file_observations WHERE file_id=? AND file_revision=? AND ordinal>? LIMIT 1",
          [fileId, before.revision, last],
        )
        .first();
      const pending = await stage(a, caseId, fileId),
        final = await owned(a, caseId, fileId);
      if (
        final.revision !== before.revision ||
        final.workspace_revision !== before.workspace_revision
      )
        throw new FileReviewError("STALE_REVISION");
      return {
        file,
        workspaceRevision: final.workspace_revision,
        coverage,
        observations,
        nextAfterOrdinal: more ? last : null,
        pendingReview: pending ? { fileId, ...progress(pending, final.workspace_revision) } : null,
        recovery: fileRecovery(file.failure),
      };
    },
    async start(
      ownerId: string,
      caseId: string,
      fileId: string,
      workspaceRevision: number,
      key: string,
      input: unknown,
    ) {
      const request = v2ObservationEditRequestSchema.parse(input),
        a = actor(ownerId);
      idempotencyKeySchema.parse(key);
      const current = await owned(a, caseId, fileId);
      await requireConsent(a, caseId);
      const id = await digest(
        new TextEncoder().encode(JSON.stringify({ ownerId, caseId, fileId, key, request })),
      );
      if (current.coverage_snapshot_id === `coverage-${id}`)
        return complete(fileId, id, current.revision, current.workspace_revision);
      const existing = await stage(a, caseId, fileId);
      if (existing?.id === id) return advance(ownerId, caseId, fileId, id);
      if (
        existing ||
        current.revision !== request.expectedRevision ||
        current.workspace_revision !== workspaceRevision
      )
        throw new FileReviewError("STALE_REVISION");
      if (
        !(await edits.begin(
          { ...a, workspaceId: caseId, expectedRevision: workspaceRevision },
          {
            id,
            fileId,
            request,
            coverageSnapshotId: `coverage-${id}`,
            expiresAt: new Date(Date.parse(a.now) + 30 * 60 * 1000).toISOString(),
          },
        ))
      )
        throw new FileReviewError("STALE_REVISION");
      return advance(ownerId, caseId, fileId, id);
    },
    advance,
    async cancel(ownerId: string, caseId: string, fileId: string, reviewId: string) {
      const a = actor(ownerId),
        current = await owned(a, caseId, fileId);
      const s = await stage(a, caseId, fileId, opaqueIdSchema.parse(reviewId));
      if (!s) throw new FileReviewError("NOT_FOUND");
      // Discarding an unpublished correction remains allowed before re-consent.
      if (
        !(await createV2FileEditsRepository(core).abandon(
          { ...a, workspaceId: caseId, expectedRevision: current.workspace_revision },
          reviewId,
        ))
      )
        throw new FileReviewError("STALE_REVISION");
      return { fileId, reviewId, status: "discarded" as const };
    },
  };
}
