import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../contracts";
import {
  type V2File,
  type V2ObservationEditRequest,
  type V2UploadReservationRequest,
  v2CoverageSchema,
  v2DerivativeSchema,
  v2FileObservationSchema,
  v2FileProbeSchema,
  v2FileSchema,
  v2ObservationEditRequestSchema,
  v2OriginalManifestSchema,
  v2UploadReservationRequestSchema,
  v2UploadSessionSchema,
} from "../../contracts/v2";
import { createV2AccountingRepository, operationStatements } from "./v2-accounting";
import {
  type Actor,
  actorSchema,
  aliveWorkspace,
  guardSchema,
  hashSchema,
  parse,
  readSnapshot,
  safe,
  snapshotStatements,
  sqlClaim,
  type V2Core,
  V2RepositoryError,
  type WorkspaceGuard,
} from "./v2-core";
import {
  abandonOriginalPart,
  type OriginalPartRegistration,
  prepareOriginalPart,
  registerOriginalPart,
} from "./v2-original-parts";
import { createV2StagingRepository } from "./v2-staging";
import { storagePredicate, storageReservationStatements } from "./v2-storage";
import type { PreparedStoragePaidHold } from "./v2-storage-paid-runtime";
import {
  type Admission,
  admissionSchema,
  completeLeaseStatements,
  type JobLease,
  leasePredicate,
} from "./v2-workspace";

const metadataSchema = z.strictObject({
  name: v2UploadReservationRequestSchema.shape.name,
  declaredMediaType: v2UploadReservationRequestSchema.shape.mediaType,
  probe: v2FileProbeSchema.nullable(),
});
type FileRow = {
  id: string;
  revision: number;
  state: V2File["status"];
  declared_bytes: number;
  manifest_snapshot_id: string | null;
  coverage_snapshot_id: string | null;
  current_job_id: string | null;
  operation_id: string;
  failure_code: V2File["failure"];
  encrypted_payload: string;
  created_at: string;
  workspace_id: string;
};
export function createV2FilesRepository(core: V2Core) {
  const accounting = createV2AccountingRepository(core);
  const rowForOwner = (actor: Actor, id: string) =>
    core
      .statement(
        `SELECT f.* FROM v2_files f JOIN v2_workspaces w ON w.id=f.workspace_id WHERE f.id=? AND w.owner_id=? AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id)`,
        [id, actor.ownerId],
      )
      .first<FileRow>();
  const read = async (actor: Actor, id: string): Promise<V2File | null> => {
    actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
    parse(opaqueIdSchema, id);
    const row = await rowForOwner(actor, id);
    if (!row) return null;
    const counts = await core
      .statement(
        "SELECT (SELECT count(*) FROM v2_file_observations WHERE file_id=? AND file_revision=?) AS observations,(SELECT count(*) FROM v2_file_derivatives WHERE file_id=? AND file_revision=?) AS derivatives",
        [id, row.revision, id, row.revision],
      )
      .first<{ observations: number; derivatives: number }>();
    if ((counts?.observations ?? 0) > 8 || (counts?.derivatives ?? 0) > 8)
      throw new V2RepositoryError("SNAPSHOT_STREAM_REQUIRED");
    const metadata = await core.decrypt(
      "v2_files",
      id,
      actor.ownerId,
      row.revision,
      row.encrypted_payload,
      metadataSchema,
    );
    const manifest = row.manifest_snapshot_id
      ? await readSnapshot(
          core,
          actor,
          row.manifest_snapshot_id,
          "file_manifest",
          id,
          (await core
            .statement("SELECT revision FROM v2_private_snapshots WHERE id=?", [
              row.manifest_snapshot_id,
            ])
            .first<number>("revision")) ?? row.revision,
          v2OriginalManifestSchema,
        )
      : null;
    const coverage = row.coverage_snapshot_id
      ? await readSnapshot(
          core,
          actor,
          row.coverage_snapshot_id,
          "file_coverage",
          id,
          row.revision,
          v2CoverageSchema,
        )
      : null;
    const observations = await core
      .statement(
        "SELECT * FROM v2_file_observations WHERE file_id=? AND file_revision=? ORDER BY ordinal",
        [id, row.revision],
      )
      .all<{ id: string; revision: number; encrypted_payload: string }>();
    const derivatives = await core
      .statement(
        "SELECT * FROM v2_file_derivatives WHERE file_id=? AND file_revision=? ORDER BY ordinal",
        [id, row.revision],
      )
      .all<{ id: string; file_revision: number; encrypted_payload: string }>();
    const value = parse(v2FileSchema, {
      schemaVersion: "2",
      id,
      revision: row.revision,
      ...metadata,
      byteLength: row.declared_bytes,
      status: row.state,
      manifest,
      coverage,
      observations: await Promise.all(
        observations.results.map((r) =>
          core.decrypt(
            "v2_file_observations",
            r.id,
            actor.ownerId,
            r.revision,
            r.encrypted_payload,
            v2FileObservationSchema,
          ),
        ),
      ),
      derivatives: await Promise.all(
        derivatives.results.map((r) =>
          core.decrypt(
            "v2_file_derivatives",
            r.id,
            actor.ownerId,
            r.file_revision,
            r.encrypted_payload,
            v2DerivativeSchema,
          ),
        ),
      ),
      currentJobId: row.current_job_id,
      operationId: row.state === "reserved" || row.state === "uploading" ? null : row.operation_id,
      failure: row.failure_code,
      createdAt: row.created_at,
    });
    const final = await rowForOwner(actor, id);
    return final?.revision === row.revision ? value : null;
  };
  const fileMetadata = async (actor: Actor, row: FileRow) => {
    const metadata = await core.decrypt(
      "v2_files",
      row.id,
      actor.ownerId,
      row.revision,
      row.encrypted_payload,
      metadataSchema,
    );
    return {
      schemaVersion: "2" as const,
      id: row.id,
      revision: row.revision,
      ...metadata,
      byteLength: row.declared_bytes,
      status: row.state,
      manifestSnapshotId: row.manifest_snapshot_id,
      coverageSnapshotId: row.coverage_snapshot_id,
      currentJobId: row.current_job_id,
      operationId: row.operation_id,
      failure: row.failure_code,
      createdAt: row.created_at,
    };
  };
  const write = async (
    g: WorkspaceGuard,
    value: V2File,
    lease: JobLease | null,
    derivativeBlobs: Readonly<Record<string, string>>,
    uploadGuard?: { sql: string; values: unknown[] },
  ) => {
    g = parse(guardSchema, g);
    if (value.observations.length > 8 || value.derivatives.length > 8)
      throw new V2RepositoryError("SNAPSHOT_STREAM_REQUIRED");
    const file = parse(v2FileSchema, value);
    const old = await rowForOwner(g, file.id);
    if (!old || old.workspace_id !== g.workspaceId) return false;
    const previousMetadata = await core.decrypt(
      "v2_files",
      old.id,
      g.ownerId,
      old.revision,
      old.encrypted_payload,
      metadataSchema,
    );
    if (
      file.name !== previousMetadata.name ||
      file.declaredMediaType !== previousMetadata.declaredMediaType ||
      file.byteLength !== old.declared_bytes ||
      file.operationId !== old.operation_id
    )
      return false;
    if (
      !lease &&
      (file.status !== "uploaded" ||
        !["reserved", "uploading"].includes(old.state) ||
        file.revision !== old.revision + 1)
    )
      return false;
    if (
      lease &&
      (file.status !== "ready" ||
        file.revision !== old.revision + 1 ||
        old.current_job_id !== lease.jobId ||
        !["queued", "processing"].includes(old.state))
    )
      return false;
    const claimId = crypto.randomUUID();
    const execution = lease
      ? leasePredicate(lease, file.id, old.revision, g.now)
      : {
          sql: "EXISTS(SELECT 1 FROM v2_upload_sessions WHERE file_id=? AND state='open' AND expires_at>?)",
          values: [file.id, g.now],
        };
    const metadata = await core.encrypt("v2_files", file.id, g.ownerId, file.revision, {
      name: file.name,
      declaredMediaType: file.declaredMediaType,
      probe: file.probe,
    });
    const manifestId = lease ? old.manifest_snapshot_id : crypto.randomUUID();
    if (!manifestId) return false;
    const coverageId = file.coverage ? crypto.randomUUID() : null;
    const statements = [
      core.claim(
        g,
        claimId,
        `${execution.sql} AND EXISTS(SELECT 1 FROM v2_files WHERE id=? AND workspace_id=w.id AND revision=? AND state=? AND encrypted_payload=? AND manifest_snapshot_id IS ? AND current_job_id IS ?) AND ${uploadGuard?.sql ?? "1"} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=?)`,
        [
          ...execution.values,
          file.id,
          old.revision,
          old.state,
          old.encrypted_payload,
          old.manifest_snapshot_id,
          old.current_job_id,
          ...(uploadGuard?.values ?? []),
          file.id,
        ],
      ),
    ];
    if (!file.manifest) return false;
    if (!lease)
      statements.push(
        ...(await snapshotStatements(
          core,
          {
            id: manifestId,
            ownerId: g.ownerId,
            workspaceId: g.workspaceId,
            targetId: file.id,
            revision: file.revision,
            purpose: "file_manifest",
            now: g.now,
          },
          file.manifest,
          claimId,
        )),
      );
    if (lease) {
      const originalRevision = await core
        .statement("SELECT revision FROM v2_private_snapshots WHERE id=?", [manifestId])
        .first<number>("revision");
      if (
        !originalRevision ||
        JSON.stringify(
          await readSnapshot(
            core,
            g,
            manifestId,
            "file_manifest",
            file.id,
            originalRevision,
            v2OriginalManifestSchema,
          ),
        ) !== JSON.stringify(file.manifest)
      )
        return false;
    }
    if (coverageId)
      statements.push(
        ...(await snapshotStatements(
          core,
          {
            id: coverageId,
            ownerId: g.ownerId,
            workspaceId: g.workspaceId,
            targetId: file.id,
            revision: file.revision,
            purpose: "file_coverage",
            now: g.now,
          },
          file.coverage,
          claimId,
        )),
      );
    for (const [ordinal, observation] of file.observations.entries()) {
      const id = crypto.randomUUID();
      const envelope = await core.encrypt(
        "v2_file_observations",
        id,
        g.ownerId,
        file.revision,
        observation,
      );
      statements.push(
        core.statement(
          `INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload) SELECT ?,?,?,?,?,?,? WHERE ${sqlClaim}`,
          [id, observation.id, file.id, file.revision, file.revision, ordinal, envelope, claimId],
        ),
      );
    }
    for (const [ordinal, derivative] of file.derivatives.entries()) {
      const blobId = parse(opaqueIdSchema, derivativeBlobs[derivative.id]);
      if (
        !(await core
          .statement(
            "SELECT b.id FROM v2_blobs b JOIN v2_storage_reservations r ON r.id=b.reservation_id JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=? AND r.workspace_id=? AND b.kind='derivative' AND b.visibility='private' AND b.state='stored' AND b.logical_bytes=?",
            [blobId, g.ownerId, g.workspaceId, derivative.byteLength],
          )
          .first())
      )
        return false;
      const blob = await core
        .statement("SELECT encrypted_payload FROM v2_blobs WHERE id=? AND state='stored'", [blobId])
        .first<{ encrypted_payload: string }>();
      if (!blob) return false;
      const hash = await core.decrypt(
        "v2_blobs",
        blobId,
        g.ownerId,
        1,
        blob.encrypted_payload,
        z.strictObject({ contentHash: hashSchema }),
      );
      if (hash.contentHash !== derivative.contentHash) return false;
      const id = crypto.randomUUID();
      const envelope = await core.encrypt(
        "v2_file_derivatives",
        id,
        g.ownerId,
        file.revision,
        derivative,
      );
      statements.push(
        core.statement(
          `INSERT INTO v2_file_derivatives(id,entity_id,file_id,file_revision,kind,blob_id,ordinal,encrypted_payload) SELECT ?,?,?,?,?,b.id,?,? FROM v2_blobs b JOIN v2_storage_reservations r ON r.id=b.reservation_id JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=? AND r.workspace_id=? AND r.entity_id=? AND r.operation_id=? AND b.kind='derivative' AND b.visibility='private' AND b.state='stored' AND b.logical_bytes=? AND b.encrypted_payload=? AND ${sqlClaim}`,
          [
            id,
            derivative.id,
            file.id,
            file.revision,
            derivative.kind,
            ordinal,
            envelope,
            blobId,
            g.ownerId,
            g.workspaceId,
            file.id,
            old.operation_id,
            derivative.byteLength,
            blob.encrypted_payload,
            claimId,
          ],
        ),
      );
    }
    statements.push(
      core.statement(
        "UPDATE v2_mutation_claims SET verified=CASE WHEN (SELECT count(*) FROM v2_file_derivatives WHERE file_id=? AND file_revision=?)=? THEN 1 ELSE 0 END WHERE id=?",
        [file.id, file.revision, file.derivatives.length, claimId],
      ),
      core.statement(
        `UPDATE v2_files SET revision=?,state=?,probe_kind=?,manifest_snapshot_id=?,coverage_snapshot_id=?,current_job_id=NULL,failure_code=NULL,encrypted_payload=?,updated_at=? WHERE id=? AND ${sqlClaim}`,
        [
          file.revision,
          file.status,
          file.probe?.category,
          manifestId,
          coverageId,
          metadata,
          g.now,
          file.id,
          claimId,
        ],
      ),
      core.bump(g, claimId),
    );
    if (lease) statements.push(...completeLeaseStatements(core, lease, claimId, g.now));
    else
      statements.push(
        core.statement(
          `UPDATE v2_upload_sessions SET state='finalized' WHERE file_id=? AND ${sqlClaim}`,
          [file.id, claimId],
        ),
      );
    statements.push(core.finish(claimId));
    return core.changed(statements);
  };
  return {
    prepareOriginalPart: (
      actor: Actor,
      input: OriginalPartRegistration,
      paid?: PreparedStoragePaidHold,
    ) => prepareOriginalPart(core, actor, input, paid),
    abandonOriginalPart: (actor: Actor, blobId: string) => abandonOriginalPart(core, actor, blobId),
    registerOriginalPart: (actor: Actor, input: OriginalPartRegistration) =>
      registerOriginalPart(core, actor, input),
    read: (actor: Actor, id: string) => safe(() => read(actor, id)),
    metadata(actor: Actor, id: string) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, id);
        const row = await rowForOwner(actor, id);
        if (!row) return null;
        const value = await fileMetadata(actor, row);
        const current = await rowForOwner(actor, id);
        return current?.revision === row.revision &&
          current.encrypted_payload === row.encrypted_payload &&
          current.state === row.state
          ? value
          : null;
      });
    },
    listMetadata(actor: Actor, workspaceId: string, limit = 20, afterId?: string) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, workspaceId);
        parse(z.number().int().min(1).max(50), limit);
        if (afterId) parse(opaqueIdSchema, afterId);
        const rows = await core
          .statement(
            `SELECT f.* FROM v2_files f JOIN v2_workspaces w ON w.id=f.workspace_id WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id) ${afterId ? "AND f.id>?" : ""} ORDER BY f.id LIMIT ?`,
            [workspaceId, actor.ownerId, ...(afterId ? [afterId] : []), limit],
          )
          .all<FileRow>();
        const values = [];
        for (const row of rows.results) values.push(await fileMetadata(actor, row));
        const current = await core
          .statement(
            `SELECT f.id,f.revision,f.encrypted_payload,f.state FROM v2_files f JOIN v2_workspaces w ON w.id=f.workspace_id WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id) AND f.id IN (SELECT value FROM json_each(?))`,
            [workspaceId, actor.ownerId, JSON.stringify(rows.results.map((row) => row.id))],
          )
          .all<Pick<FileRow, "id" | "revision" | "encrypted_payload" | "state">>();
        return values.filter((value) =>
          current.results.some(
            (now) =>
              now.id === value.id &&
              now.revision === value.revision &&
              now.state === value.status &&
              now.encrypted_payload ===
                rows.results.find((row) => row.id === value.id)?.encrypted_payload,
          ),
        );
      });
    },
    async *coverageFragments(actor: Actor, id: string) {
      actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
      const row = await rowForOwner(actor, id);
      if (!row?.coverage_snapshot_id) return;
      for await (const part of createV2StagingRepository(core).fragments(
        actor,
        row.coverage_snapshot_id,
      )) {
        const current = await rowForOwner(actor, id);
        if (
          !current ||
          current.revision !== row.revision ||
          current.coverage_snapshot_id !== row.coverage_snapshot_id ||
          current.encrypted_payload !== row.encrypted_payload
        )
          return;
        yield part;
      }
    },
    reserve(
      g: WorkspaceGuard,
      request: V2UploadReservationRequest,
      input: {
        fileId: string;
        uploadId: string;
        reservationId: string;
        consentId: string;
        expiresAt: string;
        admission: Admission;
      },
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        const body = parse(v2UploadReservationRequestSchema, request);
        for (const id of [input.fileId, input.uploadId, input.reservationId, input.consentId])
          parse(opaqueIdSchema, id);
        parse(admissionSchema, input.admission);
        parse(timestampSchema, input.expiresAt);
        const expiresAt = new Date(input.expiresAt).toISOString();
        if (Date.parse(expiresAt) <= Date.parse(g.now)) return false;
        if (!(await accounting.ensurePrincipal(g))) return false;
        const claimId = crypto.randomUUID();
        const predicate = storagePredicate(g.ownerId, body.byteLength, g.workspaceId, true);
        const metadata = await core.encrypt("v2_files", input.fileId, g.ownerId, 1, {
          name: body.name,
          declaredMediaType: body.mediaType,
          probe: null,
        });
        const consent = await core.encrypt("v2_consents", input.consentId, g.ownerId, 1, {
          autoProcessConsentVersion: body.autoProcessConsentVersion,
        });
        const route = `/api/v2/cases/${g.workspaceId}/files`;
        const success = await core.changed([
          core.claim(
            g,
            claimId,
            `${predicate.sql} AND w.status!='archived' AND NOT EXISTS(SELECT 1 FROM v2_idempotency WHERE owner_id=w.owner_id AND route=? AND key=? AND expires_at>?)`,
            [...predicate.values, route, input.admission.key, g.now],
          ),
          ...operationStatements(
            core,
            g,
            {
              id: input.admission.operationId,
              workspaceId: g.workspaceId,
              kind: "file_extract",
              revision: g.expectedRevision + 1,
              route,
              key: input.admission.key,
              requestHash: input.admission.requestHash,
            },
            claimId,
          ),
          ...storageReservationStatements(
            core,
            g,
            {
              id: input.reservationId,
              kind: "case_original",
              caseId: g.workspaceId,
              fileId: input.fileId,
              byteLength: body.byteLength,
              state: "reserved",
            },
            input.admission.operationId,
            claimId,
          ),
          core.statement(
            `INSERT INTO v2_files(id,workspace_id,operation_id,state,declared_bytes,encrypted_payload,created_at,updated_at) SELECT ?,?,?,'reserved',?,?,?,? WHERE ${sqlClaim}`,
            [
              input.fileId,
              g.workspaceId,
              input.admission.operationId,
              body.byteLength,
              metadata,
              g.now,
              g.now,
              claimId,
            ],
          ),
          core.statement(
            `INSERT INTO v2_upload_sessions(id,file_id,reserved_bytes,state,expires_at,created_at) SELECT ?,?,?,'open',?,? WHERE ${sqlClaim}`,
            [input.uploadId, input.fileId, body.byteLength, expiresAt, g.now, claimId],
          ),
          core.statement(
            `INSERT INTO v2_consents(id,owner_id,file_id,kind,version,encrypted_payload,created_at) SELECT ?,?,?,'auto_processing',?,?,? WHERE ${sqlClaim}`,
            [
              input.consentId,
              g.ownerId,
              input.fileId,
              body.autoProcessConsentVersion,
              consent,
              g.now,
              claimId,
            ],
          ),
          core.bump(g, claimId),
          core.finish(claimId),
        ]);
        return success
          ? parse(v2UploadSessionSchema, {
              schemaVersion: "2",
              fileId: input.fileId,
              uploadSession: input.uploadId,
              chunkBytes: 8388608,
              reservedBytes: body.byteLength,
              expiresAt,
            })
          : null;
      });
    },
    recordPart(
      actor: Actor,
      uploadId: string,
      expectedRevision: number,
      ordinal: number,
      blobId: string,
      bytes: number,
      cipherHash: string,
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, uploadId);
        parse(opaqueIdSchema, blobId);
        parse(z.number().int().positive(), expectedRevision);
        parse(z.number().int().min(0).max(119), ordinal);
        parse(z.number().int().min(1).max(8388608), bytes);
        parse(hashSchema, cipherHash);
        const blob = await core
          .statement(
            "SELECT b.encrypted_payload,b.key_version FROM v2_blobs b JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=? AND b.state='stored' AND b.kind='original' AND b.visibility='private' AND b.logical_bytes=? AND b.cipher_hash=?",
            [blobId, actor.ownerId, bytes, cipherHash],
          )
          .first<{ encrypted_payload: string; key_version: string }>();
        if (!blob) return false;
        const hash = await core.decrypt(
          "v2_blobs",
          blobId,
          actor.ownerId,
          1,
          blob.encrypted_payload,
          z.strictObject({ contentHash: hashSchema }),
        );
        const payload = await core.encrypt(
          "v2_upload_parts",
          `${uploadId}-${ordinal}`,
          actor.ownerId,
          expectedRevision,
          {
            blobId,
            keyVersion: blob.key_version,
            contentHash: hash.contentHash,
            index: ordinal,
            byteLength: bytes,
          },
        );
        return (
          (
            await core
              .statement(
                `INSERT INTO v2_upload_parts(upload_id,ordinal,blob_id,byte_length,cipher_hash,encrypted_payload) SELECT u.id,?,b.id,?,?,? FROM v2_upload_sessions u JOIN v2_files f ON f.id=u.file_id JOIN v2_workspaces w ON w.id=f.workspace_id JOIN v2_blobs b ON b.id=? JOIN v2_storage_reservations r ON r.id=b.reservation_id WHERE u.id=? AND u.revision=? AND u.state='open' AND u.expires_at>? AND w.owner_id=? AND ${aliveWorkspace} AND r.entity_id=f.id AND r.kind='case_original' AND b.kind='original' AND b.visibility='private' AND b.state='stored' AND b.logical_bytes=? AND b.cipher_hash=? AND b.encrypted_payload=? AND b.key_version=? AND ?<ceil(u.reserved_bytes/8388608.0) AND ?=min(8388608,u.reserved_bytes-?*8388608) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id) ON CONFLICT(upload_id,ordinal) DO NOTHING`,
                [
                  ordinal,
                  bytes,
                  cipherHash,
                  payload,
                  blobId,
                  uploadId,
                  expectedRevision,
                  actor.now,
                  actor.ownerId,
                  bytes,
                  cipherHash,
                  blob.encrypted_payload,
                  blob.key_version,
                  ordinal,
                  bytes,
                  ordinal,
                ],
              )
              .run()
          ).meta.changes === 1
        );
      });
    },
    // Trusted upload processor records the actual whole-original digest after streaming every part.
    recordOriginalDigest(
      actor: Actor,
      uploadId: string,
      expectedRevision: number,
      contentHash: string,
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(hashSchema, contentHash);
        const envelope = await core.encrypt(
          "v2_upload_sessions",
          uploadId,
          actor.ownerId,
          expectedRevision,
          { contentHash },
        );
        return (
          (
            await core
              .statement(
                `UPDATE v2_upload_sessions SET encrypted_payload=? WHERE id=? AND revision=? AND state='open' AND encrypted_payload IS NULL AND expires_at>? AND (SELECT sum(byte_length) FROM v2_upload_parts WHERE upload_id=v2_upload_sessions.id)=reserved_bytes AND (SELECT count(*) FROM v2_upload_parts WHERE upload_id=v2_upload_sessions.id)=ceil(reserved_bytes/8388608.0) AND EXISTS(SELECT 1 FROM v2_files f JOIN v2_workspaces w ON w.id=f.workspace_id WHERE f.id=v2_upload_sessions.file_id AND w.owner_id=? AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id))`,
                [envelope, uploadId, expectedRevision, actor.now, actor.ownerId],
              )
              .run()
          ).meta.changes === 1
        );
      });
    },
    finishUpload(g: WorkspaceGuard, file: V2File) {
      return safe(async () => {
        g = parse(guardSchema, g);
        const value = parse(v2FileSchema, file);
        const upload = await core
          .statement(
            `SELECT u.* FROM v2_upload_sessions u JOIN v2_files f ON f.id=u.file_id JOIN v2_workspaces w ON w.id=f.workspace_id WHERE f.id=? AND w.owner_id=? AND ${aliveWorkspace} AND u.state='open'`,
            [value.id, g.ownerId],
          )
          .first<{ id: string; revision: number; encrypted_payload: string | null }>();
        if (!upload?.encrypted_payload || !value.manifest) return false;
        const original = await core.decrypt(
          "v2_upload_sessions",
          upload.id,
          g.ownerId,
          upload.revision,
          upload.encrypted_payload,
          z.strictObject({ contentHash: hashSchema }),
        );
        if (original.contentHash !== value.manifest.contentHash) return false;
        const parts = await core
          .statement(
            "SELECT p.*,b.key_version,b.encrypted_payload AS blob_payload FROM v2_upload_parts p JOIN v2_blobs b ON b.id=p.blob_id WHERE p.upload_id=? ORDER BY p.ordinal",
            [upload.id],
          )
          .all<{
            ordinal: number;
            byte_length: number;
            blob_id: string;
            key_version: string;
            encrypted_payload: string;
            blob_payload: string;
            cipher_hash: string;
          }>();
        if (parts.results.length !== value.manifest.parts.length) return false;
        const guards = [];
        for (const [i, part] of parts.results.entries()) {
          const receipt = await core.decrypt(
            "v2_upload_parts",
            `${upload.id}-${i}`,
            g.ownerId,
            upload.revision,
            part.encrypted_payload,
            z.strictObject({
              blobId: opaqueIdSchema,
              keyVersion: z.string(),
              contentHash: hashSchema,
              index: z.number().int(),
              byteLength: z.number().int(),
            }),
          );
          const actualBlob = await core.decrypt(
            "v2_blobs",
            part.blob_id,
            g.ownerId,
            1,
            part.blob_payload,
            z.strictObject({ contentHash: hashSchema }),
          );
          const expected = value.manifest.parts[i];
          if (
            actualBlob.contentHash !== receipt.contentHash ||
            !expected ||
            part.ordinal !== i ||
            receipt.index !== i ||
            receipt.blobId !== part.blob_id ||
            receipt.keyVersion !== part.key_version ||
            receipt.byteLength !== expected.byteLength ||
            receipt.contentHash !== expected.contentHash
          )
            return false;
          guards.push({
            index: i,
            blobId: part.blob_id,
            payload: part.encrypted_payload,
            blobPayload: part.blob_payload,
            keyVersion: part.key_version,
            cipherHash: part.cipher_hash,
          });
        }
        return write(
          g,
          value,
          null,
          {},
          {
            sql: "EXISTS(SELECT 1 FROM v2_upload_sessions WHERE id=? AND state='open' AND encrypted_payload=?) AND (SELECT count(*) FROM json_each(?) expected JOIN v2_upload_parts p ON p.upload_id=? AND p.ordinal=json_extract(expected.value,'$.index') JOIN v2_blobs b ON b.id=p.blob_id WHERE p.blob_id=json_extract(expected.value,'$.blobId') AND p.encrypted_payload=json_extract(expected.value,'$.payload') AND b.encrypted_payload=json_extract(expected.value,'$.blobPayload') AND b.key_version=json_extract(expected.value,'$.keyVersion') AND b.cipher_hash=json_extract(expected.value,'$.cipherHash') AND b.state='stored')=?",
            values: [
              upload.id,
              upload.encrypted_payload,
              JSON.stringify(guards),
              upload.id,
              guards.length,
            ],
          },
        );
      });
    },
    writeProcessed: (
      g: WorkspaceGuard,
      file: V2File,
      lease: JobLease,
      derivativeBlobs: Readonly<Record<string, string>>,
    ) => safe(() => write(g, file, lease, derivativeBlobs)),
    editObservations(g: WorkspaceGuard, fileId: string, request: V2ObservationEditRequest) {
      return safe(async () => {
        g = parse(guardSchema, g);
        const edit = parse(v2ObservationEditRequestSchema, request);
        const file = await read(g, fileId);
        if (
          file?.status !== "ready" ||
          file.revision !== edit.expectedRevision ||
          edit.edits.some((e) => !file.observations.some((o) => o.id === e.observationId))
        )
          return false;
        const claimId = crypto.randomUUID();
        const revision = file.revision + 1;
        const envelope = await core.encrypt("v2_files", fileId, g.ownerId, revision, {
          name: file.name,
          declaredMediaType: file.declaredMediaType,
          probe: file.probe,
        });
        const manifestId = crypto.randomUUID();
        const coverageId = crypto.randomUUID();
        const statements = [
          core.claim(
            g,
            claimId,
            "EXISTS(SELECT 1 FROM v2_files WHERE id=? AND workspace_id=w.id AND revision=? AND state='ready')",
            [fileId, file.revision],
          ),
          ...(await snapshotStatements(
            core,
            {
              id: manifestId,
              ownerId: g.ownerId,
              workspaceId: g.workspaceId,
              targetId: fileId,
              revision,
              purpose: "file_manifest",
              now: g.now,
            },
            file.manifest,
            claimId,
          )),
          ...(await snapshotStatements(
            core,
            {
              id: coverageId,
              ownerId: g.ownerId,
              workspaceId: g.workspaceId,
              targetId: fileId,
              revision,
              purpose: "file_coverage",
              now: g.now,
            },
            file.coverage,
            claimId,
          )),
        ];
        for (const [ordinal, old] of file.observations.entries()) {
          const change = edit.edits.find((e) => e.observationId === old.id);
          const value = change
            ? {
                ...old,
                text: change.text,
                included: change.included,
                userEdited: true,
                certainty: "uncertain" as const,
              }
            : old;
          const id = crypto.randomUUID();
          const ciphertext = await core.encrypt(
            "v2_file_observations",
            id,
            g.ownerId,
            revision,
            value,
          );
          statements.push(
            core.statement(
              `INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload) SELECT ?,?,?,?,?,?,? WHERE ${sqlClaim}`,
              [id, value.id, fileId, revision, revision, ordinal, ciphertext, claimId],
            ),
          );
        }
        const derivatives = await core
          .statement(
            "SELECT * FROM v2_file_derivatives WHERE file_id=? AND file_revision=? ORDER BY ordinal",
            [fileId, file.revision],
          )
          .all<{
            entity_id: string;
            kind: string;
            blob_id: string;
            ordinal: number;
            encrypted_payload: string;
            id: string;
          }>();
        for (const derivative of derivatives.results) {
          const id = crypto.randomUUID();
          const body = await core.decrypt(
            "v2_file_derivatives",
            derivative.id,
            g.ownerId,
            file.revision,
            derivative.encrypted_payload,
            v2DerivativeSchema,
          );
          const ciphertext = await core.encrypt(
            "v2_file_derivatives",
            id,
            g.ownerId,
            revision,
            body,
          );
          statements.push(
            core.statement(
              `INSERT INTO v2_file_derivatives(id,entity_id,file_id,file_revision,kind,blob_id,ordinal,encrypted_payload) SELECT ?,?,?,?,?,?,?,? WHERE ${sqlClaim}`,
              [
                id,
                body.id,
                fileId,
                revision,
                derivative.kind,
                derivative.blob_id,
                derivative.ordinal,
                ciphertext,
                claimId,
              ],
            ),
          );
        }
        statements.push(
          core.statement(
            `UPDATE v2_files SET revision=?,manifest_snapshot_id=?,coverage_snapshot_id=?,encrypted_payload=?,updated_at=? WHERE id=? AND ${sqlClaim}`,
            [revision, manifestId, coverageId, envelope, g.now, fileId, claimId],
          ),
          core.bump(g, claimId),
          core.finish(claimId),
        );
        return core.changed(statements);
      });
    },
    list(actor: Actor, workspaceId: string, limit = 4, beforeId?: string) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(z.number().int().min(1).max(50), limit);
        if (limit > 4) throw new V2RepositoryError("SNAPSHOT_STREAM_REQUIRED");
        const rows = await core
          .statement(
            `SELECT f.id FROM v2_files f JOIN v2_workspaces w ON w.id=f.workspace_id WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace}${beforeId ? " AND f.id>?" : ""} ORDER BY f.id LIMIT ?`,
            [workspaceId, actor.ownerId, ...(beforeId ? [beforeId] : []), limit],
          )
          .all<{ id: string }>();
        return Promise.all(rows.results.map((r) => read(actor, r.id)));
      });
    },
  };
}
