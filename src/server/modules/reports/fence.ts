import { CURRENT_POLICY_VERSIONS } from "../../../contracts/consent";
import { AUTH_RETENTION_MS } from "../../auth/policy";

import { type Actor, aliveWorkspace, type V2Core } from "../../db/v2-core";
import { jobAlive } from "../../db/v2-jobs";
import type { JobLease } from "../../db/v2-workspace";
import {
  ownedWorkspace,
  REPORT_SOURCE_SQL,
  ReportError,
  reportSourceDigest,
  reportSourceRows,
} from "./source";

/** Bind HTTP report work to the exact authenticated session, not any session for its owner. */
export function reportSessionFence(sessionId?: string) {
  const now = Date.now();
  return sessionId
    ? {
        sql: "AND EXISTS(SELECT 1 FROM session request_session WHERE request_session.id=? AND request_session.user_id=w.owner_id AND request_session.expires_at>? AND request_session.created_at>?)",
        values: [sessionId, now, now - AUTH_RETENTION_MS],
      }
    : { sql: "", values: [] };
}

/** Read/decrypt immutable snapshots once. Each stream boundary uses a single
 * indexed SQL fence over the exact source identity, including ciphertext,
 * coverage pointers and official-source expiry. No report AES replay per chunk. */
export async function exportFence(
  core: V2Core,
  actor: Actor,
  report: {
    id: string;
    revision: number;
    workspace_id: string;
    snapshot_id: string;
    encrypted_payload: string;
  },
  digest: string,
  clock: () => string,
  sessionId?: string,
) {
  const workspace = await ownedWorkspace(core, actor, report.workspace_id);
  const rows = await reportSourceRows(core, actor, report.workspace_id);
  if (
    (await reportSourceDigest(workspace.confirmed_summary_revision, workspace.status, rows)) !==
    digest
  )
    throw new ReportError("STALE_REVISION");
  const json = JSON.stringify(
    rows.map((r) => ({ kind: r.kind, id: r.id, revision: r.revision, snapshot: r.snapshot })),
  );
  if (new TextEncoder().encode(json).byteLength > 65536)
    throw new ReportError("EXPORT_LIMIT_EXCEEDED");
  return {
    rows: rows.length,
    async check(lease?: JobLease, blobId?: string) {
      const now = clock(),
        id = report.workspace_id,
        session = reportSessionFence(sessionId);
      const ok = await core
        .statement(
          `WITH source AS (${REPORT_SOURCE_SQL})
        SELECT 1 AS ok FROM v2_reports r JOIN v2_workspaces w ON w.id=r.workspace_id JOIN user u ON u.id=w.owner_id
        WHERE r.id=? AND r.revision=? AND r.snapshot_id=? AND r.encrypted_payload=? AND w.owner_id=? AND w.status='active'
        AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='report' AND target_id=r.id)
        AND coalesce((SELECT value FROM app_metadata WHERE key='account-type:'||w.owner_id),'customer')='customer'
        AND EXISTS(SELECT 1 FROM user_consents c WHERE c.user_id=w.owner_id AND c.terms_version=? AND c.privacy_version=? AND c.ai_notice_version=? AND c.over_14_confirmed=1)
        AND w.confirmed_summary_revision=?
        AND coalesce((SELECT json_group_array(json_object('kind',kind,'id',id,'revision',revision,'snapshot',snapshot)) FROM source),'[]')=?
        AND NOT EXISTS(SELECT 1 FROM v2_tombstones t JOIN source s ON s.kind='file' AND s.id=t.target_id WHERE t.target_kind='file')
        ${lease ? `AND EXISTS(SELECT 1 FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.id=? AND o.owner_id=w.owner_id AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.status IN ('running','validating') AND ${jobAlive})` : ""}
        ${blobId ? "AND EXISTS(SELECT 1 FROM v2_blobs b JOIN v2_storage_reservations x ON x.id=b.reservation_id JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=w.owner_id AND b.state='stored' AND b.visibility='private' AND x.entity_id=r.id AND x.state!='released')" : ""}
        ${session.sql}`,
          [
            id,
            id,
            id,
            id,
            id,
            id,
            id,
            now,
            now,
            now,
            id,
            report.id,
            report.revision,
            report.snapshot_id,
            report.encrypted_payload,
            actor.ownerId,
            CURRENT_POLICY_VERSIONS.termsVersion,
            CURRENT_POLICY_VERSIONS.privacyVersion,
            CURRENT_POLICY_VERSIONS.aiNoticeVersion,
            workspace.confirmed_summary_revision,
            json,
            ...(lease ? [lease.jobId, lease.token, lease.fencing, now] : []),
            ...(blobId ? [blobId] : []),
            ...session.values,
          ],
        )
        .first();
      if (!ok) throw new ReportError("STALE_REVISION");
    },
  };
}

/** Reading an already stored PDF or ZIP does not process current sources. Preserve its historical
 * basis while checking owner/role/deletion/blob identity at every decrypted stream boundary. */
export function storedReportFence(
  core: V2Core,
  actor: Actor,
  report: { id: string; revision: number; snapshot_id: string; encrypted_payload: string },
  blobId: string,
  kind: "report_pdf" | "original_zip",
  parentReportId?: string,
  sessionId?: string,
) {
  const column = kind === "report_pdf" ? "pdf_blob_id" : "zip_blob_id";
  return async () => {
    const session = reportSessionFence(sessionId);
    const ok = await core
      .statement(
        `SELECT 1 FROM v2_reports r JOIN v2_workspaces w ON w.id=r.workspace_id JOIN user u ON u.id=w.owner_id JOIN v2_blobs b ON b.id=r.${column} JOIN v2_storage_reservations x ON x.id=b.reservation_id JOIN v2_billing_principals p ON p.id=b.principal_id WHERE r.id=? AND r.revision=? AND r.snapshot_id=? AND r.encrypted_payload=? AND r.${column}=? AND r.state='ready' AND w.owner_id=? AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='report' AND target_id=r.id) AND coalesce((SELECT value FROM app_metadata WHERE key='account-type:'||w.owner_id),'customer')='customer' AND b.state='stored' AND b.visibility='private' AND b.kind='${kind}' AND p.owner_id=w.owner_id AND x.entity_id=r.id ${parentReportId ? "AND EXISTS(SELECT 1 FROM v2_reports parent WHERE parent.id=? AND parent.workspace_id=w.id AND parent.revision=r.revision AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='report' AND target_id=parent.id))" : ""} AND x.state!='released' AND NOT EXISTS(SELECT 1 FROM v2_report_selections s LEFT JOIN v2_files f ON f.id=s.file_id WHERE s.report_id=r.id AND (f.id IS NULL OR f.workspace_id!=w.id OR EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id))) ${session.sql}`,
        [
          report.id,
          report.revision,
          report.snapshot_id,
          report.encrypted_payload,
          blobId,
          actor.ownerId,
          ...(parentReportId ? [parentReportId] : []),
          ...session.values,
        ],
      )
      .first();
    if (!ok) throw new ReportError("NOT_FOUND");
  };
}
export async function requireReportConsent(core: V2Core, actor: Actor) {
  const ok = await core
    .statement(
      `SELECT 1 FROM user_consents WHERE user_id=? AND terms_version=? AND privacy_version=? AND ai_notice_version=? AND over_14_confirmed=1`,
      [
        actor.ownerId,
        CURRENT_POLICY_VERSIONS.termsVersion,
        CURRENT_POLICY_VERSIONS.privacyVersion,
        CURRENT_POLICY_VERSIONS.aiNoticeVersion,
      ],
    )
    .first();
  if (!ok) throw new ReportError("CONSENT_REQUIRED");
}
