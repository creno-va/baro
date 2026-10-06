import { sha256 } from "@noble/hashes/sha2.js";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../../contracts";
import { v2PortfolioAssetSchema } from "../../../contracts/v2";
import * as schema from "../../db/schema";
import { hashSchema, type V2Core } from "../../db/v2-core";
import { createV2JobsRepository, jobAlive } from "../../db/v2-jobs";
import { createV2LawyersRepository } from "../../db/v2-lawyers";
import { type BlobRegistration, createV2StorageRepository } from "../../db/v2-storage";
import type { JobLease } from "../../db/v2-workspace";
import { hasCurrentConsent } from "../consent/service";
import { hex } from "../files/binary";
import type { PrivateBucket } from "../files/service";
import { boundedReader } from "../lawyers/asset-binary";
import { ProcessingError } from "./protocol";
import { createSanitizedEncoder, decryptSanitizedFrame } from "./sanitized-binary";
import type { SanitizedManifest } from "./sanitized-protocol";
import { authorize, type ProcessingCosts, type ProcessorTransport } from "./transport";

export const assetProcessingParamsSchema = z.strictObject({
  ownerId: opaqueIdSchema,
  profileId: opaqueIdSchema,
  assetId: opaqueIdSchema,
  assetRevision: z.number().int().positive(),
  jobId: opaqueIdSchema,
});
export type AssetProcessingParams = z.infer<typeof assetProcessingParamsSchema>;
type OriginalInput = Pick<
  AssetProcessingParams,
  "ownerId" | "profileId" | "assetId" | "assetRevision"
>;
type SanitizedInput = OriginalInput & { sourceBlobId: string };

/** Private asset scope, independent of case/file AAD. Admission/acquisition is
 * performed by the trusted Workflow factory, never by a client budget flag. */
export function createAssetProcessingService(
  core: V2Core,
  options: {
    environment: "preview" | "production";
    instanceId: string;
    bucket: PrivateBucket;
    processor: ProcessorTransport;
    costs: ProcessingCosts;
    clock?: () => string;
    fixedLength?: (size: number) => {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<Uint8Array>;
    };
    openOriginal: (
      input: OriginalInput,
      authorized: () => Promise<boolean>,
    ) => Promise<{ byteLength: number; contentHash: string; body: ReadableStream<Uint8Array> }>;
  },
) {
  const storage = createV2StorageRepository(core),
    jobs = createV2JobsRepository(core),
    lawyers = createV2LawyersRepository(core);
  const actor = (ownerId: string) => ({
    ownerId,
    now: new Date(
      timestampSchema.parse((options.clock ?? (() => new Date().toISOString()))()),
    ).toISOString(),
  });
  const consent = (ownerId: string) =>
    hasCurrentConsent(drizzle(core.binding, { schema }), ownerId);
  const current = async (params: AssetProcessingParams, lease: JobLease) => {
    if (!(await consent(params.ownerId)) || lease.jobId !== params.jobId) return null;
    const row = await core
      .statement(
        `SELECT j.operation_id,a.original_blob_id,a.purpose,a.encrypted_payload AS asset_payload,original.encrypted_payload AS source_payload,original.cipher_bytes,original.cipher_hash
      FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id JOIN v2_assets a ON a.id=j.target_id JOIN v2_profiles p ON p.id=a.profile_id
      JOIN v2_blobs original ON original.id=a.original_blob_id JOIN v2_billing_principals principal ON principal.id=original.principal_id
      WHERE j.id=? AND o.owner_id=? AND j.runtime_instance_id=? AND j.target_kind='profile_asset' AND j.kind='portfolio_sanitize'
      AND j.profile_id=? AND j.target_id=? AND j.target_revision=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>?
      AND j.status IN ('running','validating') AND o.state IN ('admitted','ambiguous') AND ${jobAlive}
      AND a.owner_id=o.owner_id AND p.owner_id=o.owner_id AND a.state='sanitizing' AND a.purpose IN ('profile_photo','portfolio')
      AND original.state='stored' AND original.visibility='private' AND principal.owner_id=o.owner_id
      AND ((a.purpose='profile_photo' AND original.kind='profile_photo_original') OR (a.purpose='portfolio' AND original.kind='portfolio_original'))`,
        [
          params.jobId,
          params.ownerId,
          options.instanceId,
          params.profileId,
          params.assetId,
          params.assetRevision,
          lease.token,
          lease.fencing,
          actor(params.ownerId).now,
        ],
      )
      .first<{
        operation_id: string;
        original_blob_id: string;
        purpose: "profile_photo" | "portfolio";
        asset_payload: string;
        source_payload: string;
        cipher_bytes: number;
        cipher_hash: string;
      }>();
    return row && (await consent(params.ownerId)) ? row : null;
  };
  const receiptId = (
    params: AssetProcessingParams,
    fencing: number,
    operationId: string,
    originalId: string,
    originalPayload: string,
    kind: string,
    purpose: string,
    blob: BlobRegistration,
  ) =>
    hex(
      sha256(
        new TextEncoder().encode(
          JSON.stringify({
            version: 1,
            environment: options.environment,
            params,
            fencing,
            operationId,
            originalId,
            originalPayloadHash: hex(sha256(new TextEncoder().encode(originalPayload))),
            kind,
            purpose,
            blob,
          }),
        ),
      ),
    );
  // The checkpoint retains only encrypted opaque IDs, including a content
  // addressed receipt ID. Its actual job/fencing
  // binds a stored receipt to this execution even after pending metadata is
  // replaced with the verified stored content hash.
  const storedReceipt = async (params: AssetProcessingParams, lease: JobLease | null) => {
    if (!(await consent(params.ownerId)) || (lease && lease.jobId !== params.jobId)) return null;
    const queryCheckpoint = () =>
      core
        .statement(
          `SELECT c.id,c.revision,c.encrypted_payload,c.fencing FROM v2_job_checkpoints c
      JOIN v2_jobs j ON j.id=c.job_id JOIN v2_operations o ON o.id=j.operation_id
      JOIN v2_assets a ON a.id=j.target_id JOIN v2_profiles p ON p.id=a.profile_id
      WHERE j.id=? AND o.owner_id=? AND j.runtime_instance_id=? AND j.target_kind='profile_asset' AND j.kind='portfolio_sanitize'
      AND j.profile_id=? AND a.profile_id=j.profile_id AND a.owner_id=o.owner_id AND p.owner_id=o.owner_id
      AND j.target_id=? AND j.target_revision=? AND c.fencing=j.fencing AND c.phase='assembling'
      AND ${lease ? `j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.status IN ('running','validating') AND o.state IN ('admitted','ambiguous') AND a.revision=j.target_revision AND a.state='sanitizing' AND ${jobAlive}` : `j.status='completed' AND o.state='completed' AND a.revision=j.target_revision+1 AND a.state='ready' AND a.current_job_id IS NULL`}
      AND NOT EXISTS(SELECT 1 FROM v2_tombstones t WHERE (t.target_kind='account' AND t.target_id=a.owner_id) OR (t.target_kind='profile' AND t.target_id=p.id) OR (t.target_kind='asset' AND t.target_id=a.id))
      ORDER BY c.revision DESC LIMIT 1`,
          [
            params.jobId,
            params.ownerId,
            options.instanceId,
            params.profileId,
            params.assetId,
            params.assetRevision,
            ...(lease ? [lease.token, lease.fencing, actor(params.ownerId).now] : []),
          ],
        )
        .first<{ id: string; revision: number; encrypted_payload: string; fencing: number }>();
    const checkpoint = await queryCheckpoint();
    if (!checkpoint) return null;
    const {
      opaqueIds: [blobId, originalId, expectedReceiptId],
    } = await core.decrypt(
      "v2_job_checkpoints",
      checkpoint.id,
      params.ownerId,
      checkpoint.revision,
      checkpoint.encrypted_payload,
      z.strictObject({ opaqueIds: z.tuple([opaqueIdSchema, opaqueIdSchema, hashSchema]) }),
    );
    const state = await core
      .statement("SELECT state FROM v2_blobs WHERE id=?", [blobId])
      .first<string>("state");
    if (state === "pending") return null;
    const query = () =>
      core
        .statement(
          `SELECT j.operation_id,b.reservation_id,a.encrypted_payload AS asset_payload,original.encrypted_payload AS original_payload,b.encrypted_payload AS blob_payload,
      original.logical_bytes AS original_bytes,b.logical_bytes,b.cipher_bytes,b.cipher_hash,b.object_key,a.purpose
      FROM v2_assets a JOIN v2_profiles p ON p.id=a.profile_id
      JOIN v2_blobs b ON b.id=? JOIN v2_blobs original ON original.id=a.original_blob_id AND original.principal_id=b.principal_id
      JOIN v2_billing_principals principal ON principal.id=b.principal_id JOIN v2_storage_reservations r ON r.id=b.reservation_id
      JOIN v2_jobs j ON j.id=? JOIN v2_operations o ON o.id=j.operation_id
      WHERE a.id=? AND a.owner_id=? AND a.profile_id=? AND p.owner_id=a.owner_id AND principal.owner_id=a.owner_id
      AND a.original_blob_id=? AND b.source_blob_id=a.original_blob_id AND b.source_asset_revision=?
      AND b.state='stored' AND b.visibility='staging' AND b.key_version='asset_sanitized_v1' AND b.object_key='private/'||b.id
      AND original.state='stored' AND original.visibility='private'
      AND r.principal_id=principal.id AND r.byte_length=b.logical_bytes AND r.kind='lawyer_asset' AND r.entity_id=a.id AND r.target_id=b.id AND r.state='stored' AND r.operation_id=o.id
      AND ((a.purpose='profile_photo' AND b.kind='profile_photo_sanitized' AND original.kind='profile_photo_original') OR (a.purpose='portfolio' AND b.kind='portfolio_sanitized' AND original.kind='portfolio_original'))
      AND ${lease ? `a.state='sanitizing' AND a.revision=? AND a.current_job_id=j.id` : `a.state='ready' AND a.revision=? AND a.sanitized_blob_id=b.id AND a.current_job_id IS NULL`}
      AND NOT EXISTS(SELECT 1 FROM v2_tombstones t WHERE (t.target_kind='account' AND t.target_id=a.owner_id) OR (t.target_kind='profile' AND t.target_id=p.id) OR (t.target_kind='asset' AND t.target_id=a.id))`,
          [
            blobId,
            params.jobId,
            params.assetId,
            params.ownerId,
            params.profileId,
            originalId,
            params.assetRevision,
            params.assetRevision + (lease ? 0 : 1),
          ],
        )
        .first<{
          operation_id: string;
          reservation_id: string;
          asset_payload: string;
          original_payload: string;
          blob_payload: string;
          original_bytes: number;
          logical_bytes: number;
          cipher_bytes: number;
          cipher_hash: string;
          object_key: string;
          purpose: string;
        }>();
    const row = await query();
    if (
      !row ||
      !hashSchema.safeParse(row.cipher_hash).success ||
      row.logical_bytes < 1 ||
      row.logical_bytes > 100000000 ||
      row.cipher_bytes <= row.logical_bytes ||
      row.cipher_bytes > 128000000
    )
      throw new ProcessingError("STALE_REVISION");
    const value = await core.decrypt(
      "v2_assets",
      params.assetId,
      params.ownerId,
      params.assetRevision + (lease ? 0 : 1),
      row.asset_payload,
      v2PortfolioAssetSchema,
    );
    const metadata = z.strictObject({ contentHash: hashSchema });
    const stored = await core.decrypt(
      "v2_blobs",
      blobId,
      params.ownerId,
      1,
      row.blob_payload,
      metadata,
    );
    const original = await core.decrypt(
      "v2_blobs",
      originalId,
      params.ownerId,
      1,
      row.original_payload,
      metadata,
    );
    const format = value.kind === "pdf" ? ("pdf" as const) : ("jpeg" as const);
    const actualReceiptId = receiptId(
      params,
      checkpoint.fencing,
      row.operation_id,
      originalId,
      row.original_payload,
      value.kind,
      row.purpose,
      {
        id: blobId,
        reservationId: row.reservation_id,
        kind: row.purpose === "profile_photo" ? "profile_photo_sanitized" : "portfolio_sanitized",
        visibility: "staging",
        logicalBytes: row.logical_bytes,
        cipherBytes: row.cipher_bytes,
        cipherHash: row.cipher_hash,
        contentHash: stored.contentHash,
        keyVersion: "asset_sanitized_v1",
      },
    );
    if (
      actualReceiptId !== expectedReceiptId ||
      value.originalHash !== original.contentHash ||
      value.byteLength !== row.original_bytes ||
      (value.kind !== "pdf" && value.kind !== "image") ||
      (row.purpose === "profile_photo" && format !== "jpeg") ||
      (lease === null &&
        (value.status !== "ready" ||
          value.sanitizedDerivative?.id !== blobId ||
          value.sanitizedDerivative.contentHash !== stored.contentHash ||
          value.sanitizedDerivative.byteLength !== row.logical_bytes ||
          value.sanitizedDerivative.format !== format)) ||
      !(await consent(params.ownerId)) ||
      JSON.stringify(await queryCheckpoint()) !== JSON.stringify(checkpoint) ||
      JSON.stringify(await query()) !== JSON.stringify(row)
    )
      throw new ProcessingError("STALE_REVISION");
    return {
      value,
      originalId,
      blobId,
      contentHash: stored.contentHash,
      byteLength: row.logical_bytes,
      format,
    };
  };
  const readyResult = (params: AssetProcessingParams) => ({
    status: "ready" as const,
    assetId: params.assetId,
    revision: params.assetRevision + 1,
  });
  const completed = async (input: AssetProcessingParams) => {
    const params = assetProcessingParamsSchema.parse(input);
    return (await storedReceipt(params, null)) ? readyResult(params) : null;
  };
  return {
    completed,
    async sanitize(input: AssetProcessingParams, lease: JobLease, signal: AbortSignal) {
      const params = assetProcessingParamsSchema.parse(input);
      if (signal.aborted) throw new ProcessingError("STALE_REVISION");
      const completedFence =
        lease.jobId === params.jobId &&
        (await core
          .statement("SELECT id FROM v2_jobs WHERE id=? AND fencing=?", [
            params.jobId,
            lease.fencing,
          ])
          .first());
      const done = completedFence ? await completed(params) : null;
      if (done) return done;
      const access = { signal, authorize: async () => Boolean(await current(params, lease)) };
      const source = await current(params, lease);
      if (!source || signal.aborted) throw new ProcessingError("STALE_REVISION");
      const recovered = await storedReceipt(params, lease);
      if (recovered) {
        if (
          !(await authorize(access)) ||
          recovered.originalId !== source.original_blob_id ||
          !(await lawyers.saveAsset(
            actor(params.ownerId),
            params.assetId,
            params.assetRevision,
            {
              ...recovered.value,
              revision: params.assetRevision + 1,
              status: "ready",
              currentJobId: null,
              failure: null,
              sanitizedDerivative: {
                id: recovered.blobId,
                contentHash: recovered.contentHash,
                byteLength: recovered.byteLength,
                format: recovered.format,
              },
            },
            recovered.originalId,
            recovered.blobId,
            lease,
          ))
        )
          throw new ProcessingError("STALE_REVISION");
        return readyResult(params);
      }
      const renewalActor = actor(params.ownerId);
      if (
        !(await jobs.renew(
          renewalActor,
          lease,
          new Date(Date.parse(renewalActor.now) + 300000).toISOString(),
        ))
      )
        throw new ProcessingError("STALE_REVISION");
      const originalPermit = await options.costs.before(
        {
          service: "storage",
          action: "r2_get",
          identity: `asset-original:${source.original_blob_id}:${source.cipher_hash}`,
          byteLength: source.cipher_bytes,
          durationSeconds: null,
        },
        access,
      );
      if (!originalPermit) throw new ProcessingError("BUDGET_UNAVAILABLE");
      if (!(await authorize(access))) {
        await options.costs.after(originalPermit, { transport: "not_sent" });
        throw new ProcessingError("STALE_REVISION");
      }
      let original: Awaited<ReturnType<typeof options.openOriginal>>;
      try {
        original = await options.openOriginal(params, access.authorize);
        await options.costs.after(originalPermit, { transport: "response" });
      } catch {
        await options.costs.after(originalPermit, { transport: "unknown" });
        throw new ProcessingError("STORAGE_UNAVAILABLE");
      }
      const value = v2PortfolioAssetSchema.parse(
        await lawyers.readAsset(actor(params.ownerId), params.assetId),
      );
      if (
        value.revision !== params.assetRevision ||
        value.originalHash !== original.contentHash ||
        value.byteLength !== original.byteLength
      )
        throw new ProcessingError("FILE_REJECTED");
      const blobId = crypto.randomUUID(),
        reservationId = crypto.randomUUID();
      const stream = options.processor.sanitize(
        {
          byteLength: original.byteLength,
          contentHash: original.contentHash,
          open: () => original.body,
        },
        access,
      );
      let prepared: BlobRegistration | undefined;
      let captured: Awaited<ReturnType<typeof storage.captureSanitizedAssetBlobIntent>> = null;
      let putSent = false,
        putReturned = false;
      let permit: Awaited<ReturnType<ProcessingCosts["before"]>> = null;
      try {
        const first = await stream.next();
        if (first.done || first.value.type !== "manifest")
          throw new ProcessingError("FILE_REJECTED");
        const manifest: SanitizedManifest = first.value.manifest;
        if (
          (value.kind === "pdf") !== (manifest.format === "pdf") ||
          (source.purpose === "profile_photo" && manifest.format !== "jpeg")
        )
          throw new ProcessingError("FILE_REJECTED");
        const encoder = await createSanitizedEncoder(
          core.cipher,
          {
            environment: options.environment,
            ownerId: params.ownerId,
            profileId: params.profileId,
            assetId: params.assetId,
            assetRevision: params.assetRevision,
            sourceBlobId: source.original_blob_id,
            blobId,
          },
          manifest,
        );
        for (let index = 0; index < manifest.chunkCount; index++) {
          const part = await stream.next();
          if (
            part.done ||
            part.value.type !== "chunk" ||
            part.value.pass !== 0 ||
            part.value.index !== index
          )
            throw new ProcessingError("FILE_REJECTED");
          await encoder.observe(index, part.value.bytes);
        }
        const wire = encoder.seal();
        prepared = {
          id: blobId,
          reservationId,
          kind:
            source.purpose === "profile_photo" ? "profile_photo_sanitized" : "portfolio_sanitized",
          visibility: "staging",
          logicalBytes: manifest.byteLength,
          cipherBytes: wire.cipherBytes,
          cipherHash: wire.cipherHash,
          contentHash: manifest.contentHash,
          keyVersion: "asset_sanitized_v1",
        };
        const checkpointRevision = await core
          .statement(
            "SELECT coalesce(max(revision),0)+1 AS revision FROM v2_job_checkpoints WHERE job_id=?",
            [params.jobId],
          )
          .first<number>("revision");
        if (
          !checkpointRevision ||
          !(await jobs.checkpoint(actor(params.ownerId), lease, {
            id: crypto.randomUUID(),
            revision: checkpointRevision,
            phase: "assembling",
            progress: 95,
            opaqueIds: [
              blobId,
              source.original_blob_id,
              receiptId(
                params,
                lease.fencing,
                source.operation_id,
                source.original_blob_id,
                source.source_payload,
                value.kind,
                source.purpose,
                prepared,
              ),
            ],
          }))
        )
          throw new ProcessingError("STALE_REVISION");
        if (!(await storage.prepareSanitizedAssetBlob(actor(params.ownerId), lease, prepared)))
          throw new ProcessingError("STALE_REVISION");
        captured = await storage.captureSanitizedAssetBlobIntent(
          actor(params.ownerId),
          lease,
          blobId,
        );
        if (!captured) throw new ProcessingError("STALE_REVISION");
        permit = await options.costs.before(
          {
            service: "storage",
            action: "r2_put",
            identity: `asset-put:${blobId}:${wire.cipherHash}`,
            byteLength: wire.cipherBytes,
            durationSeconds: null,
          },
          access,
        );
        if (!permit) throw new ProcessingError("BUDGET_UNAVAILABLE");
        let index = 0;
        const body = new ReadableStream<Uint8Array>(
          {
            async pull(controller) {
              try {
                if (!(await authorize(access))) throw new ProcessingError("STALE_REVISION");
                if (index === manifest.chunkCount) {
                  const end = await stream.next();
                  if (!end.done || !encoder.complete()) throw new ProcessingError("FILE_REJECTED");
                  controller.close();
                  return;
                }
                const part = await stream.next();
                if (
                  part.done ||
                  part.value.type !== "chunk" ||
                  part.value.pass !== 1 ||
                  part.value.index !== index
                )
                  throw new ProcessingError("FILE_REJECTED");
                const frame = await encoder.replay(index, part.value.bytes);
                if (!(await authorize(access))) {
                  frame.fill(0);
                  throw new ProcessingError("STALE_REVISION");
                }
                index++;
                controller.enqueue(frame);
              } catch (error) {
                await stream.return(undefined);
                controller.error(error);
              }
            },
            async cancel() {
              await stream.return(undefined);
            },
          },
          { highWaterMark: 0 },
        );
        if (!(await authorize(access))) {
          await options.costs.after(permit, { transport: "not_sent" });
          throw new ProcessingError("STALE_REVISION");
        }
        const fixed =
          options.fixedLength?.(wire.cipherBytes) ?? new FixedLengthStream(wire.cipherBytes);
        const pumping = body.pipeTo(fixed.writable);
        putSent = true;
        const [receipt] = await Promise.all([
          options.bucket.put(`private/${blobId}`, fixed.readable, {
            httpMetadata: {
              contentType: "application/octet-stream",
              cacheControl: "private, no-store",
            },
          }),
          pumping,
        ]);
        putReturned = true;
        await options.costs.after(permit, { transport: "response" });
        if (
          !receipt ||
          receipt.key !== `private/${blobId}` ||
          receipt.size !== wire.cipherBytes ||
          !encoder.complete() ||
          !(await authorize(access))
        )
          throw new ProcessingError("STORAGE_UNAVAILABLE");
        if (!(await storage.commitSanitizedAssetBlob(actor(params.ownerId), lease, prepared)))
          throw new ProcessingError("STALE_REVISION");
        // commitSanitizedAssetBlob transfers its actual reservation atomically.
        const ready = {
          ...value,
          revision: params.assetRevision + 1,
          status: "ready" as const,
          currentJobId: null,
          failure: null,
          sanitizedDerivative: {
            id: blobId,
            contentHash: manifest.contentHash,
            byteLength: manifest.byteLength,
            format: manifest.format,
          },
        };
        if (
          !(await lawyers.saveAsset(
            actor(params.ownerId),
            params.assetId,
            params.assetRevision,
            ready,
            source.original_blob_id,
            blobId,
            lease,
          ))
        )
          throw new ProcessingError("STALE_REVISION");
        return {
          status: "ready" as const,
          assetId: params.assetId,
          revision: params.assetRevision + 1,
        };
      } catch (error) {
        if (permit && putSent && !putReturned)
          await options.costs.after(permit, { transport: "unknown" });
        if (prepared) await storage.abandonSanitizedAssetBlob(actor(params.ownerId), prepared.id);
        if (captured && putSent) {
          // Freeze the exact prePUT generation for funded cleanup. A missing
          // object is harmless; this path must not make an unreserved HEAD call.
          await storage.requeueSanitizedAssetBlobCleanup(actor(params.ownerId), captured);
        }
        if (error instanceof ProcessingError) throw error;
        throw new ProcessingError("FILE_PROCESSING_FAILED");
      } finally {
        await stream.return(undefined);
        await original.body.cancel().catch(() => {});
      }
    },
    async openSanitized(input: SanitizedInput) {
      const owner = actor(input.ownerId);
      opaqueIdSchema.parse(input.sourceBlobId);
      const row = await core
        .statement(
          `SELECT a.encrypted_payload AS asset_payload,a.original_blob_id,a.purpose,original.encrypted_payload AS original_payload,b.encrypted_payload AS blob_payload,
        b.logical_bytes,b.cipher_bytes,b.cipher_hash,b.source_asset_revision,b.object_key
        FROM v2_assets a JOIN v2_profiles p ON p.id=a.profile_id JOIN v2_blobs b ON b.id=a.sanitized_blob_id
        JOIN v2_blobs original ON original.id=a.original_blob_id AND original.principal_id=b.principal_id AND original.state='stored' AND original.visibility='private'
        JOIN v2_billing_principals principal ON principal.id=b.principal_id JOIN v2_storage_reservations r ON r.id=b.reservation_id
        WHERE a.id=? AND a.owner_id=? AND p.owner_id=? AND a.profile_id=? AND a.revision=? AND a.state='ready'
        AND b.id=? AND b.state='stored' AND b.visibility='staging' AND b.key_version='asset_sanitized_v1'
        AND b.source_blob_id=a.original_blob_id AND b.source_asset_revision=a.revision-1 AND b.object_key='private/'||b.id
        AND principal.owner_id=a.owner_id AND r.principal_id=principal.id AND r.byte_length=b.logical_bytes AND r.kind='lawyer_asset' AND r.entity_id=a.id AND r.target_id=b.id AND r.state='stored'
        AND ((a.purpose='profile_photo' AND b.kind='profile_photo_sanitized') OR (a.purpose='portfolio' AND b.kind='portfolio_sanitized'))
        AND ((a.purpose='profile_photo' AND original.kind='profile_photo_original') OR (a.purpose='portfolio' AND original.kind='portfolio_original'))
        AND NOT EXISTS(SELECT 1 FROM v2_tombstones t WHERE (t.target_kind='account' AND t.target_id=a.owner_id) OR
          (t.target_kind='profile' AND t.target_id=p.id) OR (t.target_kind='asset' AND t.target_id=a.id))`,
          [
            input.assetId,
            owner.ownerId,
            owner.ownerId,
            input.profileId,
            input.assetRevision,
            input.sourceBlobId,
          ],
        )
        .first<{
          asset_payload: string;
          original_blob_id: string;
          original_payload: string;
          purpose: string;
          blob_payload: string;
          logical_bytes: number;
          cipher_bytes: number;
          cipher_hash: string;
          source_asset_revision: number;
          object_key: string;
        }>();
      if (!row) throw new ProcessingError("STALE_REVISION");
      const valid = async () =>
        Boolean(
          await core
            .statement(
              `SELECT a.id FROM v2_assets a JOIN v2_profiles p ON p.id=a.profile_id JOIN v2_blobs b ON b.id=a.sanitized_blob_id
        JOIN v2_blobs original ON original.id=a.original_blob_id AND original.principal_id=b.principal_id AND original.state='stored' AND original.visibility='private'
        WHERE a.id=? AND a.owner_id=? AND a.profile_id=? AND a.revision=? AND a.state='ready' AND a.encrypted_payload=?
        AND b.id=? AND b.state='stored' AND b.visibility='staging' AND b.encrypted_payload=? AND b.cipher_hash=? AND b.cipher_bytes=?
        AND b.source_blob_id=? AND b.source_asset_revision=? AND a.original_blob_id=b.source_blob_id AND b.source_asset_revision=a.revision-1
        AND a.purpose=? AND original.encrypted_payload=? AND p.owner_id=a.owner_id AND b.key_version='asset_sanitized_v1' AND b.object_key=? AND b.logical_bytes=?
        AND EXISTS(SELECT 1 FROM v2_storage_reservations r JOIN v2_billing_principals principal ON principal.id=r.principal_id
          WHERE r.id=b.reservation_id AND r.principal_id=b.principal_id AND principal.owner_id=a.owner_id AND r.byte_length=b.logical_bytes
          AND r.kind='lawyer_asset' AND r.entity_id=a.id AND r.target_id=b.id AND r.state='stored')
        AND ((a.purpose='profile_photo' AND b.kind='profile_photo_sanitized' AND original.kind='profile_photo_original') OR
          (a.purpose='portfolio' AND b.kind='portfolio_sanitized' AND original.kind='portfolio_original'))
        AND NOT EXISTS(SELECT 1 FROM v2_tombstones t
          WHERE (t.target_kind='account' AND t.target_id=a.owner_id) OR (t.target_kind='profile' AND t.target_id=p.id) OR (t.target_kind='asset' AND t.target_id=a.id))`,
              [
                input.assetId,
                input.ownerId,
                input.profileId,
                input.assetRevision,
                row.asset_payload,
                input.sourceBlobId,
                row.blob_payload,
                row.cipher_hash,
                row.cipher_bytes,
                row.original_blob_id,
                row.source_asset_revision,
                row.purpose,
                row.original_payload,
                row.object_key,
                row.logical_bytes,
              ],
            )
            .first(),
        );
      const asset = await core.decrypt(
        "v2_assets",
        input.assetId,
        input.ownerId,
        input.assetRevision,
        row.asset_payload,
        v2PortfolioAssetSchema,
      );
      const metadata = await core.decrypt(
        "v2_blobs",
        input.sourceBlobId,
        input.ownerId,
        1,
        row.blob_payload,
        z.strictObject({ contentHash: hashSchema }),
      );
      const originalMetadata = await core.decrypt(
        "v2_blobs",
        row.original_blob_id,
        input.ownerId,
        1,
        row.original_payload,
        z.strictObject({ contentHash: hashSchema }),
      );
      if (
        asset.status !== "ready" ||
        asset.originalHash !== originalMetadata.contentHash ||
        asset.sanitizedDerivative?.id !== input.sourceBlobId ||
        asset.sanitizedDerivative.byteLength !== row.logical_bytes ||
        asset.sanitizedDerivative.contentHash !== metadata.contentHash ||
        !(await valid())
      )
        throw new ProcessingError("FILE_REJECTED");
      const access = { signal: new AbortController().signal, authorize: valid };
      const permit = await options.costs.before(
        {
          service: "storage",
          action: "r2_get",
          identity: `asset-get:${input.sourceBlobId}:${row.cipher_hash}`,
          byteLength: row.cipher_bytes,
          durationSeconds: null,
        },
        access,
      );
      if (!permit) throw new ProcessingError("BUDGET_UNAVAILABLE");
      if (!(await valid())) {
        await options.costs.after(permit, { transport: "not_sent" });
        throw new ProcessingError("STALE_REVISION");
      }
      let object: Awaited<ReturnType<PrivateBucket["get"]>>;
      try {
        object = await options.bucket.get(row.object_key);
        await options.costs.after(permit, { transport: "response" });
      } catch {
        await options.costs.after(permit, { transport: "unknown" });
        throw new ProcessingError("STORAGE_UNAVAILABLE");
      }
      if (!object || object.size !== row.cipher_bytes || !(await valid())) {
        await object?.body.cancel();
        throw new ProcessingError("STORAGE_UNAVAILABLE");
      }
      const reader = boundedReader(object.body),
        plainHash = sha256.create(),
        cipherHash = sha256.create();
      let index = 0,
        total = 0,
        cipherBytes = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              if (!(await valid())) throw new ProcessingError("STALE_REVISION");
              const prefix = await reader.exact(4),
                size = new DataView(prefix.buffer).getUint32(0);
              if (size < 1 || size > 8192) throw new ProcessingError("FILE_REJECTED");
              const header = await reader.exact(size),
                length = Math.min(1_048_576, row.logical_bytes - total),
                payload = await reader.exact(length + 16);
              const frame = new Uint8Array(4 + header.length + payload.length);
              frame.set(prefix);
              frame.set(header, 4);
              frame.set(payload, 4 + header.length);
              cipherHash.update(frame);
              cipherBytes += frame.length;
              const bytes = await decryptSanitizedFrame(
                core.cipher,
                {
                  environment: options.environment,
                  ownerId: input.ownerId,
                  profileId: input.profileId,
                  assetId: input.assetId,
                  assetRevision: row.source_asset_revision,
                  sourceBlobId: row.original_blob_id,
                  blobId: input.sourceBlobId,
                },
                frame,
                { index, byteLength: row.logical_bytes, contentHash: metadata.contentHash },
              );
              plainHash.update(bytes);
              total += bytes.length;
              index++;
              if (total === row.logical_bytes) {
                await reader.end();
                if (
                  cipherBytes !== row.cipher_bytes ||
                  hex(cipherHash.digest()) !== row.cipher_hash ||
                  hex(plainHash.digest()) !== metadata.contentHash
                ) {
                  bytes.fill(0);
                  throw new ProcessingError("FILE_REJECTED");
                }
              }
              if (!(await valid())) {
                bytes.fill(0);
                throw new ProcessingError("STALE_REVISION");
              }
              controller.enqueue(bytes);
              if (total === row.logical_bytes) controller.close();
            } catch (error) {
              await reader.cancel();
              controller.error(
                error instanceof ProcessingError ? error : new ProcessingError("FILE_REJECTED"),
              );
            }
          },
          cancel: () => reader.cancel(),
        },
        { highWaterMark: 0 },
      );
      return { byteLength: row.logical_bytes, contentHash: metadata.contentHash, body };
    },
  };
}
