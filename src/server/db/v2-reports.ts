import { z } from "zod";
import { opaqueIdSchema } from "../../contracts";
import {
  type V2PrivateArtifact,
  type V2Report,
  type V2ReportCreateRequest,
  type V2ReportFileSelection,
  v2FileProbeSchema,
  v2OriginalManifestSchema,
  v2PrivateArtifactSchema,
  v2ReportBodySchema,
  v2ReportCreateRequestSchema,
  v2ReportFileSelectionSchema,
  v2ReportSchema,
} from "../../contracts/v2";
import { operationStatements } from "./v2-accounting";
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
import { jobInsertStatements } from "./v2-jobs";
import { createV2StagingRepository } from "./v2-staging";
import {
  type Admission,
  admissionSchema,
  completeLeaseStatements,
  type JobLease,
  leasePredicate,
} from "./v2-workspace";

const metadataSchema = z.strictObject({ request: v2ReportCreateRequestSchema });
type ReportRow = {
  id: string;
  revision: number;
  workspace_id: string;
  workspace_revision: number;
  summary_revision: number;
  snapshot_id: string;
  operation_id: string;
  state: V2Report["status"];
  pdf_blob_id: string | null;
  zip_blob_id: string | null;
  current_job_id: string | null;
  failure_code: V2Report["failure"];
  encrypted_payload: string;
  created_at: string;
};
export function createV2ReportsRepository(core: V2Core, guideHosts: readonly string[] = []) {
  const rowForOwner = (actor: Actor, id: string) =>
    core
      .statement(
        `SELECT r.* FROM v2_reports r JOIN v2_workspaces w ON w.id=r.workspace_id WHERE r.id=? AND w.owner_id=? AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='report' AND target_id=r.id)`,
        [id, actor.ownerId],
      )
      .first<ReportRow>();
  const artifact = async (actor: Actor, id: string | null): Promise<V2PrivateArtifact | null> => {
    if (!id) return null;
    const row = await core
      .statement(
        "SELECT b.* FROM v2_blobs b JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=? AND b.visibility='private' AND b.state='stored'",
        [id, actor.ownerId],
      )
      .first<{ logical_bytes: number; encrypted_payload: string }>();
    if (!row) return null;
    const metadata = await core.decrypt(
      "v2_blobs",
      id,
      actor.ownerId,
      1,
      row.encrypted_payload,
      z.strictObject({ contentHash: hashSchema }),
    );
    if (
      !(await core
        .statement(
          "SELECT b.id FROM v2_blobs b JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=? AND b.visibility='private' AND b.state='stored' AND b.encrypted_payload=? AND b.logical_bytes=?",
          [id, actor.ownerId, row.encrypted_payload, row.logical_bytes],
        )
        .first())
    )
      return null;
    return parse(v2PrivateArtifactSchema, {
      id,
      encryption: "chunk_aead_v1",
      byteLength: row.logical_bytes,
      contentHash: metadata.contentHash,
    });
  };
  const create = async (
    g: WorkspaceGuard,
    input: {
      id: string;
      snapshotId: string;
      summaryRevision: number;
      request: V2ReportCreateRequest;
      selectedFiles: readonly V2ReportFileSelection[];
      jobId: string;
      admission: Admission;
    },
    body?: V2Report["body"],
  ) => {
    g = parse(guardSchema, g);
    const request = parse(v2ReportCreateRequestSchema, input.request);
    parse(admissionSchema, input.admission);
    parse(opaqueIdSchema, input.id);
    parse(opaqueIdSchema, input.jobId);
    if (
      request.expectedRevision !== g.expectedRevision ||
      input.selectedFiles.length !== request.selectedFileIds.length
    )
      return false;
    if (
      !(await core
        .statement(
          `SELECT w.id FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND w.revision=? AND ${aliveWorkspace}`,
          [g.workspaceId, g.ownerId, g.expectedRevision],
        )
        .first())
    )
      return false;
    const files = parse(z.array(v2ReportFileSelectionSchema).max(100), input.selectedFiles);
    if (
      new Set(files.map((f) => f.id)).size !== files.length ||
      files.some((f, i) => request.selectedFileIds[i] !== f.id)
    )
      return false;
    const claimId = crypto.randomUUID();
    const envelope = await core.encrypt("v2_reports", input.id, g.ownerId, 1, { request });
    const route = `/api/v2/cases/${g.workspaceId}/reports`;
    const stageCondition = body
      ? "1"
      : "EXISTS(SELECT 1 FROM v2_private_snapshots s WHERE s.id=? AND s.owner_id=w.owner_id AND s.workspace_id=w.id AND s.purpose='report' AND s.target_id=? AND s.revision=w.revision AND s.workspace_revision=w.revision AND s.state='sealed')";
    const statements = [
      core.claim(
        g,
        claimId,
        `w.status='active' AND w.confirmed_summary_revision=? AND ${stageCondition} AND NOT EXISTS(SELECT 1 FROM v2_idempotency WHERE owner_id=w.owner_id AND route=? AND key=? AND expires_at>?)`,
        [
          input.summaryRevision,
          ...(body ? [] : [input.snapshotId, input.id]),
          route,
          input.admission.key,
          g.now,
        ],
      ),
    ];
    if (body)
      statements.push(
        ...(await snapshotStatements(
          core,
          {
            id: input.snapshotId,
            ownerId: g.ownerId,
            workspaceId: g.workspaceId,
            targetId: input.id,
            revision: g.expectedRevision,
            purpose: "report",
            now: g.now,
          },
          parse(v2ReportBodySchema(guideHosts), body),
          claimId,
        )),
      );
    else
      statements.push(
        core.statement(
          `UPDATE v2_private_snapshots SET state='published' WHERE id=? AND ${sqlClaim}`,
          [input.snapshotId, claimId],
        ),
      );
    statements.push(
      ...operationStatements(
        core,
        g,
        {
          id: input.admission.operationId,
          workspaceId: g.workspaceId,
          kind: "report",
          revision: g.expectedRevision,
          route,
          key: input.admission.key,
          requestHash: input.admission.requestHash,
        },
        claimId,
      ),
      core.statement(
        `INSERT INTO v2_reports(id,workspace_id,workspace_revision,summary_revision,snapshot_id,operation_id,state,current_job_id,encrypted_payload,created_at) SELECT ?,?,?,?,?,?,'queued',?,?,? WHERE ${sqlClaim}`,
        [
          input.id,
          g.workspaceId,
          g.expectedRevision,
          input.summaryRevision,
          input.snapshotId,
          input.admission.operationId,
          input.jobId,
          envelope,
          g.now,
          claimId,
        ],
      ),
    );
    // File selection rows preserve the reviewed name/hash/revision even after future case edits.
    const selectionValues = [];
    if (body && files.length > 4) throw new V2RepositoryError("SNAPSHOT_STREAM_REQUIRED");
    const stages = body
      ? []
      : (
          await core
            .statement(
              "SELECT * FROM v2_report_selection_stages WHERE snapshot_id=? AND report_id=? ORDER BY ordinal",
              [input.snapshotId, input.id],
            )
            .all<{
              id: string;
              ordinal: number;
              file_id: string;
              file_revision: number;
              encrypted_payload: string;
            }>()
        ).results;
    if (!body) {
      if (stages.length !== files.length) return false;
      for (const [i, stage] of stages.entries()) {
        if (
          stage.ordinal !== i ||
          stage.file_id !== files[i]?.id ||
          stage.file_revision !== files[i]?.revision
        )
          return false;
        const selection = await core.decrypt(
          "v2_report_selections",
          stage.id,
          g.ownerId,
          1,
          stage.encrypted_payload,
          v2ReportFileSelectionSchema,
        );
        if (JSON.stringify(selection) !== JSON.stringify(files[i])) return false;
      }
    }
    for (const [ordinal, file] of (body ? files : []).entries()) {
      const actual = await core
        .statement(
          "SELECT f.encrypted_payload,f.declared_bytes,f.manifest_snapshot_id,s.revision AS manifest_revision FROM v2_files f JOIN v2_private_snapshots s ON s.id=f.manifest_snapshot_id WHERE f.id=? AND f.workspace_id=? AND f.revision=? AND f.state='ready'",
          [file.id, g.workspaceId, file.revision],
        )
        .first<{
          encrypted_payload: string;
          declared_bytes: number;
          manifest_snapshot_id: string;
          manifest_revision: number;
        }>();
      if (!actual) return false;
      const metadata = await core.decrypt(
        "v2_files",
        file.id,
        g.ownerId,
        file.revision,
        actual.encrypted_payload,
        z.strictObject({
          name: z.string(),
          declaredMediaType: z.string(),
          probe: v2FileProbeSchema.nullable(),
        }),
      );
      const manifest = await readSnapshot(
        core,
        g,
        actual.manifest_snapshot_id,
        "file_manifest",
        file.id,
        actual.manifest_revision,
        v2OriginalManifestSchema,
      );
      if (
        !manifest ||
        file.name !== metadata.name ||
        file.byteLength !== actual.declared_bytes ||
        file.contentHash !== manifest.contentHash
      )
        return false;
      const id = crypto.randomUUID();
      const encrypted = await core.encrypt("v2_report_selections", id, g.ownerId, 1, file);
      selectionValues.push({
        id,
        payload: encrypted,
        fileId: file.id,
        fileRevision: file.revision,
        filePayload: actual.encrypted_payload,
        manifestId: actual.manifest_snapshot_id,
        original:
          request.includeOriginals && request.selectedOriginalFileIds.includes(file.id) ? 1 : 0,
        ordinal,
      });
    }
    if (body)
      statements.push(
        core.statement(
          `INSERT INTO v2_report_selections(id,encrypted_payload,report_id,file_id,file_revision,original_selected,ordinal) SELECT json_extract(value,'$.id'),json_extract(value,'$.payload'),?,f.id,f.revision,json_extract(value,'$.original'),json_extract(value,'$.ordinal') FROM json_each(?) JOIN v2_files f ON f.id=json_extract(value,'$.fileId') WHERE f.workspace_id=? AND f.revision=json_extract(value,'$.fileRevision') AND f.encrypted_payload=json_extract(value,'$.filePayload') AND f.manifest_snapshot_id=json_extract(value,'$.manifestId') AND f.state='ready' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id) AND ${sqlClaim}`,
          [input.id, JSON.stringify(selectionValues), g.workspaceId, claimId],
        ),
      );
    else
      statements.push(
        core.statement(
          `INSERT INTO v2_report_selections(id,encrypted_payload,report_id,file_id,file_revision,original_selected,ordinal) SELECT stage.id,stage.encrypted_payload,?,f.id,f.revision,CASE WHEN f.id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END,stage.ordinal FROM v2_report_selection_stages stage JOIN v2_files f ON f.id=stage.file_id JOIN v2_private_snapshots manifest ON manifest.id=f.manifest_snapshot_id WHERE stage.snapshot_id=? AND stage.report_id=? AND f.workspace_id=? AND f.revision=stage.file_revision AND f.encrypted_payload=stage.source_file_envelope AND manifest.id=stage.source_manifest_id AND manifest.encrypted_payload=stage.source_manifest_envelope AND f.state='ready' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id) AND ${sqlClaim}`,
          [
            input.id,
            JSON.stringify(request.includeOriginals ? request.selectedOriginalFileIds : []),
            input.snapshotId,
            input.id,
            g.workspaceId,
            claimId,
          ],
        ),
      );
    statements.push(
      core.statement(
        "UPDATE v2_mutation_claims SET verified=CASE WHEN (SELECT count(*) FROM v2_report_selections WHERE report_id=?)=? THEN 1 ELSE 0 END WHERE id=?",
        [input.id, files.length, claimId],
      ),
      ...jobInsertStatements(
        core,
        g,
        {
          schemaVersion: "2",
          id: input.jobId,
          operationId: input.admission.operationId,
          target: {
            kind: "report",
            caseId: g.workspaceId,
            reportId: input.id,
            snapshotRevision: g.expectedRevision,
          },
          kind: "report_build",
          status: "queued",
          phase: "admission",
          progressPercent: 0,
          attempts: 0,
          failure: null,
          retryable: false,
          updatedAt: g.now,
        },
        claimId,
      ),
      core.bump(g, claimId),
      core.finish(claimId),
    );
    return core.changed(statements);
  };
  return {
    stageSelections(
      g: WorkspaceGuard,
      input: {
        reportId: string;
        snapshotId: string;
        ordinal: number;
        files: readonly V2ReportFileSelection[];
      },
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, input.reportId);
        parse(opaqueIdSchema, input.snapshotId);
        parse(z.number().int().min(0).max(99), input.ordinal);
        const files = parse(z.array(v2ReportFileSelectionSchema).min(1).max(4), input.files);
        if (input.ordinal + files.length > 100) return false;
        if (
          !(await core
            .statement(
              `SELECT s.id FROM v2_private_snapshots s JOIN v2_workspaces w ON w.id=s.workspace_id WHERE s.id=? AND s.owner_id=? AND s.target_id=? AND s.workspace_id=? AND w.owner_id=s.owner_id AND w.revision=? AND s.workspace_revision=w.revision AND s.purpose='report' AND s.state IN ('staging','sealed') AND ${aliveWorkspace}`,
              [input.snapshotId, g.ownerId, input.reportId, g.workspaceId, g.expectedRevision],
            )
            .first())
        )
          return false;
        const claimId = crypto.randomUUID();
        const statements = [
          core.claim(
            g,
            claimId,
            "EXISTS(SELECT 1 FROM v2_private_snapshots WHERE id=? AND owner_id=w.owner_id AND workspace_id=w.id AND workspace_revision=w.revision AND target_id=? AND purpose='report' AND state IN ('staging','sealed'))",
            [input.snapshotId, input.reportId],
          ),
        ];
        for (const [offset, file] of files.entries()) {
          const ordinal = input.ordinal + offset;
          const existing = await core
            .statement(
              "SELECT id,encrypted_payload FROM v2_report_selection_stages WHERE snapshot_id=? AND ordinal=?",
              [input.snapshotId, ordinal],
            )
            .first<{ id: string; encrypted_payload: string }>();
          if (existing) {
            const previous = await core.decrypt(
              "v2_report_selections",
              existing.id,
              g.ownerId,
              1,
              existing.encrypted_payload,
              v2ReportFileSelectionSchema,
            );
            if (JSON.stringify(previous) !== JSON.stringify(file)) return false;
            continue;
          }
          const actual = await core
            .statement(
              "SELECT f.encrypted_payload,f.declared_bytes,f.manifest_snapshot_id,s.revision AS manifest_revision,s.encrypted_payload AS manifest_envelope FROM v2_files f JOIN v2_private_snapshots s ON s.id=f.manifest_snapshot_id WHERE f.id=? AND f.workspace_id=? AND f.revision=? AND f.state='ready'",
              [file.id, g.workspaceId, file.revision],
            )
            .first<{
              encrypted_payload: string;
              declared_bytes: number;
              manifest_snapshot_id: string;
              manifest_revision: number;
              manifest_envelope: string;
            }>();
          if (!actual) return false;
          const metadata = await core.decrypt(
            "v2_files",
            file.id,
            g.ownerId,
            file.revision,
            actual.encrypted_payload,
            z.strictObject({
              name: z.string(),
              declaredMediaType: z.string(),
              probe: v2FileProbeSchema.nullable(),
            }),
          );
          const manifest = await readSnapshot(
            core,
            g,
            actual.manifest_snapshot_id,
            "file_manifest",
            file.id,
            actual.manifest_revision,
            v2OriginalManifestSchema,
          );
          if (
            !manifest ||
            metadata.name !== file.name ||
            actual.declared_bytes !== file.byteLength ||
            manifest.contentHash !== file.contentHash
          )
            return false;
          const id = crypto.randomUUID();
          const envelope = await core.encrypt("v2_report_selections", id, g.ownerId, 1, file);
          statements.push(
            core.statement(
              `INSERT INTO v2_report_selection_stages(id,snapshot_id,report_id,file_id,file_revision,ordinal,encrypted_payload,source_file_envelope,source_manifest_id,source_manifest_envelope) SELECT ?,?,?,f.id,f.revision,?,?,?,?,? FROM v2_files f JOIN v2_private_snapshots s ON s.id=f.manifest_snapshot_id WHERE f.id=? AND f.workspace_id=? AND f.revision=? AND f.state='ready' AND f.encrypted_payload=? AND s.id=? AND s.encrypted_payload=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id) AND ${sqlClaim}`,
              [
                id,
                input.snapshotId,
                input.reportId,
                ordinal,
                envelope,
                actual.encrypted_payload,
                actual.manifest_snapshot_id,
                actual.manifest_envelope,
                file.id,
                g.workspaceId,
                file.revision,
                actual.encrypted_payload,
                actual.manifest_snapshot_id,
                actual.manifest_envelope,
                claimId,
              ],
            ),
          );
        }
        statements.push(
          core.statement(
            "UPDATE v2_mutation_claims SET verified=CASE WHEN (SELECT count(*) FROM v2_report_selection_stages WHERE snapshot_id=? AND ordinal>=? AND ordinal<?)=? THEN 1 ELSE 0 END WHERE id=?",
            [input.snapshotId, input.ordinal, input.ordinal + files.length, files.length, claimId],
          ),
          core.finish(claimId),
        );
        return core.changed(statements);
      });
    },
    metadata(actor: Actor, id: string) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const row = await rowForOwner(actor, id);
        if (!row) return null;
        const metadata = await core.decrypt(
          "v2_reports",
          id,
          actor.ownerId,
          row.revision,
          row.encrypted_payload,
          metadataSchema,
        );
        const final = await rowForOwner(actor, id);
        return final?.state === row.state && final.revision === row.revision
          ? {
              schemaVersion: "2" as const,
              id,
              version: row.revision,
              snapshotRevision: row.workspace_revision,
              summaryRevision: row.summary_revision,
              status: row.state,
              request: metadata.request,
              currentJobId: row.current_job_id,
              failure: row.failure_code,
              createdAt: row.created_at,
            }
          : null;
      });
    },
    async *bodyFragments(actor: Actor, id: string) {
      actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
      const row = await rowForOwner(actor, id);
      if (!row) return;
      const staging = createV2StagingRepository(core);
      for await (const part of staging.fragments(actor, row.snapshot_id)) {
        const current = await rowForOwner(actor, id);
        if (!current || current.snapshot_id !== row.snapshot_id) return;
        yield part;
      }
    },
    readSelections(actor: Actor, id: string, afterOrdinal = -1, limit = 4, originalsOnly = false) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(z.number().int().min(-1).max(99), afterOrdinal);
        parse(z.number().int().min(1).max(8), limit);
        const report = await rowForOwner(actor, id);
        if (!report) return [];
        const rows = await core
          .statement(
            `SELECT id,ordinal,encrypted_payload,original_selected FROM v2_report_selections WHERE report_id=? AND ordinal>? ${originalsOnly ? "AND original_selected=1" : ""} ORDER BY ordinal LIMIT ?`,
            [id, afterOrdinal, limit],
          )
          .all<{
            id: string;
            ordinal: number;
            encrypted_payload: string;
            original_selected: number;
          }>();
        const values = [];
        for (const row of rows.results)
          values.push({
            ordinal: row.ordinal,
            originalSelected: row.original_selected === 1,
            file: await core.decrypt(
              "v2_report_selections",
              row.id,
              actor.ownerId,
              1,
              row.encrypted_payload,
              v2ReportFileSelectionSchema,
            ),
          });
        return (await rowForOwner(actor, id)) ? values : [];
      });
    },
    createSmall(g: WorkspaceGuard, report: V2Report, admission: Admission) {
      return safe(async () => {
        const value = parse(v2ReportSchema(guideHosts), report);
        if (value.status !== "queued" || !value.currentJobId) return false;
        return create(
          g,
          {
            id: value.id,
            snapshotId: crypto.randomUUID(),
            summaryRevision: value.summaryRevision,
            request: value.request,
            selectedFiles: value.body.selectedFiles,
            jobId: value.currentJobId,
            admission,
          },
          value.body,
        );
      });
    },
    createFromStaged: (...args: Parameters<typeof create>) => safe(() => create(...args)),
    read(actor: Actor, id: string) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const row = await rowForOwner(actor, id);
        if (!row) return null;
        const metadata = await core.decrypt(
          "v2_reports",
          id,
          actor.ownerId,
          row.revision,
          row.encrypted_payload,
          metadataSchema,
        );
        const body = await readSnapshot(
          core,
          actor,
          row.snapshot_id,
          "report",
          id,
          row.workspace_revision,
          v2ReportBodySchema(guideHosts),
        );
        if (!body) return null;
        const selections = await core
          .statement(
            "SELECT * FROM v2_report_selections WHERE report_id=? AND original_selected=1 ORDER BY ordinal",
            [id],
          )
          .all<{ id: string; encrypted_payload: string }>();
        const originalManifest =
          row.state === "ready" || row.state === "obsolete"
            ? await Promise.all(
                selections.results.map((s) =>
                  core.decrypt(
                    "v2_report_selections",
                    s.id,
                    actor.ownerId,
                    1,
                    s.encrypted_payload,
                    v2ReportFileSelectionSchema,
                  ),
                ),
              )
            : [];
        const value = parse(v2ReportSchema(guideHosts), {
          schemaVersion: "2",
          id,
          version: row.revision,
          snapshotRevision: row.workspace_revision,
          summaryRevision: row.summary_revision,
          createdAt: row.created_at,
          status: row.state,
          request: metadata.request,
          body,
          pdf: await artifact(actor, row.pdf_blob_id),
          originalsZip: await artifact(actor, row.zip_blob_id),
          originalManifest,
          currentJobId: row.current_job_id,
          failure: row.failure_code,
        });
        const final = await rowForOwner(actor, id);
        return final?.revision === row.revision &&
          final.state === row.state &&
          final.snapshot_id === row.snapshot_id &&
          final.encrypted_payload === row.encrypted_payload &&
          final.pdf_blob_id === row.pdf_blob_id &&
          final.zip_blob_id === row.zip_blob_id
          ? value
          : null;
      });
    },
    markObsolete(g: WorkspaceGuard, id: string) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, id);
        const claimId = crypto.randomUUID();
        return core.changed([
          core.claim(
            g,
            claimId,
            "EXISTS(SELECT 1 FROM v2_reports r WHERE r.id=? AND r.workspace_id=w.id AND r.state='ready' AND r.workspace_revision<w.revision AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='report' AND target_id=r.id))",
            [id],
          ),
          core.statement(`UPDATE v2_reports SET state='obsolete' WHERE id=? AND ${sqlClaim}`, [
            id,
            claimId,
          ]),
          core.finish(claimId),
        ]);
      });
    },
    complete(
      g: WorkspaceGuard,
      id: string,
      lease: JobLease,
      pdf: V2PrivateArtifact,
      zip: V2PrivateArtifact | null,
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(v2PrivateArtifactSchema, pdf);
        if (zip) parse(v2PrivateArtifactSchema, zip);
        const row = await rowForOwner(g, id);
        if (!row) return false;
        const metadata = await core.decrypt(
          "v2_reports",
          id,
          g.ownerId,
          row.revision,
          row.encrypted_payload,
          metadataSchema,
        );
        if (metadata.request.includeOriginals !== (zip !== null)) return false;
        const anchors = await core
          .statement(
            "SELECT id,encrypted_payload FROM v2_blobs WHERE id IN (?,?) AND state='stored'",
            [pdf.id, zip?.id ?? null],
          )
          .all<{ id: string; encrypted_payload: string }>();
        const pdfAnchor = anchors.results.find((blob) => blob.id === pdf.id);
        const zipAnchor = zip ? anchors.results.find((blob) => blob.id === zip.id) : null;
        if (!pdfAnchor || (zip && !zipAnchor)) return false;
        const actualPdf = await artifact(g, pdf.id);
        const actualZip = zip ? await artifact(g, zip.id) : null;
        if (
          JSON.stringify(actualPdf) !== JSON.stringify(pdf) ||
          JSON.stringify(actualZip) !== JSON.stringify(zip)
        )
          return false;
        const execution = leasePredicate(lease, id, row.workspace_revision, g.now);
        const claimId = crypto.randomUUID();
        return core.changed([
          core.claim(
            g,
            claimId,
            `${execution.sql} AND EXISTS(SELECT 1 FROM v2_reports WHERE id=? AND workspace_id=w.id AND state IN ('queued','building') AND current_job_id=? AND operation_id=? AND workspace_revision=? AND revision=? AND snapshot_id=? AND encrypted_payload=?) AND EXISTS(SELECT 1 FROM v2_blobs b JOIN v2_storage_reservations s ON s.id=b.reservation_id JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=w.owner_id AND s.workspace_id=w.id AND s.entity_id=? AND s.target_id=b.id AND s.operation_id=? AND b.state='stored' AND b.kind='report_pdf' AND b.visibility='private' AND b.encrypted_payload=? AND b.logical_bytes=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM v2_blobs b JOIN v2_storage_reservations s ON s.id=b.reservation_id JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=w.owner_id AND s.workspace_id=w.id AND s.entity_id=? AND s.target_id=b.id AND s.operation_id=? AND b.state='stored' AND b.kind='original_zip' AND b.visibility='private' AND b.encrypted_payload=? AND b.logical_bytes=?)) AND NOT EXISTS(SELECT 1 FROM v2_report_selections s JOIN v2_files f ON f.id=s.file_id WHERE s.report_id=? AND (f.state='deleting' OR EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id)))`,
            [
              ...execution.values,
              id,
              lease.jobId,
              row.operation_id,
              row.workspace_revision,
              row.revision,
              row.snapshot_id,
              row.encrypted_payload,
              pdf.id,
              id,
              row.operation_id,
              pdfAnchor.encrypted_payload,
              pdf.byteLength,
              zip?.id ?? null,
              zip?.id ?? null,
              id,
              row.operation_id,
              zipAnchor?.encrypted_payload ?? null,
              zip?.byteLength ?? null,
              id,
            ],
          ),
          core.statement(
            `UPDATE v2_reports SET state='ready',pdf_blob_id=?,zip_blob_id=?,current_job_id=NULL WHERE id=? AND ${sqlClaim}`,
            [pdf.id, zip?.id ?? null, id, claimId],
          ),
          ...completeLeaseStatements(core, lease, claimId, g.now),
          core.bump(g, claimId),
          core.finish(claimId),
        ]);
      });
    },
  };
}
