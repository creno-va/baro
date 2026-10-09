import { z } from "zod";
import { maskReportText } from "../../../components/reports/download";
import type { V2ReportBody } from "../../../contracts/v2";
import type { Actor, V2Core } from "../../db/v2-core";
import { jobAlive } from "../../db/v2-jobs";
import type { createV2ReportsRepository } from "../../db/v2-reports";
import { createV2StorageRepository } from "../../db/v2-storage";
import { createV2StorageCapacityRepository, type WritePermit } from "../../db/v2-storage-capacity";
import type { JobLease } from "../../db/v2-workspace";
import { createStorageMaintenance } from "../budget/storage-maintenance";
import type { ProcessingCosts } from "../file-processing/transport";
import type { FilesService, PrivateBucket } from "../files/service";
import { decryptExport, type ExportIdentity, planExport } from "./binary";
import { exportFence, requireReportConsent, storedPdfFence } from "./fence";
import {
  allowReportCleanup,
  applyReportWorkPlan,
  type ReportWorkPlan,
  reportWorkPlan,
} from "./limits";
import { renderReportPdf } from "./pdf";
import {
  ownedWorkspace,
  ReportError,
  type ReportReviewData,
  sourceDigest,
  validateOriginalSelection,
} from "./source";
import { streamChunks, type ZipSource, zipByteLength, zipChunks } from "./zip";

export type ReportDependencies = {
  environment: "preview" | "production";
  bucket?: PrivateBucket;
  files: FilesService;
  font: () => Promise<Uint8Array>;
  clock?: () => string;
  guideHosts?: readonly string[];
  costs?: (input: {
    ownerId: string;
    reportId: string;
    blobId: string;
    operationId: string;
    sourceRevision: number;
    lease: JobLease;
    workPlan: ReportWorkPlan;
  }) => Promise<ProcessingCosts>;
  /** Preview-only explicit test composition. Never selected from a request. */
  testOnlyUnmeteredStorage?: true;
  /** FixedLengthStream in Workers; the test adapter consumes a regular stream. */
  fixedLength?: (
    body: ReadableStream<Uint8Array>,
    size: number,
  ) => { body: ReadableStream<Uint8Array>; done: Promise<void>; abort?: () => Promise<void> };
};
type ExportRow = {
  id: string;
  revision: number;
  workspace_id: string;
  workspace_revision: number;
  operation_id: string;
  current_job_id: string | null;
  state: string;
  pdf_blob_id: string | null;
  zip_blob_id: string | null;
  snapshot_id: string;
  encrypted_payload: string;
};
type Ports = {
  row: (actor: Actor, id: string) => Promise<ExportRow>;
  read: (
    actor: Actor,
    id: string,
  ) => Promise<{ row: ExportRow; body: V2ReportBody; review: ReportReviewData }>;
  canonical: ReturnType<typeof createV2ReportsRepository>;
  actor: (ownerId: string) => Actor;
};
const MAX_SELECTED_ZIP_BYTES = 900_000_000;
export function createReportExports(core: V2Core, deps: ReportDependencies, ports: Ports) {
  const storage = createV2StorageRepository(core),
    capacity = createV2StorageCapacityRepository(core, deps.environment);
  const now = deps.clock ?? (() => new Date().toISOString());
  const maintenance = createStorageMaintenance(core, deps.environment, now);
  const test = deps.environment === "preview" && deps.testOnlyUnmeteredStorage === true;
  if (deps.testOnlyUnmeteredStorage && !test) throw new ReportError("BUDGET_UNAVAILABLE");
  const bucket = () => {
    if (!deps.bucket) throw new ReportError("STORAGE_UNAVAILABLE");
    return deps.bucket;
  };
  const a = (ownerId: string) => ports.actor(ownerId);
  const identity = (
    r: ExportRow,
    ownerId: string,
    blobId: string,
    kind: ExportIdentity["kind"],
  ): ExportIdentity => ({
    environment: deps.environment,
    ownerId,
    reportId: r.id,
    blobId,
    revision: r.revision,
    kind,
  });
  const valid = async (actor: Actor, id: string) => {
    const data = await ports.read(actor, id);
    if (data.review.sourceDigest !== (await sourceDigest(core, actor, data.row.workspace_id)))
      throw new ReportError("STALE_REVISION");
    return data;
  };
  async function abandon(blobId: string) {
    const journalId = crypto.randomUUID(),
      at = now();
    await core.binding.batch([
      core.statement(
        "INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at) SELECT ?,'blob',?,?,? FROM v2_blobs WHERE id=? AND state!='deleted'",
        [journalId, blobId, at, at, blobId],
      ),
      core.statement(
        "INSERT INTO v2_deletion_targets(journal_id,kind,target_id,ordinal) SELECT ?,'blob',?,0 WHERE EXISTS(SELECT 1 FROM v2_deletion_journals WHERE id=?)",
        [journalId, blobId, journalId],
      ),
      core.statement("UPDATE v2_blobs SET state='deleting' WHERE id=? AND state!='deleted'", [
        blobId,
      ]),
    ]);
  }
  async function abandonReservation(reservationId: string) {
    const id = crypto.randomUUID(),
      at = now();
    await core.binding.batch([
      core.statement(
        "INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at) SELECT ?,'blob',?,?,? FROM v2_storage_reservations WHERE id=? AND state='reserved'",
        [id, reservationId, at, at, reservationId],
      ),
      core.statement(
        "INSERT INTO v2_deletion_targets(journal_id,kind,target_id,ordinal) SELECT ?,'reservation',?,0 WHERE EXISTS(SELECT 1 FROM v2_deletion_journals WHERE id=?)",
        [id, reservationId, id],
      ),
    ]);
  }
  async function lease(ownerId: string, r: ExportRow): Promise<JobLease> {
    if (!r.current_job_id) throw new ReportError("STORAGE_UNAVAILABLE");
    const token = crypto.randomUUID(),
      time = now();
    // This lease covers local PDF/ZIP construction only. Every external write
    // still requires the existing authenticated paid admission and physical
    // capacity dispatch permit immediately before R2.
    const acquired = await core
      .statement(
        `UPDATE v2_jobs SET status='running',phase='assembling',failure_code=NULL,retryable=0,lease_token=?,lease_until=?,fencing=fencing+1,attempts=attempts+1,updated_at=? WHERE id=? AND attempts<3 AND (status IN ('queued','failed') OR (status IN ('running','validating') AND lease_until<=?)) AND EXISTS(SELECT 1 FROM v2_operations o WHERE o.id=v2_jobs.operation_id AND o.owner_id=? AND o.state='admitted') AND EXISTS(SELECT 1 FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.id=v2_jobs.id AND ${jobAlive}) RETURNING fencing`,
        [
          token,
          new Date(Date.parse(time) + 300000).toISOString(),
          time,
          r.current_job_id,
          time,
          ownerId,
        ],
      )
      .first<number>("fencing");
    if (!acquired) throw new ReportError("STORAGE_UNAVAILABLE");
    await core
      .statement("UPDATE v2_reports SET state='building' WHERE id=? AND current_job_id=?", [
        r.id,
        r.current_job_id,
      ])
      .run();
    return { jobId: r.current_job_id, token, fencing: acquired };
  }
  async function persist(
    ownerId: string,
    r: ExportRow,
    l: JobLease,
    kind: ExportIdentity["kind"],
    size: number,
    open: () => AsyncGenerator<Uint8Array>,
    authorize: () => Promise<void>,
    workPlan: ReportWorkPlan,
  ) {
    bucket();
    const blobId = crypto.randomUUID(),
      reservationId = crypto.randomUUID();
    const plan = await planExport(
      core.cipher,
      identity(r, ownerId, blobId, kind),
      size,
      open,
      authorize,
    );
    const current = await ownedWorkspace(core, a(ownerId), r.workspace_id);
    if (
      !(await storage.reserveArtifact(
        { ...a(ownerId), workspaceId: r.workspace_id, expectedRevision: current.revision },
        {
          id: reservationId,
          artifactId: blobId,
          target: { kind: "report", id: r.id, revision: r.workspace_revision },
          operationId: r.operation_id,
          byteLength: size,
        },
      ))
    )
      throw new ReportError("USER_QUOTA_EXCEEDED");
    const actor = a(ownerId),
      claim = crypto.randomUUID(),
      key = `private/${blobId}`;
    const physical = test
      ? null
      : capacity.prepareCapacity(actor, {
          blobId,
          ownerId,
          objectKey: key,
          maximumCipherBytes: plan.cipherBytes,
        });
    const metadata = await core.encrypt("v2_blobs", blobId, ownerId, 1, {
      contentHash: plan.contentHash,
    });
    const pending = [
      core.statement(
        `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,o.owner_id,j.target_id,j.target_revision FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.id=? AND o.owner_id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND ${jobAlive} AND (${physical?.predicate.sql ?? "1"})`,
        [
          claim,
          l.jobId,
          ownerId,
          l.token,
          l.fencing,
          actor.now,
          ...(physical?.predicate.values ?? []),
        ],
      ),
      core.statement(
        `INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) SELECT ?,r.principal_id,r.id,?,'private','pending',?,?,?,?,'report_stream_v1',?,? FROM v2_storage_reservations r WHERE r.id=? AND r.state='reserved' AND ${"EXISTS(SELECT 1 FROM v2_mutation_claims WHERE id=?)"}`,
        [
          blobId,
          kind,
          key,
          size,
          plan.cipherBytes,
          plan.cipherHash,
          metadata,
          actor.now,
          reservationId,
          claim,
        ],
      ),
      ...(physical ? physical.statements(core, actor, claim) : []),
      core.finish(claim),
    ];
    try {
      if (!(await core.changed(pending))) throw new ReportError("BUDGET_UNAVAILABLE");
    } catch (error) {
      allowReportCleanup(core);
      await abandonReservation(reservationId);
      throw error;
    }
    let writer: WritePermit | null = null,
      sent = false;
    let abortProducer: (() => Promise<void>) | undefined;
    let costs: ProcessingCosts | undefined,
      permit: Awaited<ReturnType<ProcessingCosts["before"]>> = null;
    try {
      await authorize();
      if (!test) {
        writer = await capacity.beginWrite(blobId, plan.cipherBytes, now());
        if (!writer) throw new ReportError("BUDGET_UNAVAILABLE");
        costs = await deps.costs?.({
          ownerId,
          reportId: r.id,
          blobId,
          operationId: r.operation_id,
          sourceRevision: r.workspace_revision,
          lease: l,
          workPlan,
        });
        permit =
          (await costs?.before(
            {
              service: "requests",
              action: "r2_put",
              identity: plan.cipherHash,
              byteLength: plan.cipherBytes,
              durationSeconds: null,
            },
            {
              authorize: async () => {
                try {
                  await authorize();
                  return true;
                } catch {
                  return false;
                }
              },
              signal: AbortSignal.timeout(265000),
            },
          )) ?? null;
        if (!permit) throw new ReportError("BUDGET_UNAVAILABLE");
      }
      await authorize();
      const source = streamChunks(plan.open());
      const fixed =
        deps.fixedLength?.(source, plan.cipherBytes) ??
        (() => {
          const stream = new FixedLengthStream(plan.cipherBytes);
          const cancellation = new AbortController();
          const done = source.pipeTo(stream.writable, { signal: cancellation.signal });
          return {
            body: stream.readable,
            done,
            abort: async () => {
              cancellation.abort();
              await done.catch(() => {});
            },
          };
        })();
      // Observe the producer immediately even if the transport rejects early.
      void fixed.done.catch(() => {});
      abortProducer = fixed.abort ?? (() => fixed.body.cancel().catch(() => {}));
      sent = true;
      const result = await bucket().put(key, fixed.body, {
        httpMetadata: {
          contentType: "application/octet-stream",
          cacheControl: "private, no-store",
        },
      });
      await fixed.done;
      if (!result || result.key !== key || result.size !== plan.cipherBytes)
        throw new ReportError("STORAGE_UNAVAILABLE");
      if (
        writer &&
        !(await capacity.confirmWriterStopped(
          writer,
          { transport: "response", objectKey: key, byteLength: plan.cipherBytes },
          now(),
        ))
      )
        throw new ReportError("STORAGE_UNAVAILABLE");
      if (costs && permit) await costs.after(permit, { transport: "response" });
      await authorize();
      const committed = await core
        .statement(
          `UPDATE v2_blobs SET state='stored' WHERE id=? AND state='pending' AND cipher_hash=? AND EXISTS(SELECT 1 FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.id=? AND o.owner_id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND ${jobAlive})`,
          [blobId, plan.cipherHash, l.jobId, ownerId, l.token, l.fencing, now()],
        )
        .run();
      if (
        committed.meta.changes !== 1 ||
        !(await storage.commitReservation(a(ownerId), reservationId))
      )
        throw new ReportError("NOT_FOUND");
      return {
        id: blobId,
        encryption: "chunk_aead_v1" as const,
        byteLength: size,
        contentHash: plan.contentHash,
      };
    } catch (error) {
      allowReportCleanup(core);
      await abortProducer?.();
      if (writer && !sent)
        await capacity.confirmWriterStopped(writer, { transport: "not_sent" }, now());
      if (costs && permit) await costs.after(permit, { transport: sent ? "unknown" : "not_sent" });
      await abandon(blobId);
      if (error instanceof ReportError) throw error;
      throw new ReportError("STORAGE_UNAVAILABLE");
    }
  }
  async function download(
    ownerId: string,
    r: ExportRow,
    blobId: string,
    kind: ExportIdentity["kind"],
  ) {
    const data =
      kind === "report_pdf" ? await ports.read(a(ownerId), r.id) : await valid(a(ownerId), r.id);
    const fence =
      kind === "report_pdf"
        ? null
        : await exportFence(core, a(ownerId), r, data.review.sourceDigest, now);
    const authorize = fence
      ? () => fence.check(undefined, blobId)
      : storedPdfFence(core, a(ownerId), r, blobId);
    await authorize();
    const blob = await storage.findBlob(a(ownerId), blobId);
    if (!blob || blob.kind !== kind || blob.key_version !== "report_stream_v1")
      throw new ReportError("NOT_FOUND");
    applyReportWorkPlan(
      core,
      reportWorkPlan({
        pdfBytes: kind === "report_pdf" ? blob.logical_bytes : 0,
        zipBytes: kind === "original_zip" ? blob.logical_bytes : 0,
        sourceRows: fence?.rows ?? 0,
        reportFiles: data.body.selectedFiles.length,
      }),
    );
    if (
      !test &&
      !(await maintenance.admit(blobId, blob.object_key, "get", async () => {
        try {
          await authorize();
          return true;
        } catch {
          return false;
        }
      }))
    )
      throw new ReportError("BUDGET_UNAVAILABLE");
    const object = await bucket().get(blob.object_key);
    if (!object || !("body" in object) || object.size !== blob.cipher_bytes)
      throw new ReportError("STORAGE_UNAVAILABLE");
    const metadata = await core
      .statement("SELECT encrypted_payload FROM v2_blobs WHERE id=? AND state='stored'", [blobId])
      .first<string>("encrypted_payload");
    if (!metadata) throw new ReportError("NOT_FOUND");
    const { contentHash } = await core.decrypt(
      "v2_blobs",
      blobId,
      ownerId,
      1,
      metadata,
      z.strictObject({ contentHash: z.string() }),
    );
    await authorize();
    return {
      body: streamChunks(
        decryptExport(
          core.cipher,
          identity(r, ownerId, blobId, kind),
          {
            byteLength: blob.logical_bytes,
            contentHash,
            cipherBytes: blob.cipher_bytes,
            cipherHash: blob.cipher_hash,
          },
          object.body,
          authorize,
        ),
      ),
      byteLength: blob.logical_bytes,
    };
  }
  async function build(actor: Actor, id: string, selected?: readonly string[]) {
    const existing = await ports.row(actor, id);
    if (!selected && existing.state === "ready" && existing.pdf_blob_id) return existing;
    await requireReportConsent(core, actor);
    const data = await valid(actor, id),
      r = data.row;
    if (r.state === "ready" && r.pdf_blob_id && (!selected || r.zip_blob_id)) return r;
    const fence = await exportFence(core, actor, r, data.review.sourceDigest, now);
    if (fence.rows > 250) throw new ReportError("EXPORT_LIMIT_EXCEEDED");
    const l = await lease(actor.ownerId, r);
    const written: string[] = [];
    try {
      const font = await deps.font();
      const authorize = () => fence.check(l);
      await authorize();
      const pdf = renderReportPdf(font, {
        title: data.review.title,
        content: data.review.maskIdentifiers
          ? maskReportText(data.review.content)
          : data.review.content,
        revision: r.revision,
        updatedAt: data.body.generatedAt,
      });
      const choices = selected
        ? validateOriginalSelection(data.body, data.review.excludedFileIds, selected)
        : [];
      const plannedSources: ZipSource[] = choices.map((file) => ({
        ...file,
        open: async () => {
          await authorize();
          const content = await deps.files.content(actor.ownerId, r.workspace_id, file.id);
          if (content.name !== file.name || content.byteLength !== file.byteLength)
            throw new ReportError("STALE_REVISION");
          return content.body;
        },
      }));
      const zipSize = selected ? zipByteLength(plannedSources) : undefined;
      if (zipSize && zipSize > MAX_SELECTED_ZIP_BYTES)
        throw new ReportError("EXPORT_LIMIT_EXCEEDED");
      const originalParts = choices.length
        ? await core
            .statement(
              "SELECT count(*) n FROM v2_upload_parts p JOIN v2_upload_sessions u ON u.id=p.upload_id WHERE u.file_id IN (SELECT value FROM json_each(?))",
              [JSON.stringify(choices.map((f) => f.id))],
            )
            .first<number>("n")
        : 0;
      if (choices.length && (originalParts ?? 0) < choices.length)
        throw new ReportError("STORAGE_UNAVAILABLE");
      const workPlan = reportWorkPlan({
        pdfBytes: pdf.byteLength,
        zipBytes: zipSize ?? 0,
        selectedFiles: choices.length,
        originalParts: originalParts ?? 0,
        sourceRows: fence.rows,
        reportFiles: data.body.selectedFiles.length,
      });
      applyReportWorkPlan(core, workPlan);
      const pdfArtifact = await persist(
        actor.ownerId,
        r,
        l,
        "report_pdf",
        pdf.byteLength,
        async function* () {
          yield pdf;
        },
        authorize,
        workPlan,
      );
      written.push(pdfArtifact.id);
      pdf.fill(0);
      let zipArtifact = null;
      if (selected) {
        zipArtifact = await persist(
          actor.ownerId,
          r,
          l,
          "original_zip",
          zipSize as number,
          () => zipChunks(plannedSources, authorize),
          authorize,
          workPlan,
        );
        written.push(zipArtifact.id);
      }
      const current = await ownedWorkspace(core, a(actor.ownerId), r.workspace_id);
      if (
        !(await ports.canonical.complete(
          { ...a(actor.ownerId), workspaceId: r.workspace_id, expectedRevision: current.revision },
          id,
          l,
          pdfArtifact,
          zipArtifact,
        ))
      )
        throw new ReportError("NOT_FOUND");
      return ports.row(a(actor.ownerId), id);
    } catch (error) {
      allowReportCleanup(core);
      for (const blobId of written) await abandon(blobId);
      // A retry reacquires the same local job with a new fencing token. Failed
      // output IDs remain in the durable deletion journal, never reused.
      await core
        .statement(
          `UPDATE v2_jobs SET status='failed',failure_code=?,retryable=1,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=? AND fencing=? AND EXISTS(SELECT 1 FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.id=v2_jobs.id AND o.owner_id=? AND ${jobAlive})`,
          [
            error instanceof ReportError && error.code === "BUDGET_UNAVAILABLE"
              ? "BUDGET_UNAVAILABLE"
              : "STORAGE_UNAVAILABLE",
            now(),
            l.jobId,
            l.token,
            l.fencing,
            actor.ownerId,
          ],
        )
        .run();
      throw error;
    }
  }
  return {
    async pdf(actor: Actor, id: string) {
      const r = await build(actor, id);
      if (!r.pdf_blob_id) throw new ReportError("STORAGE_UNAVAILABLE");
      return download(actor.ownerId, r, r.pdf_blob_id, "report_pdf");
    },
    async zip(actor: Actor, id: string, selected: readonly string[]) {
      const r = await build(actor, id, selected);
      if (!r.zip_blob_id) throw new ReportError("STORAGE_UNAVAILABLE");
      return download(actor.ownerId, r, r.zip_blob_id, "original_zip");
    },
  };
}
