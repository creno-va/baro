import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../contracts";
import {
  type V2ObservationEditRequest,
  v2DerivativeSchema,
  v2FileObservationSchema,
  v2FileSchema,
  v2ObservationEditRequestSchema,
  v2OriginalManifestSchema,
} from "../../contracts/v2";
import {
  aliveWorkspace,
  guardSchema,
  hashSchema,
  parse,
  readSnapshot,
  SNAPSHOT_FRAGMENT_BYTES,
  safe,
  snapshotChain,
  sqlClaim,
  utf8Bytes,
  type V2Core,
  type WorkspaceGuard,
} from "./v2-core";

const metadataSchema = z.strictObject({
  name: v2FileSchema.shape.name,
  declaredMediaType: v2FileSchema.shape.declaredMediaType,
  probe: v2FileSchema.shape.probe,
});
const integritySchema = z.strictObject({
  format: z.literal("chain_v1"),
  digest: hashSchema,
  purpose: z.literal("file_coverage"),
  targetId: opaqueIdSchema,
  partCount: z.number().int().positive(),
});
const payloadSchema = z.strictObject({
  fileId: opaqueIdSchema,
  workspaceId: opaqueIdSchema,
  workspaceRevision: z.number().int().positive(),
  sourceRevision: z.number().int().positive(),
  targetRevision: z.number().int().positive(),
  sourceCoverageId: opaqueIdSchema,
  targetCoverageId: opaqueIdSchema,
  expiresAt: timestampSchema,
  observationCount: z.number().int().min(0).max(10000),
  derivativeCount: z.number().int().min(0).max(20000),
  request: v2ObservationEditRequestSchema,
  filePayload: z.string(),
  operationId: opaqueIdSchema,
  manifestId: opaqueIdSchema,
  manifestPayload: z.string(),
  coveragePayload: z.string(),
  coverageIntegrity: integritySchema,
  targetFilePayload: z.string(),
  originalReceipts: z
    .array(
      z.strictObject({
        ordinal: z.number().int().min(0).max(119),
        uploadId: opaqueIdSchema,
        uploadPayload: z.string(),
        partPayload: z.string(),
        blobId: opaqueIdSchema,
        blobPayload: z.string(),
        keyVersion: z.string(),
        cipherHash: hashSchema,
        byteLength: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(120),
});
type Payload = z.infer<typeof payloadSchema>;
type Stage = {
  id: string;
  owner_id: string;
  workspace_id: string;
  file_id: string;
  source_revision: number;
  target_revision: number;
  source_coverage_id: string;
  target_coverage_id: string;
  workspace_revision: number;
  observation_count: number;
  derivative_count: number;
  encrypted_payload: string;
  expires_at: string;
};
type Source = {
  id: string;
  encrypted_payload: string;
  entity_id: string;
  ordinal: number;
  blob_id?: string;
};
const originalCas = `
  (SELECT count(*) FROM json_each(?) e JOIN v2_upload_sessions u ON u.id=json_extract(e.value,'$.uploadId')
    JOIN v2_upload_parts x ON x.upload_id=u.id AND x.ordinal=json_extract(e.value,'$.ordinal')
    JOIN v2_blobs b ON b.id=x.blob_id JOIN v2_storage_reservations q ON q.id=b.reservation_id
    JOIN v2_billing_principals p ON p.id=b.principal_id
    WHERE u.file_id=? AND u.state='finalized' AND u.encrypted_payload=json_extract(e.value,'$.uploadPayload')
    AND x.encrypted_payload=json_extract(e.value,'$.partPayload') AND x.blob_id=json_extract(e.value,'$.blobId')
    AND x.byte_length=json_extract(e.value,'$.byteLength') AND b.logical_bytes=x.byte_length
    AND b.encrypted_payload=json_extract(e.value,'$.blobPayload') AND b.key_version=json_extract(e.value,'$.keyVersion')
    AND b.cipher_hash=json_extract(e.value,'$.cipherHash') AND x.cipher_hash=b.cipher_hash
    AND b.state='stored' AND b.kind='original' AND b.visibility='private'
    AND p.owner_id=? AND q.workspace_id=? AND q.entity_id=?
    AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='blob' AND target_id=b.id))=?
  AND (SELECT count(*) FROM v2_upload_sessions u JOIN v2_upload_parts x ON x.upload_id=u.id WHERE u.file_id=?)=?`;
const zero = "0".repeat(64);
const MAX_EDIT_TTL_MS = 30 * 60 * 1000;

/** Each invocation copies one <=64 KiB part or <=4 rows of each kind. No AI admission occurs. */
export function createV2FileEditsRepository(core: V2Core) {
  const find = (g: WorkspaceGuard, id: string) =>
    core
      .statement(
        `
    SELECT e.* FROM v2_file_edit_stages e JOIN v2_workspaces w ON w.id=e.workspace_id
    JOIN v2_files f ON f.id=e.file_id JOIN v2_private_snapshots t ON t.id=e.target_coverage_id
    WHERE e.id=? AND e.owner_id=? AND w.owner_id=e.owner_id AND w.id=? AND w.revision=?
    AND e.workspace_revision=w.revision AND e.expires_at>? AND ${aliveWorkspace}
    AND w.current_job_id IS NULL AND f.workspace_id=w.id AND f.revision=e.source_revision
    AND f.state='ready' AND f.current_job_id IS NULL AND f.coverage_snapshot_id=e.source_coverage_id
    AND t.owner_id=w.owner_id AND t.workspace_id=w.id AND t.target_id=f.id AND t.purpose='file_coverage'
    AND t.revision=e.target_revision AND t.workspace_revision=e.workspace_revision AND t.state='staging'
    AND t.lease_job_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id)`,
        [id, g.ownerId, g.workspaceId, g.expectedRevision, g.now],
      )
      .first<Stage>();
  const load = async (g: WorkspaceGuard, id: string) => {
    const stage = await find(g, id);
    if (!stage) return null;
    const payload = await core.decrypt(
      "v2_file_edit_stages",
      id,
      g.ownerId,
      stage.target_revision,
      stage.encrypted_payload,
      payloadSchema,
    );
    if (
      payload.fileId !== stage.file_id ||
      payload.workspaceId !== stage.workspace_id ||
      payload.workspaceRevision !== stage.workspace_revision ||
      payload.sourceRevision !== stage.source_revision ||
      payload.targetRevision !== stage.target_revision ||
      payload.sourceCoverageId !== stage.source_coverage_id ||
      payload.targetCoverageId !== stage.target_coverage_id ||
      payload.expiresAt !== stage.expires_at ||
      payload.observationCount !== stage.observation_count ||
      payload.derivativeCount !== stage.derivative_count
    )
      return null;
    return { stage, payload };
  };
  const predicate = (g: WorkspaceGuard, stage: Stage, payload: Payload) => ({
    sql: `w.current_job_id IS NULL AND EXISTS(SELECT 1 FROM v2_file_edit_stages e
      JOIN v2_files f ON f.id=e.file_id JOIN v2_private_snapshots s ON s.id=e.source_coverage_id
      JOIN v2_private_snapshots m ON m.id=f.manifest_snapshot_id
      JOIN v2_private_snapshots t ON t.id=e.target_coverage_id
      WHERE e.id=? AND e.owner_id=w.owner_id AND e.workspace_id=w.id AND e.workspace_revision=w.revision
      AND e.expires_at>? AND e.encrypted_payload=? AND f.workspace_id=w.id
      AND f.state='ready' AND f.current_job_id IS NULL AND f.revision=e.source_revision
      AND f.encrypted_payload=? AND f.operation_id=? AND f.manifest_snapshot_id=? AND f.coverage_snapshot_id=e.source_coverage_id
      AND t.owner_id=w.owner_id AND t.workspace_id=w.id AND t.target_id=f.id AND t.purpose='file_coverage'
      AND t.revision=e.target_revision AND t.workspace_revision=e.workspace_revision AND t.state='staging'
      AND t.lease_job_id IS NULL
      AND s.state='published' AND s.owner_id=w.owner_id AND s.target_id=f.id AND s.purpose='file_coverage'
      AND s.revision=e.source_revision AND s.encrypted_payload=?
      AND m.state='published' AND m.owner_id=w.owner_id AND m.target_id=f.id AND m.purpose='file_manifest'
      AND m.encrypted_payload=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones
        WHERE target_kind='file' AND target_id=f.id))`,
    values: [
      stage.id,
      g.now,
      stage.encrypted_payload,
      payload.filePayload,
      payload.operationId,
      payload.manifestId,
      payload.coveragePayload,
      payload.manifestPayload,
    ] as unknown[],
  });
  const claim = (
    g: WorkspaceGuard,
    stage: Stage,
    payload: Payload,
    id: string,
    extra = "1",
    values: unknown[] = [],
  ) => {
    const condition = predicate(g, stage, payload);
    return core.claim(g, id, `${condition.sql} AND (${extra})`, [...condition.values, ...values]);
  };
  const receipt = (
    claimId: string,
    stage: Stage,
    kind: string,
    ordinal: number,
    sourceId: string,
    sourcePayload: string,
    targetId: string,
    targetPayload: string,
    blobId: string | null = null,
    blobPayload: string | null = null,
  ) =>
    core.statement(
      `
    INSERT INTO v2_file_edit_receipts(stage_id,kind,ordinal,source_id,source_payload,target_id,target_payload,source_blob_id,source_blob_payload)
    SELECT ?,?,?,?,?,?,?,?,? WHERE ${sqlClaim}`,
      [
        stage.id,
        kind,
        ordinal,
        sourceId,
        sourcePayload,
        targetId,
        targetPayload,
        blobId,
        blobPayload,
        claimId,
      ],
    );
  const replay = async (
    g: WorkspaceGuard,
    stage: Stage,
    payload: Payload,
    kind: string,
    source: Source,
  ) => {
    const row = await core
      .statement(
        `SELECT source_id,source_payload FROM v2_file_edit_receipts
      WHERE stage_id=? AND kind=? AND ordinal=?`,
        [stage.id, kind, source.ordinal],
      )
      .first<{ source_id: string; source_payload: string }>();
    if (!row) return null;
    if (row.source_id !== source.id || row.source_payload !== source.encrypted_payload)
      return false;
    const id = crypto.randomUUID();
    return core.changed([claim(g, stage, payload, id), core.finish(id)]);
  };
  return {
    begin(
      g: WorkspaceGuard,
      input: {
        id: string;
        fileId: string;
        request: V2ObservationEditRequest;
        coverageSnapshotId: string;
        expiresAt: string;
      },
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, input.id);
        parse(opaqueIdSchema, input.fileId);
        parse(opaqueIdSchema, input.coverageSnapshotId);
        const request = parse(v2ObservationEditRequestSchema, input.request);
        const expiresAt = new Date(parse(timestampSchema, input.expiresAt)).toISOString();
        const ttl = Date.parse(expiresAt) - Date.parse(g.now);
        if (ttl <= 0 || ttl > MAX_EDIT_TTL_MS) return false;
        const old = await load(g, input.id);
        if (old) {
          if (
            !(
              old.stage.file_id === input.fileId &&
              old.stage.target_coverage_id === input.coverageSnapshotId &&
              old.stage.expires_at === expiresAt &&
              JSON.stringify(old.payload.request) === JSON.stringify(request)
            )
          )
            return false;
          const id = crypto.randomUUID();
          return core.changed([claim(g, old.stage, old.payload, id), core.finish(id)]);
        }
        const file = await core
          .statement(
            `SELECT f.*,s.encrypted_payload coverage_payload,s.part_count,s.byte_length,
        m.encrypted_payload manifest_payload,m.revision manifest_revision FROM v2_files f JOIN v2_workspaces w ON w.id=f.workspace_id
        JOIN v2_private_snapshots s ON s.id=f.coverage_snapshot_id JOIN v2_private_snapshots m ON m.id=f.manifest_snapshot_id
        WHERE f.id=? AND f.workspace_id=? AND w.owner_id=? AND w.revision=? AND ${aliveWorkspace}
        AND w.current_job_id IS NULL AND f.state='ready' AND f.current_job_id IS NULL AND f.revision=?
        AND s.state='published' AND s.owner_id=w.owner_id AND s.target_id=f.id AND s.revision=f.revision
        AND s.purpose='file_coverage' AND m.state='published' AND m.owner_id=w.owner_id AND m.target_id=f.id
        AND m.purpose='file_manifest' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id)`,
            [input.fileId, g.workspaceId, g.ownerId, g.expectedRevision, request.expectedRevision],
          )
          .first<{
            revision: number;
            encrypted_payload: string;
            operation_id: string;
            manifest_snapshot_id: string;
            coverage_snapshot_id: string;
            manifest_payload: string;
            manifest_revision: number;
            coverage_payload: string;
            part_count: number;
            byte_length: number;
          }>();
        if (!file) return false;
        const manifest = await readSnapshot(
          core,
          g,
          file.manifest_snapshot_id,
          "file_manifest",
          input.fileId,
          file.manifest_revision,
          v2OriginalManifestSchema,
        );
        if (!manifest) return false;
        const originalRows = (
          await core
            .statement(
              `SELECT x.*,u.revision upload_revision,u.encrypted_payload upload_payload,
          b.encrypted_payload blob_payload,b.key_version,b.cipher_hash blob_cipher_hash
          FROM v2_upload_sessions u JOIN v2_upload_parts x ON x.upload_id=u.id
          JOIN v2_blobs b ON b.id=x.blob_id JOIN v2_storage_reservations q ON q.id=b.reservation_id
          JOIN v2_billing_principals p ON p.id=b.principal_id
          WHERE u.file_id=? AND u.state='finalized' AND p.owner_id=? AND q.workspace_id=? AND q.entity_id=?
          AND b.state='stored' AND b.kind='original' AND b.visibility='private' AND b.logical_bytes=x.byte_length
          AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='blob' AND target_id=b.id)
          ORDER BY x.ordinal LIMIT 121`,
              [input.fileId, g.ownerId, g.workspaceId, input.fileId],
            )
            .all<{
              upload_id: string;
              ordinal: number;
              byte_length: number;
              blob_id: string;
              encrypted_payload: string;
              upload_revision: number;
              upload_payload: string;
              blob_payload: string;
              key_version: string;
              cipher_hash: string;
              blob_cipher_hash: string;
            }>()
        ).results;
        if (originalRows.length !== manifest.parts.length) return false;
        const originalReceipts: Payload["originalReceipts"] = [];
        for (const [index, part] of originalRows.entries()) {
          const expected = manifest.parts[index];
          const receipt = await core.decrypt(
            "v2_upload_parts",
            `${part.upload_id}-${index}`,
            g.ownerId,
            part.upload_revision,
            part.encrypted_payload,
            z.strictObject({
              blobId: opaqueIdSchema,
              keyVersion: z.string(),
              contentHash: hashSchema,
              index: z.number().int(),
              byteLength: z.number().int(),
            }),
          );
          const actual = await core.decrypt(
            "v2_blobs",
            part.blob_id,
            g.ownerId,
            1,
            part.blob_payload,
            z.strictObject({ contentHash: hashSchema }),
          );
          const upload = await core.decrypt(
            "v2_upload_sessions",
            part.upload_id,
            g.ownerId,
            part.upload_revision,
            part.upload_payload,
            z.strictObject({ contentHash: hashSchema }),
          );
          if (
            !expected ||
            part.ordinal !== index ||
            receipt.index !== index ||
            part.byte_length !== expected.byteLength ||
            receipt.byteLength !== expected.byteLength ||
            receipt.blobId !== part.blob_id ||
            receipt.keyVersion !== part.key_version ||
            receipt.contentHash !== expected.contentHash ||
            actual.contentHash !== expected.contentHash ||
            upload.contentHash !== manifest.contentHash ||
            part.cipher_hash !== part.blob_cipher_hash
          )
            return false;
          originalReceipts.push({
            ordinal: index,
            uploadId: part.upload_id,
            uploadPayload: part.upload_payload,
            partPayload: part.encrypted_payload,
            blobId: part.blob_id,
            blobPayload: part.blob_payload,
            keyVersion: part.key_version,
            cipherHash: part.blob_cipher_hash,
            byteLength: part.byte_length,
          });
        }
        const counts = await core
          .statement(
            `SELECT
        (SELECT count(*) FROM v2_file_observations WHERE file_id=? AND file_revision=?) observation_count,
        (SELECT count(*) FROM v2_file_derivatives WHERE file_id=? AND file_revision=?) derivative_count,
        (SELECT count(*) FROM v2_file_observations o JOIN json_each(?) e ON o.entity_id=json_extract(e.value,'$.observationId')
          WHERE o.file_id=? AND o.file_revision=?) edits`,
            [
              input.fileId,
              file.revision,
              input.fileId,
              file.revision,
              JSON.stringify(request.edits),
              input.fileId,
              file.revision,
            ],
          )
          .first<{ observation_count: number; derivative_count: number; edits: number }>();
        if (
          !counts ||
          counts.edits !== request.edits.length ||
          counts.observation_count > 10000 ||
          counts.derivative_count > 20000
        )
          return false;
        const metadata = await core.decrypt(
          "v2_files",
          input.fileId,
          g.ownerId,
          file.revision,
          file.encrypted_payload,
          metadataSchema,
        );
        const integrity = await core.decrypt(
          "v2_private_snapshots",
          file.coverage_snapshot_id,
          g.ownerId,
          file.revision,
          file.coverage_payload,
          integritySchema,
        );
        if (integrity.targetId !== input.fileId || integrity.partCount !== file.part_count)
          return false;
        const revision = file.revision + 1;
        const targetFilePayload = await core.encrypt(
          "v2_files",
          input.fileId,
          g.ownerId,
          revision,
          metadata,
        );
        const stagePayload = await core.encrypt(
          "v2_file_edit_stages",
          input.id,
          g.ownerId,
          revision,
          {
            fileId: input.fileId,
            workspaceId: g.workspaceId,
            workspaceRevision: g.expectedRevision,
            sourceRevision: file.revision,
            targetRevision: revision,
            sourceCoverageId: file.coverage_snapshot_id,
            targetCoverageId: input.coverageSnapshotId,
            expiresAt,
            observationCount: counts.observation_count,
            derivativeCount: counts.derivative_count,
            request,
            filePayload: file.encrypted_payload,
            operationId: file.operation_id,
            manifestId: file.manifest_snapshot_id,
            manifestPayload: file.manifest_payload,
            coveragePayload: file.coverage_payload,
            coverageIntegrity: integrity,
            targetFilePayload,
            originalReceipts,
          },
        );
        const header = await core.encrypt(
          "v2_private_snapshots",
          input.coverageSnapshotId,
          g.ownerId,
          revision,
          { ...integrity, digest: zero },
        );
        const id = crypto.randomUUID();
        return core.changed([
          core.claim(
            g,
            id,
            `w.current_job_id IS NULL AND EXISTS(SELECT 1 FROM v2_files f
          JOIN v2_private_snapshots s ON s.id=f.coverage_snapshot_id JOIN v2_private_snapshots m ON m.id=f.manifest_snapshot_id
          WHERE f.id=? AND f.workspace_id=w.id AND f.revision=? AND f.state='ready' AND f.current_job_id IS NULL
          AND f.encrypted_payload=? AND s.id=? AND s.encrypted_payload=? AND s.state='published'
          AND m.id=? AND m.encrypted_payload=? AND m.state='published'
          AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id))
          AND NOT EXISTS(SELECT 1 FROM v2_file_edit_stages WHERE file_id=? AND source_revision=?) AND ${originalCas}`,
            [
              input.fileId,
              file.revision,
              file.encrypted_payload,
              file.coverage_snapshot_id,
              file.coverage_payload,
              file.manifest_snapshot_id,
              file.manifest_payload,
              input.fileId,
              file.revision,
              JSON.stringify(originalReceipts),
              input.fileId,
              g.ownerId,
              g.workspaceId,
              input.fileId,
              originalReceipts.length,
              input.fileId,
              originalReceipts.length,
            ],
          ),
          core.statement(
            `INSERT INTO v2_private_snapshots(id,owner_id,workspace_id,purpose,target_id,revision,part_count,
          byte_length,encrypted_payload,created_at,state,workspace_revision)
          SELECT ?,?,?,'file_coverage',?,?,?,?,?,?,'staging',? WHERE ${sqlClaim}`,
            [
              input.coverageSnapshotId,
              g.ownerId,
              g.workspaceId,
              input.fileId,
              revision,
              file.part_count,
              file.byte_length,
              header,
              g.now,
              g.expectedRevision,
              id,
            ],
          ),
          core.statement(
            `INSERT INTO v2_file_edit_stages(id,owner_id,workspace_id,file_id,source_revision,target_revision,
          source_coverage_id,target_coverage_id,workspace_revision,observation_count,derivative_count,encrypted_payload,created_at,expires_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${sqlClaim}`,
            [
              input.id,
              g.ownerId,
              g.workspaceId,
              input.fileId,
              file.revision,
              revision,
              file.coverage_snapshot_id,
              input.coverageSnapshotId,
              g.expectedRevision,
              counts.observation_count,
              counts.derivative_count,
              stagePayload,
              g.now,
              expiresAt,
              id,
            ],
          ),
          core.finish(id),
        ]);
      });
    },

    copyCoveragePart(g: WorkspaceGuard, stageId: string, index: number) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, stageId);
        parse(z.number().int().min(0).max(99999), index);
        const loaded = await load(g, stageId);
        if (!loaded) return false;
        const { stage, payload } = loaded;
        const source = await core
          .statement(
            "SELECT id,encrypted_payload,byte_length FROM v2_private_parts WHERE snapshot_id=? AND part_index=?",
            [stage.source_coverage_id, index],
          )
          .first<{ id: string; encrypted_payload: string; byte_length: number }>();
        if (!source) return false;
        const prior = await replay(g, stage, payload, "coverage", {
          ...source,
          entity_id: "",
          ordinal: index,
        });
        if (prior !== null) return prior;
        const target = await core
          .statement(
            "SELECT encrypted_payload,written_parts,written_bytes,byte_length,part_count FROM v2_private_snapshots WHERE id=? AND state='staging'",
            [stage.target_coverage_id],
          )
          .first<{
            encrypted_payload: string;
            written_parts: number;
            written_bytes: number;
            byte_length: number;
            part_count: number;
          }>();
        if (!target || target.written_parts !== index || index >= target.part_count) return false;
        const text = await core.cipher.decrypt(source.encrypted_payload, {
          table: "v2_private_parts",
          column: "encrypted_payload",
          rowId: source.id,
          userId: g.ownerId,
          revision: stage.source_revision,
          targetId: stage.file_id,
          purpose: "file_coverage",
          part: index,
        });
        const bytes = utf8Bytes(text);
        if (
          bytes !== source.byte_length ||
          bytes < 1 ||
          bytes > SNAPSHOT_FRAGMENT_BYTES ||
          target.written_bytes + bytes > target.byte_length
        )
          return false;
        const integrity = await core.decrypt(
          "v2_private_snapshots",
          stage.target_coverage_id,
          g.ownerId,
          stage.target_revision,
          target.encrypted_payload,
          integritySchema,
        );
        const digest = await snapshotChain(integrity.digest, index, text);
        if (
          index === target.part_count - 1 &&
          (digest !== payload.coverageIntegrity.digest ||
            target.written_bytes + bytes !== target.byte_length)
        )
          return false;
        const rowId = crypto.randomUUID();
        const envelope = await core.cipher.encrypt(text, {
          table: "v2_private_parts",
          column: "encrypted_payload",
          rowId,
          userId: g.ownerId,
          revision: stage.target_revision,
          targetId: stage.file_id,
          purpose: "file_coverage",
          part: index,
        });
        const nextHeader = await core.encrypt(
          "v2_private_snapshots",
          stage.target_coverage_id,
          g.ownerId,
          stage.target_revision,
          { ...integrity, digest },
        );
        const id = crypto.randomUUID();
        return core.changed([
          claim(
            g,
            stage,
            payload,
            id,
            `EXISTS(SELECT 1 FROM v2_private_snapshots WHERE id=? AND state='staging'
          AND encrypted_payload=? AND written_parts=? AND written_bytes=?) AND EXISTS(SELECT 1 FROM v2_private_parts
          WHERE id=? AND snapshot_id=? AND part_index=? AND encrypted_payload=? AND byte_length=?)`,
            [
              stage.target_coverage_id,
              target.encrypted_payload,
              index,
              target.written_bytes,
              source.id,
              stage.source_coverage_id,
              index,
              source.encrypted_payload,
              bytes,
            ],
          ),
          core.statement(
            `INSERT INTO v2_private_parts(id,snapshot_id,part_index,byte_length,encrypted_payload)
          SELECT ?,?,?,?,? WHERE ${sqlClaim}`,
            [rowId, stage.target_coverage_id, index, bytes, envelope, id],
          ),
          receipt(
            id,
            stage,
            "coverage",
            index,
            source.id,
            source.encrypted_payload,
            rowId,
            envelope,
          ),
          core.statement(
            `UPDATE v2_private_snapshots SET written_parts=written_parts+1,written_bytes=written_bytes+?,encrypted_payload=?
          WHERE id=? AND ${sqlClaim}`,
            [bytes, nextHeader, stage.target_coverage_id, id],
          ),
          core.finish(id),
        ]);
      });
    },

    copyPage(
      g: WorkspaceGuard,
      stageId: string,
      input: { observationOrdinal: number; derivativeOrdinal: number },
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, stageId);
        parse(z.number().int().min(0).max(10000), input.observationOrdinal);
        parse(z.number().int().min(0).max(20000), input.derivativeOrdinal);
        const loaded = await load(g, stageId);
        if (!loaded) return false;
        const { stage, payload } = loaded;
        if (
          input.observationOrdinal > stage.observation_count ||
          input.derivativeOrdinal > stage.derivative_count
        )
          return false;
        const observations = (
          await core
            .statement(
              `SELECT id,entity_id,ordinal,encrypted_payload FROM v2_file_observations
        WHERE file_id=? AND file_revision=? AND ordinal>=? ORDER BY ordinal LIMIT 4`,
              [stage.file_id, stage.source_revision, input.observationOrdinal],
            )
            .all<Source>()
        ).results;
        const derivatives = (
          await core
            .statement(
              `SELECT id,entity_id,ordinal,blob_id,encrypted_payload FROM v2_file_derivatives
        WHERE file_id=? AND file_revision=? AND ordinal>=? ORDER BY ordinal LIMIT 4`,
              [stage.file_id, stage.source_revision, input.derivativeOrdinal],
            )
            .all<Source>()
        ).results;
        if (
          observations.length !== Math.min(4, stage.observation_count - input.observationOrdinal) ||
          derivatives.length !== Math.min(4, stage.derivative_count - input.derivativeOrdinal)
        )
          return false;
        const id = crypto.randomUUID();
        const statements: D1PreparedStatement[] = [];
        const checks: string[] = [];
        const values: unknown[] = [];
        for (const [offset, source] of observations.entries()) {
          if (source.ordinal !== input.observationOrdinal + offset) return false;
          const prior = await replay(g, stage, payload, "observation", source);
          if (prior === false) return false;
          if (prior === true) continue;
          const old = await core.decrypt(
            "v2_file_observations",
            source.id,
            g.ownerId,
            stage.source_revision,
            source.encrypted_payload,
            v2FileObservationSchema,
          );
          if (old.id !== source.entity_id) return false;
          const change = payload.request.edits.find((e) => e.observationId === old.id);
          const value = change
            ? {
                ...old,
                text: change.text,
                included: change.included,
                userEdited: true,
                certainty: "uncertain" as const,
              }
            : old;
          const rowId = crypto.randomUUID();
          const envelope = await core.encrypt(
            "v2_file_observations",
            rowId,
            g.ownerId,
            stage.target_revision,
            value,
          );
          checks.push(
            "EXISTS(SELECT 1 FROM v2_file_observations WHERE id=? AND file_id=? AND file_revision=? AND ordinal=? AND encrypted_payload=?)",
          );
          values.push(
            source.id,
            stage.file_id,
            stage.source_revision,
            source.ordinal,
            source.encrypted_payload,
          );
          statements.push(
            core.statement(
              `INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload,snapshot_id)
          SELECT ?,?,?,?,?,?,?,? WHERE ${sqlClaim}`,
              [
                rowId,
                value.id,
                stage.file_id,
                stage.target_revision,
                stage.target_revision,
                source.ordinal,
                envelope,
                stage.target_coverage_id,
                id,
              ],
            ),
            receipt(
              id,
              stage,
              "observation",
              source.ordinal,
              source.id,
              source.encrypted_payload,
              rowId,
              envelope,
            ),
          );
        }
        for (const [offset, source] of derivatives.entries()) {
          if (source.ordinal !== input.derivativeOrdinal + offset || !source.blob_id) return false;
          const prior = await replay(g, stage, payload, "derivative", source);
          if (prior === false) return false;
          if (prior === true) continue;
          const value = await core.decrypt(
            "v2_file_derivatives",
            source.id,
            g.ownerId,
            stage.source_revision,
            source.encrypted_payload,
            v2DerivativeSchema,
          );
          if (value.id !== source.entity_id) return false;
          const blob = await core
            .statement(
              `SELECT b.encrypted_payload FROM v2_blobs b
          JOIN v2_storage_reservations r ON r.id=b.reservation_id JOIN v2_billing_principals p ON p.id=b.principal_id
          WHERE b.id=? AND b.state='stored' AND b.visibility='private' AND b.kind='derivative'
          AND b.logical_bytes=? AND p.owner_id=? AND r.workspace_id=? AND r.entity_id=? AND r.operation_id=?
          AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='blob' AND target_id=b.id)`,
              [
                source.blob_id,
                value.byteLength,
                g.ownerId,
                g.workspaceId,
                stage.file_id,
                payload.operationId,
              ],
            )
            .first<{ encrypted_payload: string }>();
          if (!blob) return false;
          const actual = await core.decrypt(
            "v2_blobs",
            source.blob_id,
            g.ownerId,
            1,
            blob.encrypted_payload,
            z.strictObject({ contentHash: hashSchema }),
          );
          if (actual.contentHash !== value.contentHash) return false;
          const rowId = crypto.randomUUID();
          const envelope = await core.encrypt(
            "v2_file_derivatives",
            rowId,
            g.ownerId,
            stage.target_revision,
            value,
          );
          checks.push(`EXISTS(SELECT 1 FROM v2_file_derivatives d JOIN v2_blobs b ON b.id=d.blob_id
          WHERE d.id=? AND d.file_id=? AND d.file_revision=? AND d.ordinal=? AND d.encrypted_payload=?
          AND b.id=? AND b.encrypted_payload=? AND b.state='stored')`);
          values.push(
            source.id,
            stage.file_id,
            stage.source_revision,
            source.ordinal,
            source.encrypted_payload,
            source.blob_id,
            blob.encrypted_payload,
          );
          statements.push(
            core.statement(
              `INSERT INTO v2_file_derivatives(id,entity_id,file_id,file_revision,kind,blob_id,ordinal,encrypted_payload,snapshot_id)
          SELECT ?,?,?,?,?,?,?,?,? WHERE ${sqlClaim}`,
              [
                rowId,
                value.id,
                stage.file_id,
                stage.target_revision,
                value.kind,
                source.blob_id,
                source.ordinal,
                envelope,
                stage.target_coverage_id,
                id,
              ],
            ),
            receipt(
              id,
              stage,
              "derivative",
              source.ordinal,
              source.id,
              source.encrypted_payload,
              rowId,
              envelope,
              source.blob_id,
              blob.encrypted_payload,
            ),
          );
        }
        statements.unshift(claim(g, stage, payload, id, checks.join(" AND ") || "1", values));
        statements.push(core.finish(id));
        return core.changed(statements);
      });
    },

    publish(g: WorkspaceGuard, stageId: string) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, stageId);
        const loaded = await load(g, stageId);
        if (!loaded) return false;
        const { stage, payload } = loaded;
        const header = await core
          .statement(
            "SELECT encrypted_payload,part_count,byte_length,written_parts,written_bytes FROM v2_private_snapshots WHERE id=? AND state='staging'",
            [stage.target_coverage_id],
          )
          .first<{
            encrypted_payload: string;
            part_count: number;
            byte_length: number;
            written_parts: number;
            written_bytes: number;
          }>();
        if (
          !header ||
          header.part_count !== header.written_parts ||
          header.byte_length !== header.written_bytes
        )
          return false;
        const integrity = await core.decrypt(
          "v2_private_snapshots",
          stage.target_coverage_id,
          g.ownerId,
          stage.target_revision,
          header.encrypted_payload,
          integritySchema,
        );
        if (JSON.stringify(integrity) !== JSON.stringify(payload.coverageIntegrity)) return false;
        const id = crypto.randomUUID();
        const complete = `EXISTS(SELECT 1 FROM v2_private_snapshots s WHERE s.id=? AND s.state='staging'
        AND s.encrypted_payload=? AND s.written_parts=s.part_count AND s.written_bytes=s.byte_length)
        AND (SELECT count(*) FROM v2_file_edit_receipts WHERE stage_id=? AND kind='coverage')=?
        AND (SELECT count(*) FROM v2_file_observations WHERE file_id=? AND file_revision=?)=?
        AND (SELECT count(*) FROM v2_file_derivatives WHERE file_id=? AND file_revision=?)=?
        AND (SELECT count(*) FROM v2_file_edit_receipts WHERE stage_id=? AND kind='observation')=?
        AND (SELECT count(*) FROM v2_file_edit_receipts WHERE stage_id=? AND kind='derivative')=?
        AND (SELECT count(*) FROM v2_private_parts WHERE snapshot_id=?)=?
        AND (SELECT count(*) FROM v2_private_parts WHERE snapshot_id=?)=?
        AND EXISTS(SELECT 1 FROM v2_private_snapshots m WHERE m.id=?
          AND (SELECT count(*) FROM v2_private_parts WHERE snapshot_id=m.id)=m.part_count)
        AND (SELECT count(*) FROM v2_file_observations WHERE file_id=? AND file_revision=?)=?
        AND (SELECT count(*) FROM v2_file_derivatives WHERE file_id=? AND file_revision=?)=?
        AND (?=0 OR (SELECT min(ordinal) FROM v2_file_observations WHERE file_id=? AND file_revision=?)=0
          AND (SELECT max(ordinal) FROM v2_file_observations WHERE file_id=? AND file_revision=?)=?-1)
        AND (?=0 OR (SELECT min(ordinal) FROM v2_file_derivatives WHERE file_id=? AND file_revision=?)=0
          AND (SELECT max(ordinal) FROM v2_file_derivatives WHERE file_id=? AND file_revision=?)=?-1)
        AND NOT EXISTS(SELECT 1 FROM v2_file_edit_receipts r LEFT JOIN v2_private_parts a ON a.id=r.source_id
          LEFT JOIN v2_private_parts b ON b.id=r.target_id WHERE r.stage_id=? AND r.kind='coverage' AND
          (a.id IS NULL OR b.id IS NULL OR a.snapshot_id!=? OR b.snapshot_id!=? OR a.part_index!=r.ordinal OR b.part_index!=r.ordinal
            OR a.encrypted_payload!=r.source_payload OR b.encrypted_payload!=r.target_payload OR a.byte_length!=b.byte_length))
        AND NOT EXISTS(SELECT 1 FROM v2_file_edit_receipts r LEFT JOIN v2_file_observations a ON a.id=r.source_id
          LEFT JOIN v2_file_observations b ON b.id=r.target_id WHERE r.stage_id=? AND r.kind='observation' AND
          (a.id IS NULL OR b.id IS NULL OR a.file_id!=? OR b.file_id!=? OR a.file_revision!=? OR b.file_revision!=?
            OR a.ordinal!=r.ordinal OR b.ordinal!=r.ordinal OR a.entity_id!=b.entity_id OR b.snapshot_id!=?
            OR a.revision!=a.file_revision OR b.revision!=b.file_revision
            OR a.encrypted_payload!=r.source_payload OR b.encrypted_payload!=r.target_payload))
        AND NOT EXISTS(SELECT 1 FROM v2_file_edit_receipts r LEFT JOIN v2_file_derivatives a ON a.id=r.source_id
          LEFT JOIN v2_file_derivatives b ON b.id=r.target_id LEFT JOIN v2_blobs o ON o.id=r.source_blob_id
          LEFT JOIN v2_storage_reservations q ON q.id=o.reservation_id LEFT JOIN v2_billing_principals p ON p.id=o.principal_id
          WHERE r.stage_id=? AND r.kind='derivative' AND
          (a.id IS NULL OR b.id IS NULL OR o.id IS NULL OR a.file_id!=? OR b.file_id!=? OR a.file_revision!=? OR b.file_revision!=?
            OR a.ordinal!=r.ordinal OR b.ordinal!=r.ordinal OR a.entity_id!=b.entity_id OR b.snapshot_id!=?
            OR a.encrypted_payload!=r.source_payload OR b.encrypted_payload!=r.target_payload OR a.blob_id!=o.id OR b.blob_id!=o.id
            OR o.encrypted_payload!=r.source_blob_payload OR o.state!='stored' OR o.kind!='derivative' OR o.visibility!='private'
            OR p.owner_id!=? OR q.workspace_id!=? OR q.entity_id!=? OR q.operation_id!=(SELECT operation_id FROM v2_files WHERE id=a.file_id)
            OR EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='blob' AND target_id=o.id)))
        AND EXISTS(SELECT 1 FROM v2_upload_sessions u JOIN v2_upload_parts x ON x.upload_id=u.id WHERE u.file_id=? AND u.state='finalized')
        AND NOT EXISTS(SELECT 1 FROM v2_upload_sessions u JOIN v2_upload_parts x ON x.upload_id=u.id
          LEFT JOIN v2_blobs b ON b.id=x.blob_id LEFT JOIN v2_storage_reservations q ON q.id=b.reservation_id
          LEFT JOIN v2_billing_principals p ON p.id=b.principal_id
          WHERE u.file_id=? AND (b.id IS NULL OR b.state!='stored' OR b.kind!='original' OR b.visibility!='private'
            OR q.id IS NULL OR p.owner_id!=? OR q.workspace_id!=? OR q.entity_id!=?
            OR EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='blob' AND target_id=b.id))) AND ${originalCas}`;
        return core.changed([
          claim(g, stage, payload, id, complete, [
            stage.target_coverage_id,
            header.encrypted_payload,
            stage.id,
            header.part_count,
            stage.file_id,
            stage.target_revision,
            stage.observation_count,
            stage.file_id,
            stage.target_revision,
            stage.derivative_count,
            stage.id,
            stage.observation_count,
            stage.id,
            stage.derivative_count,
            stage.source_coverage_id,
            header.part_count,
            stage.target_coverage_id,
            header.part_count,
            payload.manifestId,
            stage.file_id,
            stage.source_revision,
            stage.observation_count,
            stage.file_id,
            stage.source_revision,
            stage.derivative_count,
            stage.observation_count,
            stage.file_id,
            stage.source_revision,
            stage.file_id,
            stage.source_revision,
            stage.observation_count,
            stage.derivative_count,
            stage.file_id,
            stage.source_revision,
            stage.file_id,
            stage.source_revision,
            stage.derivative_count,
            stage.id,
            stage.source_coverage_id,
            stage.target_coverage_id,
            stage.id,
            stage.file_id,
            stage.file_id,
            stage.source_revision,
            stage.target_revision,
            stage.target_coverage_id,
            stage.id,
            stage.file_id,
            stage.file_id,
            stage.source_revision,
            stage.target_revision,
            stage.target_coverage_id,
            g.ownerId,
            g.workspaceId,
            stage.file_id,
            stage.file_id,
            stage.file_id,
            g.ownerId,
            g.workspaceId,
            stage.file_id,
            JSON.stringify(payload.originalReceipts),
            stage.file_id,
            g.ownerId,
            g.workspaceId,
            stage.file_id,
            payload.originalReceipts.length,
            stage.file_id,
            payload.originalReceipts.length,
          ]),
          core.statement(
            `UPDATE v2_private_snapshots SET state='published' WHERE id=? AND ${sqlClaim}`,
            [stage.target_coverage_id, id],
          ),
          core.statement(
            `UPDATE v2_files SET revision=?,coverage_snapshot_id=?,encrypted_payload=?,updated_at=? WHERE id=? AND ${sqlClaim}`,
            [
              stage.target_revision,
              stage.target_coverage_id,
              payload.targetFilePayload,
              g.now,
              stage.file_id,
              id,
            ],
          ),
          core.bump(g, id),
          core.statement(`DELETE FROM v2_file_edit_stages WHERE id=? AND ${sqlClaim}`, [
            stage.id,
            id,
          ]),
          core.finish(id),
        ]);
      });
    },

    abandon(g: WorkspaceGuard, stageId: string) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, stageId);
        // Cleanup remains available after expiry/source changes, but never removes a published snapshot.
        const stage = await core
          .statement(
            "SELECT * FROM v2_file_edit_stages WHERE id=? AND owner_id=? AND workspace_id=?",
            [stageId, g.ownerId, g.workspaceId],
          )
          .first<Stage>();
        if (!stage) return false;
        const id = crypto.randomUUID();
        return core.changed([
          core.claim(
            g,
            id,
            `EXISTS(SELECT 1 FROM v2_file_edit_stages e
        JOIN v2_private_snapshots s ON s.id=e.target_coverage_id WHERE e.id=? AND e.owner_id=w.owner_id
        AND e.workspace_id=w.id AND s.state='staging' AND s.owner_id=w.owner_id AND s.workspace_id=w.id
        AND s.target_id=e.file_id AND s.purpose='file_coverage')`,
            [stageId],
          ),
          core.statement(
            `DELETE FROM v2_private_snapshots WHERE id=? AND state='staging' AND ${sqlClaim}`,
            [stage.target_coverage_id, id],
          ),
          core.finish(id),
        ]);
      });
    },
  };
}
