import { z } from "zod";
import { opaqueIdSchema, revisionSchema } from "../../contracts/common";
import {
  aliveWorkspace,
  hashSchema,
  snapshotChain,
  sqlClaim,
  utf8Bytes,
  type V2Core,
  V2RepositoryError,
  type WorkspaceGuard,
} from "./v2-core";
import { reworkManifestSchema } from "./v2-rework";

const identity = z.strictObject({
  format: z.literal("report-export-revision-v1"),
  beforeWorkspaceRevision: revisionSchema,
  reportId: opaqueIdSchema,
  reportVersion: revisionSchema,
  operationId: opaqueIdSchema,
  summaryRevision: revisionSchema,
  snapshotId: opaqueIdSchema,
  reportEnvelopeHash: hashSchema,
});
const storageStep = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("reservation"),
    reservationId: opaqueIdSchema,
    artifactId: opaqueIdSchema,
    byteLength: z.number().int().positive().max(10000000000),
  }),
  z.strictObject({
    kind: z.literal("completion"),
    jobId: opaqueIdSchema,
    pdfId: opaqueIdSchema,
    zipId: opaqueIdSchema.nullable(),
  }),
]);
const proofSchema = identity.extend({ step: storageStep });
type ReportIdentity = {
  id: string;
  revision: number;
  operation_id: string;
  summary_revision: number;
  snapshot_id: string;
  encrypted_payload: string;
};
export const reportRevisionId = async (workspaceId: string, revision: number) =>
  `report-export-${await envelopeHash(JSON.stringify([workspaceId, revision]))}`;
async function envelopeHash(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Only storage reservation/completion producers call this. The existing claim,
 * CAS, report/lease/blob fences and this immutable encrypted proof commit in one
 * batch. No report ciphertext, source snapshot or public DTO is changed. */
export async function reportRevisionStatements(
  core: V2Core,
  g: WorkspaceGuard,
  report: ReportIdentity,
  step: z.infer<typeof storageStep>,
  claimId: string,
) {
  const value = proofSchema.parse({
    format: "report-export-revision-v1",
    beforeWorkspaceRevision: g.expectedRevision,
    reportId: report.id,
    reportVersion: report.revision,
    operationId: report.operation_id,
    summaryRevision: report.summary_revision,
    snapshotId: report.snapshot_id,
    reportEnvelopeHash: await envelopeHash(report.encrypted_payload),
    step,
  });
  const text = JSON.stringify(value),
    bytes = utf8Bytes(text),
    id = await reportRevisionId(g.workspaceId, g.expectedRevision + 1),
    partId = crypto.randomUUID();
  const entityId = report.id,
    revision = g.expectedRevision + 1;
  const manifest = await core.encrypt("v2_rework_records", id, g.ownerId, revision, {
    id,
    workspaceId: g.workspaceId,
    entityId,
    kind: "checkpoint",
    revision,
    partCount: 1,
    byteLength: bytes,
    digest: await snapshotChain("0".repeat(64), 0, text),
  });
  const part = await core.cipher.encrypt(text, {
    table: "v2_rework_parts",
    column: "encrypted_payload",
    rowId: partId,
    userId: g.ownerId,
    revision,
  });
  return [
    core.statement(
      `INSERT INTO v2_rework_records(id,owner_id,workspace_id,kind,entity_id,revision,workspace_revision,state,part_count,byte_length,encrypted_payload,created_at)
      SELECT ?,?,?,'checkpoint',?,?,?,'staging',1,?,?,? WHERE ${sqlClaim}`,
      [
        id,
        g.ownerId,
        g.workspaceId,
        entityId,
        revision,
        g.expectedRevision + 1,
        bytes,
        manifest,
        g.now,
        claimId,
      ],
    ),
    core.statement(
      `INSERT INTO v2_rework_parts(id,record_id,part_index,byte_length,encrypted_payload) SELECT ?,?,0,?,? WHERE ${sqlClaim}`,
      [partId, id, bytes, part, claimId],
    ),
    core.statement(`UPDATE v2_rework_records SET state='published' WHERE id=? AND ${sqlClaim}`, [
      id,
      claimId,
    ]),
  ];
}

export async function readReportRevision(
  core: V2Core,
  ownerId: string,
  workspaceId: string,
  revision: number,
  summaryRevision: number,
  recordId: string,
) {
  if (recordId !== (await reportRevisionId(workspaceId, revision))) return null;
  // This producer always publishes exactly one bounded part. Read the owned
  // header, that part and immutable report envelope in one SQL snapshot, then
  // authenticate the existing manifest/AAD/chain before the final relation read.
  const row = await core
    .statement(
      `SELECT proof.entity_id,proof.byte_length,proof.encrypted_payload,part.id AS part_id,
       part.byte_length AS part_bytes,part.encrypted_payload AS part_envelope,r.encrypted_payload AS report_envelope
       FROM v2_rework_records proof JOIN v2_rework_parts part ON part.record_id=proof.id AND part.part_index=0
       JOIN v2_reports r ON r.id=proof.entity_id AND r.workspace_id=proof.workspace_id
       JOIN v2_workspaces w ON w.id=proof.workspace_id
       WHERE proof.id=? AND proof.owner_id=? AND proof.workspace_id=? AND proof.kind='checkpoint'
       AND proof.revision=? AND proof.workspace_revision=? AND proof.state='published' AND proof.part_count=1
       AND proof.byte_length BETWEEN 1 AND 4096 AND w.owner_id=proof.owner_id AND ${aliveWorkspace}
       AND NOT EXISTS(SELECT 1 FROM v2_rework_parts extra WHERE extra.record_id=proof.id AND extra.part_index!=0)
       AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='report' AND target_id=r.id)`,
      [recordId, ownerId, workspaceId, revision, revision],
    )
    .first<{
      entity_id: string;
      byte_length: number;
      encrypted_payload: string;
      part_id: string;
      part_bytes: number;
      part_envelope: string;
      report_envelope: string;
    }>();
  if (!row) return null;
  const manifest = await core.decrypt(
    "v2_rework_records",
    recordId,
    ownerId,
    revision,
    row.encrypted_payload,
    reworkManifestSchema,
  );
  if (
    manifest.id !== recordId ||
    manifest.workspaceId !== workspaceId ||
    manifest.entityId !== row.entity_id ||
    manifest.kind !== "checkpoint" ||
    manifest.revision !== revision ||
    manifest.partCount !== 1 ||
    manifest.byteLength !== row.byte_length
  )
    throw new V2RepositoryError("SNAPSHOT_INVALID");
  const text = await core.cipher.decrypt(row.part_envelope, {
    table: "v2_rework_parts",
    column: "encrypted_payload",
    rowId: row.part_id,
    userId: ownerId,
    revision,
  });
  if (
    utf8Bytes(text) !== row.part_bytes ||
    row.part_bytes !== manifest.byteLength ||
    (await snapshotChain("0".repeat(64), 0, text)) !== manifest.digest
  )
    throw new V2RepositoryError("SNAPSHOT_INVALID");
  const proof = proofSchema.parse(JSON.parse(text));
  if (
    proof.reportId !== row.entity_id ||
    proof.beforeWorkspaceRevision !== revision - 1 ||
    proof.summaryRevision !== summaryRevision ||
    (await envelopeHash(row.report_envelope)) !== proof.reportEnvelopeHash
  )
    return null;
  const step = proof.step;
  const storedArtifact = (
    kind: "report_pdf" | "original_zip",
    column: "pdf_blob_id" | "zip_blob_id",
  ) =>
    `EXISTS(SELECT 1 FROM v2_blobs b JOIN v2_storage_reservations reservation ON reservation.id=b.reservation_id
      JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=r.${column} AND b.kind='${kind}'
      AND b.visibility='private' AND b.state='stored' AND p.owner_id=w.owner_id AND reservation.principal_id=b.principal_id
      AND reservation.kind='derived_report' AND reservation.workspace_id=w.id AND reservation.entity_id=r.id
      AND reservation.operation_id=r.operation_id AND reservation.target_id=b.id)`;
  const relation =
    step.kind === "reservation"
      ? `EXISTS(SELECT 1 FROM v2_storage_reservations reservation JOIN v2_billing_principals p ON p.id=reservation.principal_id
        WHERE reservation.id=? AND reservation.target_id=? AND reservation.byte_length=? AND reservation.kind='derived_report'
        AND p.owner_id=w.owner_id AND reservation.workspace_id=w.id AND reservation.entity_id=r.id AND reservation.operation_id=r.operation_id)`
      : `r.state IN ('ready','obsolete') AND r.pdf_blob_id=? AND r.zip_blob_id IS ? AND o.state='completed'
       AND j.id=? AND j.status='completed' AND ${storedArtifact("report_pdf", "pdf_blob_id")}
       AND (r.zip_blob_id IS NULL OR ${storedArtifact("original_zip", "zip_blob_id")})`;
  const bound = await core
    .statement(
      `SELECT r.id FROM v2_reports r JOIN v2_workspaces w ON w.id=r.workspace_id
    JOIN v2_operations o ON o.id=r.operation_id JOIN v2_jobs j ON j.operation_id=o.id
    JOIN v2_private_snapshots s ON s.id=r.snapshot_id
    WHERE r.id=? AND r.revision=? AND r.encrypted_payload=? AND r.operation_id=? AND r.snapshot_id=?
    AND r.workspace_id=? AND r.summary_revision=? AND r.workspace_revision<? AND w.owner_id=? AND ${aliveWorkspace}
    AND o.owner_id=w.owner_id AND o.workspace_id=w.id AND o.kind='report' AND o.revision=r.workspace_revision
    AND j.target_kind='report' AND j.target_id=r.id AND j.target_revision=r.workspace_revision AND j.kind='report_build'
    AND s.owner_id=w.owner_id AND s.workspace_id=w.id AND s.target_id=r.id AND s.purpose='report' AND s.revision=r.workspace_revision AND s.state='published'
    AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='report' AND target_id=r.id)
    AND EXISTS(SELECT 1 FROM v2_rework_records proof JOIN v2_rework_parts part ON part.record_id=proof.id
      WHERE proof.id=? AND proof.owner_id=w.owner_id AND proof.workspace_id=w.id AND proof.entity_id=r.id
      AND proof.kind='checkpoint' AND proof.state='published' AND proof.revision=? AND proof.workspace_revision=?
      AND proof.part_count=1 AND proof.byte_length=? AND proof.encrypted_payload=?
      AND part.id=? AND part.part_index=0 AND part.byte_length=? AND part.encrypted_payload=?
      AND NOT EXISTS(SELECT 1 FROM v2_rework_parts extra WHERE extra.record_id=proof.id AND extra.part_index!=0))
    AND (${relation})`,
      [
        proof.reportId,
        proof.reportVersion,
        row.report_envelope,
        proof.operationId,
        proof.snapshotId,
        workspaceId,
        summaryRevision,
        proof.beforeWorkspaceRevision,
        ownerId,
        recordId,
        revision,
        revision,
        row.byte_length,
        row.encrypted_payload,
        row.part_id,
        row.part_bytes,
        row.part_envelope,
        ...(step.kind === "reservation"
          ? [step.reservationId, step.artifactId, step.byteLength]
          : [step.pdfId, step.zipId, step.jobId]),
      ],
    )
    .first();
  return bound ? proof.beforeWorkspaceRevision : null;
}
