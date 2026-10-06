import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../../contracts";
import { CURRENT_POLICY_VERSIONS } from "../../../contracts/consent";
import {
  type V2Coverage,
  type V2Derivative,
  type V2FileObservation,
  type V2FileProbe,
  v2CoverageSchema,
  v2DerivativeSchema,
  v2FileObservationSchema,
} from "../../../contracts/v2";
import * as schema from "../../db/schema";
import { fragmentText, utf8Bytes, type V2Core, type WorkspaceGuard } from "../../db/v2-core";
import { createV2FileStagingRepository } from "../../db/v2-file-staging";
import { createV2FilesRepository } from "../../db/v2-files";
import { createV2JobsRepository, jobAlive } from "../../db/v2-jobs";
import type { PreparedPaidHold } from "../../db/v2-paid-statements";
import { createV2StagingRepository } from "../../db/v2-staging";
import { type BlobRegistration, createV2StorageRepository } from "../../db/v2-storage";
import type { JobLease } from "../../db/v2-workspace";
import { hasCurrentConsent } from "../consent/service";
import { digest, readBounded } from "../files/binary";
import type { FilesService, PrivateBucket } from "../files/service";
import type { MediaGateway } from "../llm-gateway/transcription";
import { decryptArtifact, encryptArtifact } from "./artifacts";
import { ProcessingError, type ProcessorManifest, processorManifestSchema } from "./protocol";
import {
  authorize,
  type ProcessingAccess,
  type ProcessingCosts,
  type ProcessorTransport,
} from "./transport";

export const fileProcessingParamsSchema = z.strictObject({
  ownerId: opaqueIdSchema,
  workspaceId: opaqueIdSchema,
  fileId: opaqueIdSchema,
  fileRevision: z.number().int().positive(),
  jobId: opaqueIdSchema,
});
export type FileProcessingParams = z.infer<typeof fileProcessingParamsSchema>;
const resultSchema = z.strictObject({
  observations: z.array(v2FileObservationSchema).max(1000),
  status: z.enum(["processed", "low_quality", "missing", "failed"]),
  derivatives: z
    .array(z.strictObject({ value: v2DerivativeSchema, blobId: opaqueIdSchema }))
    .max(1000),
});
type Result = {
  observations: V2FileObservation[];
  status: "processed" | "low_quality" | "missing" | "failed";
  derivatives: { value: V2Derivative; blobId: string }[];
};
const unitPlanSchema = z.strictObject({
  unit: z.number().int().min(0).max(99999),
  totalUnits: z.number().int().positive().max(100000),
  manifestId: opaqueIdSchema,
  observationOrdinal: z.number().int().min(0).max(10000),
  derivativeOrdinal: z.number().int().min(0).max(20000),
  observationCount: z.number().int().min(0).max(10000),
  derivativeCount: z.number().int().min(0).max(20000),
  results: z
    .array(
      z.strictObject({
        id: opaqueIdSchema,
        observations: z.number().int().min(0).max(1000),
        derivatives: z.number().int().min(0).max(1000),
        status: z.enum(["processed", "low_quality", "missing", "failed"]),
      }),
    )
    .max(20000),
});
const publicationSchema = z.strictObject({
  coverageId: opaqueIdSchema,
  parts: z.array(opaqueIdSchema).max(1000),
  observationCount: z.number().int().min(0).max(10000),
  derivativeCount: z.number().int().min(0).max(20000),
});
function initialCoverage(probe: V2FileProbe): V2Coverage {
  if (probe.category === "document")
    return {
      category: "document",
      status: "partial",
      pageCount: probe.pageCount,
      pages: Array.from({ length: probe.pageCount }, (_, i) => ({
        page: i + 1,
        status: "missing" as const,
      })),
    };
  if (probe.category === "image")
    return { category: "image", status: "partial", observation: "missing" };
  const audio = {
    durationSeconds: probe.durationSeconds,
    status: "partial" as const,
    intervals: [{ startSeconds: 0, endSeconds: probe.durationSeconds, status: "missing" as const }],
  };
  if (probe.category === "audio") return { category: "audio", audio };
  return {
    category: "video",
    durationSeconds: probe.durationSeconds,
    status: "partial",
    hasAudio: probe.hasAudio,
    audio: probe.hasAudio ? audio : null,
    frames: Array.from({ length: Math.ceil(probe.durationSeconds) }, (_, i) => ({
      id: `missing-${i}`,
      timestampSeconds: i,
      frameIndex: 0,
      sampling: "one_second" as const,
      status: "missing" as const,
    })),
    sceneDetection: "failed",
    sceneFrameCount: null,
  };
}
type JobContext = { lease: JobLease; guard: WorkspaceGuard };
const receiptSchema = z.strictObject({ opaqueIds: z.array(opaqueIdSchema).max(100) });

/** Each native unit (one page / 30 seconds) and each provider artifact is a
 * separate bounded Workflow step. Only encrypted R2 and opaque checkpoint IDs
 * survive suspension; nothing sensitive is returned to Workflow step history.
 */
export function createFileProcessingExecution(
  core: V2Core,
  paramsInput: FileProcessingParams,
  options: {
    environment: "preview" | "production";
    files: FilesService;
    bucket: PrivateBucket;
    processor: ProcessorTransport;
    media: MediaGateway;
    costs: ProcessingCosts;
    clock?: () => string;
    instanceId: string;
    /** Initial hold is already in the actual admission transaction; never fabricate a paid ID. */
    initialAttemptId?: string;
  },
) {
  const params = fileProcessingParamsSchema.parse(paramsInput);
  const files = createV2FilesRepository(core),
    jobs = createV2JobsRepository(core),
    storage = createV2StorageRepository(core);
  const staging = createV2StagingRepository(core),
    fileStaging = createV2FileStagingRepository(core);
  const now = () =>
    new Date(
      timestampSchema.parse((options.clock ?? (() => new Date().toISOString()))()),
    ).toISOString();
  const actor = () => ({ ownerId: params.ownerId, now: now() });
  const idFor = async (scope: string) =>
    `media-${(await digest(new TextEncoder().encode(`${params.jobId}:${options.instanceId}:${(await guard()).lease.fencing}:${scope}`))).slice(0, 48)}`;
  const consent = async () =>
    await hasCurrentConsent(drizzle(core.binding, { schema }), params.ownerId);
  const current = async (): Promise<JobContext | null> => {
    if (!(await consent())) return null;
    const a = actor();
    const row = await core
      .statement(
        `SELECT j.lease_token,j.fencing,j.lease_until,j.status,w.revision FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id JOIN v2_files f ON f.id=j.target_id JOIN v2_workspaces w ON w.id=f.workspace_id WHERE j.id=? AND o.owner_id=? AND j.runtime_instance_id=? AND j.target_kind='file' AND j.target_revision=? AND f.workspace_id=? AND o.state='admitted' AND w.status IN ('active','intake') AND j.status IN ('running','validating') AND j.lease_until>? AND ${jobAlive} AND EXISTS(SELECT 1 FROM v2_consents WHERE owner_id=o.owner_id AND file_id=f.id AND kind='auto_processing' AND version=?)`,
        [
          params.jobId,
          params.ownerId,
          options.instanceId,
          params.fileRevision,
          params.workspaceId,
          a.now,
          CURRENT_POLICY_VERSIONS.aiNoticeVersion,
        ],
      )
      .first<{
        lease_token: string;
        fencing: number;
        lease_until: string;
        status: string;
        revision: number;
      }>();
    return row && (await consent())
      ? {
          lease: { jobId: params.jobId, token: row.lease_token, fencing: row.fencing },
          guard: { ...a, workspaceId: params.workspaceId, expectedRevision: row.revision },
        }
      : null;
  };
  const access = (signal: AbortSignal): ProcessingAccess => ({
    signal,
    authorize: async () => Boolean(await current()),
  });
  const guard = async () => {
    const c = await current();
    if (!c) throw new ProcessingError("STALE_REVISION");
    return c;
  };
  const renew = async () => {
    const c = await guard();
    const renewalActor = actor();
    if (
      !(await jobs.renew(
        renewalActor,
        c.lease,
        new Date(Date.parse(renewalActor.now) + 300000).toISOString(),
      ))
    )
      throw new ProcessingError("STALE_REVISION");
    return guard();
  };
  const checkpoint = async (
    scope: string,
    revision: number,
    phase: "extracting" | "transcribing" | "observing" | "assembling",
    ids: string[],
  ) => {
    const checkpointId = await idFor(`checkpoint:${scope}`);
    const existing = await core
      .statement("SELECT id FROM v2_job_checkpoints WHERE id=? AND job_id=? AND fencing=?", [
        checkpointId,
        params.jobId,
        (await guard()).lease.fencing,
      ])
      .first();
    if (existing) return;
    const nextRevision = await core
      .statement(
        "SELECT coalesce(max(revision),0)+1 AS revision FROM v2_job_checkpoints WHERE job_id=?",
        [params.jobId],
      )
      .first<number>("revision");
    if (!nextRevision) throw new ProcessingError("FILE_PROCESSING_FAILED");
    if (
      !(await jobs.checkpoint(actor(), (await guard()).lease, {
        id: checkpointId,
        revision: nextRevision,
        phase,
        progress: Math.min(99, revision),
        opaqueIds: ids,
      }))
    )
      throw new ProcessingError("STALE_REVISION");
  };
  const receipt = async (scope: string) => {
    const c = await guard();
    const row = await core
      .statement(
        "SELECT id,revision,encrypted_payload FROM v2_job_checkpoints WHERE id=? AND job_id=? AND fencing=?",
        [await idFor(`checkpoint:${scope}`), params.jobId, c.lease.fencing],
      )
      .first<{ id: string; revision: number; encrypted_payload: string }>();
    if (!row) return null;
    const value = await core.decrypt(
      "v2_job_checkpoints",
      row.id,
      params.ownerId,
      row.revision,
      row.encrypted_payload,
      receiptSchema,
    );
    await guard();
    return value.opaqueIds;
  };
  const identity = (blobId: string) => ({
    environment: options.environment,
    ownerId: params.ownerId,
    blobId,
    fileId: params.fileId,
    fileRevision: params.fileRevision,
  });
  const read = async (blobId: string) => {
    await renew();
    const blob = await storage.findBlob(actor(), blobId);
    if (
      blob?.kind !== "derivative" ||
      blob.visibility !== "private" ||
      blob.key_version !== "artifact_v1"
    )
      throw new ProcessingError("STORAGE_UNAVAILABLE");
    const permit = await options.costs.before(
      {
        service: "requests",
        action: "r2_get",
        identity: `get:${blobId}:${blob.cipher_hash}`,
        byteLength: blob.cipher_bytes,
        durationSeconds: null,
      },
      access(new AbortController().signal),
    );
    if (!permit) throw new ProcessingError("BUDGET_UNAVAILABLE");
    let data: Uint8Array<ArrayBuffer>;
    try {
      if (!(await current())) {
        await options.costs.after(permit, { transport: "not_sent" });
        throw new ProcessingError("STALE_REVISION");
      }
      const object = await options.bucket.get(blob.object_key);
      await options.costs.after(permit, { transport: "response" });
      if (!object || object.size !== blob.cipher_bytes)
        throw new ProcessingError("STORAGE_UNAVAILABLE");
      data = await readBounded(object.body, object.size);
    } catch (error) {
      if (!(error instanceof ProcessingError))
        await options.costs.after(permit, { transport: "unknown" });
      throw error instanceof ProcessingError ? error : new ProcessingError("STORAGE_UNAVAILABLE");
    }
    if ((await digest(data)) !== blob.cipher_hash) throw new ProcessingError("FILE_REJECTED");
    await guard();
    const plain = await decryptArtifact(core.cipher, identity(blobId), data);
    await guard();
    return plain;
  };
  const commitReservation = async (blobId: string) => {
    const row = await core
      .statement(
        "SELECT r.id,r.state FROM v2_storage_reservations r JOIN v2_blobs b ON b.reservation_id=r.id JOIN v2_billing_principals p ON p.id=r.principal_id WHERE b.id=? AND b.state='stored' AND p.owner_id=?",
        [blobId, params.ownerId],
      )
      .first<{ id: string; state: string }>();
    if (!row || (row.state !== "stored" && !(await storage.commitReservation(actor(), row.id))))
      throw new ProcessingError("STORAGE_UNAVAILABLE");
    await guard();
  };
  const write = async (blobId: string, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal) => {
    const c = await renew();
    const existing = await storage.findBlob(actor(), blobId);
    if (existing) {
      const old = await read(blobId);
      try {
        if ((await digest(old)) !== (await digest(bytes)))
          throw new ProcessingError("FILE_REJECTED");
      } finally {
        old.fill(0);
      }
      await commitReservation(blobId);
      return blobId;
    }
    const pending = await storage.findPendingArtifactBlob(actor(), c.lease, blobId);
    if (pending) {
      if (pending.preparedFencing === c.lease.fencing) {
        const b = pending.blob;
        if (
          b.keyVersion !== "artifact_v1" ||
          b.contentHash !== (await digest(bytes)) ||
          b.logicalBytes !== bytes.byteLength
        )
          throw new ProcessingError("FILE_REJECTED");
        const permit = await options.costs.before(
          {
            service: "requests",
            action: "r2_get",
            identity: `recover:${blobId}:${b.cipherHash}`,
            byteLength: b.cipherBytes,
            durationSeconds: null,
          },
          access(signal),
        );
        if (!permit) throw new ProcessingError("BUDGET_UNAVAILABLE");
        let object: Awaited<ReturnType<PrivateBucket["get"]>>;
        if (!(await authorize(access(signal)))) {
          await options.costs.after(permit, { transport: "not_sent" });
          throw new ProcessingError("STALE_REVISION");
        }
        try {
          object = await options.bucket.get(`private/${blobId}`);
          await options.costs.after(permit, { transport: "response" });
        } catch {
          await options.costs.after(permit, { transport: "unknown" });
          throw new ProcessingError("STORAGE_UNAVAILABLE");
        }
        if (object) {
          const saved = await readBounded(object.body, b.cipherBytes);
          if (object.size !== b.cipherBytes || (await digest(saved)) !== b.cipherHash)
            throw new ProcessingError("FILE_REJECTED");
          const plain = await decryptArtifact(core.cipher, identity(blobId), saved);
          try {
            if ((await digest(plain)) !== b.contentHash) throw new ProcessingError("FILE_REJECTED");
          } finally {
            plain.fill(0);
            saved.fill(0);
          }
          await guard();
          if (!(await storage.commitArtifactBlob(actor(), (await guard()).lease, b)))
            throw new ProcessingError("STALE_REVISION");
          await commitReservation(blobId);
          return blobId;
        }
      }
      if (!(await storage.abandonArtifactBlob(actor(), blobId)))
        throw new ProcessingError("STALE_REVISION");
      blobId = crypto.randomUUID();
    } else {
      const occupied = await core
        .statement(
          "SELECT b.id FROM v2_blobs b JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=?",
          [blobId, params.ownerId],
        )
        .first();
      if (occupied) blobId = crypto.randomUUID();
    }
    const permit = await options.costs.before(
      {
        service: "storage",
        action: "r2_put",
        identity: await digest(bytes),
        byteLength: bytes.byteLength,
        durationSeconds: null,
      },
      access(signal),
    );
    if (!permit) throw new ProcessingError("BUDGET_UNAVAILABLE");
    const encrypted = await encryptArtifact(core.cipher, identity(blobId), bytes);
    const operation = await core
      .statement("SELECT operation_id FROM v2_jobs WHERE id=?", [params.jobId])
      .first<string>("operation_id");
    if (!operation) throw new ProcessingError("STALE_REVISION");
    const reservationId = await idFor(`reservation:${blobId}`);
    const reserved = await core
      .statement("SELECT id FROM v2_storage_reservations WHERE id=? AND state='reserved'", [
        reservationId,
      ])
      .first();
    if (
      !reserved &&
      !(await storage.reserveArtifact((await guard()).guard, {
        id: reservationId,
        artifactId: blobId,
        target: { kind: "file", id: params.fileId, revision: params.fileRevision },
        operationId: operation,
        byteLength: bytes.byteLength,
      }))
    )
      throw new ProcessingError("STORAGE_UNAVAILABLE");
    const blob: BlobRegistration = {
      id: blobId,
      reservationId,
      kind: "derivative",
      visibility: "private",
      logicalBytes: bytes.byteLength,
      cipherBytes: encrypted.byteLength,
      cipherHash: await digest(encrypted),
      contentHash: await digest(bytes),
      keyVersion: "artifact_v1",
    };
    if (!(await storage.prepareArtifactBlob(actor(), c.lease, blob)))
      throw new ProcessingError("STALE_REVISION");
    let sent = false;
    try {
      if (!(await authorize(access(signal)))) {
        await options.costs.after(permit, { transport: "not_sent" });
        throw new ProcessingError("STALE_REVISION");
      }
      sent = true;
      const actual = await options.bucket.put(`private/${blobId}`, encrypted, {
        httpMetadata: {
          contentType: "application/octet-stream",
          cacheControl: "private, no-store",
        },
      });
      await options.costs.after(permit, { transport: "response" });
      if (!actual || actual.key !== `private/${blobId}` || actual.size !== encrypted.byteLength)
        throw new ProcessingError("STORAGE_UNAVAILABLE");
      await guard();
      if (!(await storage.commitArtifactBlob(actor(), c.lease, blob)))
        throw new ProcessingError("STALE_REVISION");
      await commitReservation(blobId);
      return blobId;
    } catch (error) {
      if (!(error instanceof ProcessingError))
        await options.costs.after(permit, { transport: sent ? "unknown" : "not_sent" });
      await storage.abandonArtifactBlob(actor(), blobId);
      if (error instanceof ProcessingError) throw error;
      throw new ProcessingError("STORAGE_UNAVAILABLE");
    } finally {
      encrypted.fill(0);
    }
  };
  const json = async <T>(blobId: string, codec: z.ZodType<T>) => {
    const bytes = await read(blobId);
    try {
      return codec.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    } finally {
      bytes.fill(0);
    }
  };
  const saveJson = (blobId: string, value: unknown, signal: AbortSignal) =>
    write(blobId, new TextEncoder().encode(JSON.stringify(value)), signal);
  const texts = (
    text: string,
    position: V2FileObservation["position"],
    scope: string,
    observed = false,
  ) => {
    const values: V2FileObservation[] = [];
    // Do not split surrogate pairs or trim source content. One observation <=5000 UTF-16 characters.
    let offset = 0;
    while (offset < text.length) {
      let end = Math.min(text.length, offset + 5000);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end--;
      const part = text.slice(offset, end);
      if (part.trim())
        values.push({
          id: `${scope}-${values.length}`,
          text: part,
          position,
          certainty: observed ? "observed" : "uncertain",
          userEdited: false,
          included: true,
        });
      offset = end;
    }
    return values;
  };
  const alreadyPublished = async () => {
    const metadata = await files.metadata(actor(), params.fileId);
    if (
      !metadata ||
      !["ready", "partial"].includes(metadata.status) ||
      metadata.revision !== params.fileRevision + 1 ||
      !metadata.coverageSnapshotId
    )
      return false;
    return !!(await core
      .statement(
        `SELECT j.id FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id
      JOIN v2_private_snapshots s ON s.lease_job_id=j.id WHERE j.id=? AND j.runtime_instance_id=? AND o.owner_id=?
      AND j.status='completed' AND j.target_kind='file' AND j.target_id=? AND j.target_revision=?
      AND s.id=? AND s.owner_id=o.owner_id AND s.target_id=j.target_id AND s.state='published'`,
        [
          params.jobId,
          options.instanceId,
          params.ownerId,
          params.fileId,
          params.fileRevision,
          metadata.coverageSnapshotId,
        ],
      )
      .first());
  };
  return {
    currentLease: async () => (await guard()).lease,
    async initialize() {
      if (await alreadyPublished()) return { totalUnits: 0, status: "ready" as const };
      if (!(await consent())) throw new ProcessingError("STALE_REVISION");
      const existing = await current();
      if (!existing) {
        const admitted = await core
          .statement(
            `SELECT j.id FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.id=? AND o.owner_id=? AND j.runtime_instance_id=? AND j.target_id=? AND j.target_revision=? AND ${jobAlive}`,
            [params.jobId, params.ownerId, options.instanceId, params.fileId, params.fileRevision],
          )
          .first();
        if (!admitted) throw new ProcessingError("STALE_REVISION");
        const acquisitionActor = actor();
        const granted = await jobs.acquire(
          acquisitionActor,
          params.jobId,
          crypto.randomUUID(),
          new Date(Date.parse(acquisitionActor.now) + 300000).toISOString(),
          options.initialAttemptId ?? null,
        );
        if (!granted) throw new ProcessingError("BUDGET_UNAVAILABLE");
      }
      const metadata = await files.metadata(actor(), params.fileId);
      if (!metadata?.probe || metadata.revision !== params.fileRevision)
        throw new ProcessingError("STALE_REVISION");
      return {
        status: "running" as const,
        totalUnits:
          metadata.probe.category === "document"
            ? metadata.probe.pageCount
            : metadata.probe.category === "image"
              ? 1
              : Math.ceil(metadata.probe.durationSeconds / 30),
      };
    },
    async extractUnit(unit: number, signal: AbortSignal) {
      await renew();
      const old = await receipt(`unit:${unit}`);
      if (old?.[0]) {
        const saved = await json(old[0], processorManifestSchema);
        return { artifactCount: saved.artifacts.length };
      }
      const source = await options.files.content(params.ownerId, params.workspaceId, params.fileId);
      const metadata = await files.metadata(actor(), params.fileId);
      if (
        !metadata?.probe ||
        !metadata.manifestSnapshotId ||
        metadata.revision !== params.fileRevision
      )
        throw new ProcessingError("STALE_REVISION");
      const manifestHeader = await core
        .statement("SELECT revision FROM v2_private_snapshots WHERE id=?", [
          metadata.manifestSnapshotId,
        ])
        .first<number>("revision");
      if (!manifestHeader) throw new ProcessingError("FILE_REJECTED");
      // The files service revalidates original manifest/digest on each authorized stream.
      const manifest = await files.read(actor(), params.fileId);
      if (!manifest?.manifest) throw new ProcessingError("FILE_REJECTED");
      let frameOffset = 0;
      if (metadata.probe.category === "video" && unit > 0) {
        const previous = await receipt(`unit:${unit - 1}`);
        if (!previous?.[0]) throw new ProcessingError("FILE_PROCESSING_FAILED");
        const before = await json(previous[0], processorManifestSchema);
        if (before.unit !== unit - 1) throw new ProcessingError("FILE_REJECTED");
        frameOffset = before.frameOffset + before.decodedFrameCount;
      }
      let pending: ProcessorManifest | null = null;
      const native = await options.processor.processUnit(
        {
          byteLength: source.byteLength,
          contentHash: manifest.manifest.contentHash,
          unit,
          frameOffset,
          open: () => source.body,
        },
        access(signal),
        {
          manifest: async (value) => {
            if (
              value.unit !== unit ||
              value.frameOffset !== frameOffset ||
              JSON.stringify(value.probe) !== JSON.stringify(metadata.probe)
            )
              throw new ProcessingError("FILE_REJECTED");
            pending = value;
          },
          artifact: async (artifact, bytes) => {
            const id = await write(await idFor(`raw:${unit}:${artifact.index}`), bytes, signal);
            await checkpoint(`raw:${unit}:${artifact.index}`, artifact.index + 1, "extracting", [
              id,
            ]);
          },
        },
      );
      if (!pending) throw new ProcessingError("FILE_REJECTED");
      const manifestId = await idFor(`manifest:${unit}`);
      const storedManifestId = await saveJson(manifestId, native, signal);
      await checkpoint(`unit:${unit}`, unit + 1, "extracting", [storedManifestId]);
      return { artifactCount: native.artifacts.length };
    },
    async interpretArtifact(unit: number, index: number, signal: AbortSignal) {
      await renew();
      if (await receipt(`result:${unit}:${index}`)) return { status: "saved" as const };
      const saved = await receipt(`unit:${unit}`);
      if (!saved?.[0]) throw new ProcessingError("FILE_PROCESSING_FAILED");
      const manifest = await json(saved[0], processorManifestSchema);
      const artifact = manifest.artifacts[index];
      if (!artifact) throw new ProcessingError("FILE_REJECTED");
      const rawIds = await receipt(`raw:${unit}:${index}`);
      if (!rawIds?.[0]) throw new ProcessingError("FILE_PROCESSING_FAILED");
      const blobId = rawIds[0],
        bytes = await read(blobId);
      const scope = await idFor(`observation:${unit}:${index}`);
      const result: Result = { observations: [], derivatives: [], status: "processed" };
      try {
        if (artifact.kind === "extracted_text") {
          result.observations = texts(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            artifact.position,
            scope,
            manifest.coverage.category === "document" &&
              manifest.coverage.pages[0]?.status === "processed",
          );
          result.derivatives = [
            {
              blobId,
              value: {
                id: blobId,
                kind: "extracted_text",
                byteLength: bytes.byteLength,
                contentHash: artifact.contentHash,
                sourcePosition: artifact.position,
              },
            },
          ];
          result.status =
            manifest.coverage.category === "document" &&
            manifest.coverage.pages[0]?.status === "processed"
              ? "processed"
              : "low_quality";
        } else if (artifact.kind === "audio" && artifact.position.kind === "audio") {
          const output = await options.media.transcribe(
            bytes,
            artifact.position.startSeconds,
            artifact.position.endSeconds,
            access(signal),
          );
          result.status = output.status;
          result.observations = output.segments.length
            ? output.segments.flatMap((segment, n) =>
                texts(
                  segment.text,
                  {
                    kind: "audio",
                    startSeconds: segment.startSeconds,
                    endSeconds: segment.endSeconds,
                  },
                  `${scope}-${n}`,
                ),
              )
            : texts(output.text, artifact.position, scope);
          if (output.text) {
            const text = new TextEncoder().encode(output.text);
            const transcriptId = await write(
              await idFor(`transcript:${unit}:${index}`),
              text,
              signal,
            );
            result.derivatives.push({
              blobId: transcriptId,
              value: {
                id: transcriptId,
                kind: "transcript",
                byteLength: text.byteLength,
                contentHash: await digest(text),
                sourcePosition: artifact.position,
              },
            });
          }
        } else {
          try {
            const output = await options.media.observe(bytes, access(signal));
            result.status = artifact.multiFrame ? "low_quality" : output.quality;
            result.observations = output.texts.flatMap((text, n) =>
              texts(text, artifact.position, `${scope}-${n}`),
            );
          } catch (error) {
            if (error instanceof ProcessingError && error.code === "MODEL_UNAVAILABLE")
              result.status = "missing";
            else throw error;
          }
          if (artifact.kind === "frame")
            result.derivatives = [
              {
                blobId,
                value: {
                  id: blobId,
                  kind: "sampled_frame",
                  byteLength: bytes.byteLength,
                  contentHash: artifact.contentHash,
                  sourcePosition: artifact.position,
                },
              },
            ];
        }
        const resultId = await idFor(`result-data:${unit}:${index}`);
        const storedResultId = await saveJson(resultId, result, signal);
        await checkpoint(
          `result:${unit}:${index}`,
          unit * 20000 + index + 1,
          artifact.kind === "audio" ? "transcribing" : "observing",
          [storedResultId],
        );
        return { status: "saved" as const };
      } finally {
        bytes.fill(0);
      }
    },
    async prepareUnit(unit: number, signal: AbortSignal) {
      await renew();
      const old = await receipt(`plan:${unit}`);
      if (old?.[0]) return { artifactCount: (await json(old[0], unitPlanSchema)).results.length };
      const saved = await receipt(`unit:${unit}`);
      if (!saved?.[0]) throw new ProcessingError("FILE_PROCESSING_FAILED");
      const manifest = await json(saved[0], processorManifestSchema);
      let observationOrdinal = 0,
        derivativeOrdinal = 0;
      if (unit > 0) {
        const previous = await receipt(`plan:${unit - 1}`);
        if (!previous?.[0]) throw new ProcessingError("FILE_PROCESSING_FAILED");
        const plan = await json(previous[0], unitPlanSchema);
        if (plan.unit !== unit - 1 || plan.totalUnits !== manifest.totalUnits)
          throw new ProcessingError("FILE_REJECTED");
        observationOrdinal = plan.observationOrdinal + plan.observationCount;
        derivativeOrdinal = plan.derivativeOrdinal + plan.derivativeCount;
      }
      const results: z.infer<typeof unitPlanSchema>["results"] = [];
      let observationCount = 0,
        derivativeCount = 0;
      for (const artifact of manifest.artifacts) {
        const saved = await receipt(`result:${unit}:${artifact.index}`);
        if (!saved?.[0]) throw new ProcessingError("FILE_PROCESSING_FAILED");
        const result = await json(saved[0], resultSchema);
        observationCount += result.observations.length;
        derivativeCount += result.derivatives.length;
        if (
          observationOrdinal + observationCount > 10000 ||
          derivativeOrdinal + derivativeCount > 20000
        )
          throw new ProcessingError("FILE_REJECTED");
        results.push({
          id: saved[0],
          observations: result.observations.length,
          derivatives: result.derivatives.length,
          status: result.status,
        });
      }
      const plan = unitPlanSchema.parse({
        unit,
        totalUnits: manifest.totalUnits,
        manifestId: saved[0],
        observationOrdinal,
        derivativeOrdinal,
        observationCount,
        derivativeCount,
        results,
      });
      const id = await saveJson(await idFor(`unit-plan:${unit}`), plan, signal);
      await checkpoint(`plan:${unit}`, unit + 1, "assembling", [id]);
      return { artifactCount: results.length };
    },
    async preparePublication(totalUnits: number, signal: AbortSignal) {
      await renew();
      let coverage: V2Coverage | null = null;
      let observations = 0,
        derivatives = 0;
      for (let unit = 0; unit < totalUnits; unit++) {
        const receiptIds = await receipt(`unit:${unit}`);
        if (!receiptIds?.[0]) throw new ProcessingError("FILE_PROCESSING_FAILED");
        const manifest = await json(receiptIds[0], processorManifestSchema);
        if (manifest.unit !== unit || manifest.totalUnits !== totalUnits)
          throw new ProcessingError("FILE_REJECTED");
        if (!coverage) coverage = initialCoverage(manifest.probe);
        const planReceipt = await receipt(`plan:${unit}`);
        if (!planReceipt?.[0]) throw new ProcessingError("FILE_PROCESSING_FAILED");
        const plan = await json(planReceipt[0], unitPlanSchema);
        if (
          plan.unit !== unit ||
          plan.totalUnits !== totalUnits ||
          plan.results.length !== manifest.artifacts.length ||
          plan.observationOrdinal !== observations ||
          plan.derivativeOrdinal !== derivatives
        )
          throw new ProcessingError("FILE_REJECTED");
        for (const artifact of manifest.artifacts) {
          const result = plan.results[artifact.index];
          if (!result) throw new ProcessingError("FILE_REJECTED");
          observations += result.observations;
          derivatives += result.derivatives;
          if (observations > 10000 || derivatives > 20000)
            throw new ProcessingError("FILE_REJECTED");
          if (coverage.category === "document" && artifact.position.kind === "document") {
            const page = coverage.pages[artifact.position.page - 1];
            if (!page) throw new ProcessingError("FILE_REJECTED");
            page.status = result.status;
          }
          if (coverage.category === "image") coverage.observation = result.status;
          if (
            (coverage.category === "audio" || coverage.category === "video") &&
            artifact.position.kind === "audio"
          ) {
            const audio = coverage.audio;
            if (audio) {
              if (unit === 0) audio.intervals = [];
              audio.intervals.push({
                startSeconds: artifact.position.startSeconds,
                endSeconds: artifact.position.endSeconds,
                status: result.status === "processed" ? "processed" : "low_quality",
              });
            }
          }
          if (coverage.category === "video" && artifact.position.kind === "video") {
            const position = artifact.position;
            const actual = {
              id: await idFor(`frame:${unit}:${artifact.index}`),
              timestampSeconds: position.timestampSeconds,
              frameIndex: position.frameIndex,
              sampling: position.sampling,
              status: result.status,
            };
            if (position.sampling === "one_second")
              coverage.frames[position.timestampSeconds] = actual;
            else coverage.frames.push(actual);
          }
        }
        // Empty document pages were actually decoded; preserve their explicit status.
        if (coverage.category === "document" && manifest.coverage.category === "document") {
          const page = manifest.coverage.pages[0];
          if (!page) throw new ProcessingError("FILE_REJECTED");
          coverage.pages[unit] = page;
        }
      }
      if (!coverage) throw new ProcessingError("FILE_REJECTED");
      if (coverage.category === "document")
        coverage.status = coverage.pages.every((p) => p.status === "processed")
          ? "complete"
          : "partial";
      if (coverage.category === "image")
        coverage.status = coverage.observation === "processed" ? "complete" : "partial";
      if (coverage.category === "audio" || coverage.category === "video") {
        const audio = coverage.audio;
        if (audio)
          audio.status = audio.intervals.every(
            (i) => i.status === "processed" || i.status === "silent",
          )
            ? "complete"
            : "partial";
      }
      if (coverage.category === "video") {
        coverage.sceneDetection = "complete";
        coverage.sceneFrameCount = coverage.frames.filter(
          (f) => f.sampling === "scene_change",
        ).length;
        coverage.status =
          coverage.frames.every((f) => f.status === "processed") &&
          (!coverage.audio || coverage.audio.status === "complete")
            ? "complete"
            : "partial";
      }
      coverage = v2CoverageSchema.parse(coverage);
      const coverageId = await idFor("final-coverage");
      const text = JSON.stringify(coverage),
        parts = fragmentText(text),
        partIds: string[] = [];
      // All storage writes precede the fixed workspace revision used by staging.
      for (const [index, part] of parts.entries())
        partIds.push(
          await write(
            await idFor(`coverage-part:${index}`),
            new TextEncoder().encode(part),
            signal,
          ),
        );
      const publication = publicationSchema.parse({
        coverageId,
        parts: partIds,
        observationCount: observations,
        derivativeCount: derivatives,
      });
      const publicationId = await saveJson(await idFor("publication-plan"), publication, signal);
      await checkpoint("publication", 1, "assembling", [publicationId]);
      const c = await guard();
      const existing = await core
        .statement(
          "SELECT state,workspace_revision FROM v2_private_snapshots WHERE id=? AND owner_id=?",
          [coverageId, params.ownerId],
        )
        .first<{ state: string; workspace_revision: number }>();
      if (
        !existing &&
        !(await staging.begin(
          c.guard,
          {
            id: coverageId,
            purpose: "file_coverage",
            targetId: params.fileId,
            revision: params.fileRevision + 1,
            partCount: parts.length,
            byteLength: utf8Bytes(text),
          },
          c.lease,
        ))
      )
        throw new ProcessingError("STALE_REVISION");
      if (existing && existing.workspace_revision !== c.guard.expectedRevision)
        throw new ProcessingError("STALE_REVISION");
      return { partCount: parts.length };
    },
    async stageCoveragePart(index: number, signal: AbortSignal) {
      if (signal.aborted) throw new ProcessingError("JOB_TIMEOUT");
      const ids = await receipt("publication");
      if (!ids?.[0]) throw new ProcessingError("FILE_PROCESSING_FAILED");
      const publication = await json(ids[0], publicationSchema),
        id = publication.parts[index];
      if (!id) throw new ProcessingError("FILE_REJECTED");
      const bytes = await read(id);
      try {
        const part = new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          c = await renew();
        if (
          signal.aborted ||
          !(await staging.append(c.guard, publication.coverageId, index, part, c.lease))
        )
          throw new ProcessingError("STALE_REVISION");
      } finally {
        bytes.fill(0);
      }
      return { status: "saved" as const };
    },
    async resultPages(unit: number, index: number) {
      const ids = await receipt(`plan:${unit}`);
      if (!ids?.[0]) throw new ProcessingError("FILE_PROCESSING_FAILED");
      const plan = await json(ids[0], unitPlanSchema),
        result = plan.results[index];
      if (!result) throw new ProcessingError("FILE_REJECTED");
      return { pageCount: Math.ceil(Math.max(result.observations, result.derivatives) / 4) };
    },
    async stageResultPage(unit: number, index: number, page: number, signal: AbortSignal) {
      if (signal.aborted) throw new ProcessingError("JOB_TIMEOUT");
      const ids = await receipt(`plan:${unit}`),
        publicationIds = await receipt("publication");
      if (!ids?.[0] || !publicationIds?.[0]) throw new ProcessingError("FILE_PROCESSING_FAILED");
      const plan = await json(ids[0], unitPlanSchema),
        publication = await json(publicationIds[0], publicationSchema);
      const item = plan.results[index];
      if (
        !item ||
        page < 0 ||
        !Number.isInteger(page) ||
        page >= Math.ceil(Math.max(item.observations, item.derivatives) / 4)
      )
        throw new ProcessingError("FILE_REJECTED");
      const result = await json(item.id, resultSchema);
      if (
        result.observations.length !== item.observations ||
        result.derivatives.length !== item.derivatives
      )
        throw new ProcessingError("FILE_REJECTED");
      const start = page * 4,
        c = await renew();
      const observationOrdinal =
        plan.observationOrdinal +
        plan.results.slice(0, index).reduce((n, r) => n + r.observations, 0) +
        Math.min(start, result.observations.length);
      const derivativeOrdinal =
        plan.derivativeOrdinal +
        plan.results.slice(0, index).reduce((n, r) => n + r.derivatives, 0) +
        Math.min(start, result.derivatives.length);
      if (
        !(await fileStaging.stagePage(
          c.guard,
          {
            fileId: params.fileId,
            fileRevision: params.fileRevision,
            coverageSnapshotId: publication.coverageId,
            observationOrdinal,
            observations: result.observations.slice(start, start + 4),
            derivativeOrdinal,
            derivatives: result.derivatives.slice(start, start + 4),
          },
          c.lease,
        ))
      )
        throw new ProcessingError("STALE_REVISION");
      return { status: "saved" as const };
    },
    async publish(signal: AbortSignal) {
      if (await alreadyPublished())
        return {
          status: "ready" as const,
          fileId: params.fileId,
          revision: params.fileRevision + 1,
        };
      const ids = await receipt("publication");
      if (!ids?.[0]) throw new ProcessingError("FILE_PROCESSING_FAILED");
      const p = await json(ids[0], publicationSchema),
        c = await renew();
      if (
        signal.aborted ||
        !(await staging.seal(
          c.guard,
          p.coverageId,
          {
            schemaVersion: "2",
            purpose: "file_coverage",
            targetId: params.fileId,
            revision: params.fileRevision + 1,
          },
          c.lease,
        )) ||
        signal.aborted ||
        !(await fileStaging.publish(
          (
            await guard()
          ).guard,
          {
            fileId: params.fileId,
            fileRevision: params.fileRevision,
            coverageSnapshotId: p.coverageId,
            observationCount: p.observationCount,
            derivativeCount: p.derivativeCount,
          },
          c.lease,
        ))
      )
        throw new ProcessingError("STALE_REVISION");
      return { status: "ready" as const, fileId: params.fileId, revision: params.fileRevision + 1 };
    },
    async fail(error: unknown) {
      const c = await current();
      if (!c) return { status: "stopped" as const };
      const code = error instanceof ProcessingError ? error.code : "FILE_PROCESSING_FAILED";
      await jobs.fail(
        actor(),
        c.lease,
        code === "STALE_REVISION" ? "FILE_PROCESSING_FAILED" : code,
        !["FILE_REJECTED", "STALE_REVISION"].includes(code),
      );
      return { status: "failed" as const, code };
    },
  };
}
export type FileProcessingExecution = ReturnType<typeof createFileProcessingExecution>;

/** Reuses durable logical operation quotas; admission is separate from individual paid retries. */
export async function admitFileProcessing(
  core: V2Core,
  input: {
    ownerId: string;
    workspaceId: string;
    fileId: string;
    fileRevision: number;
    expectedRevision: number;
    key: string;
    paid: PreparedPaidHold;
    /** Exact server actor used to prepare the initial hold; never a browser value. */
    admissionActor: { ownerId: string; now: string };
  },
) {
  if (input.admissionActor.ownerId !== input.ownerId) throw new ProcessingError("STALE_REVISION");
  const g = {
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    expectedRevision: input.expectedRevision,
    now: new Date(timestampSchema.parse(input.admissionActor.now)).toISOString(),
  };
  const file = await createV2FilesRepository(core).metadata(g, input.fileId);
  if (
    !file?.probe ||
    file.revision !== input.fileRevision ||
    !(await hasCurrentConsent(drizzle(core.binding, { schema }), input.ownerId))
  )
    throw new ProcessingError("STALE_REVISION");
  const quotas = [
    {
      kind: "visible_ai_response" as const,
      units: 1 as const,
      responseKind: "file_interpretation" as const,
    },
    ...("durationSeconds" in file.probe
      ? [{ kind: "media_processing" as const, originalDurationSeconds: file.probe.durationSeconds }]
      : []),
  ];
  if (
    !(await createV2JobsRepository(core).admitFile(
      g,
      {
        fileId: input.fileId,
        fileRevision: input.fileRevision,
        jobId: input.paid.request.jobId,
        admission: {
          operationId: input.paid.request.plan.operationId,
          key: input.key,
          requestHash: input.paid.request.plan.requestHash,
        },
        quotas,
      },
      input.paid,
    ))
  )
    throw new ProcessingError("BUDGET_UNAVAILABLE");
  return {
    operationId: input.paid.request.plan.operationId,
    jobId: input.paid.request.jobId,
    status: "queued" as const,
    retryAfter: 3,
  };
}
