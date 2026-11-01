import { z } from "zod";
import { maskReportText } from "../../../components/reports/download";
import {
  type V2Fact,
  type V2Summary,
  v2OriginalManifestSchema,
  v2SummarySchema,
} from "../../../contracts/v2";
import {
  type Actor,
  aliveWorkspace,
  MAX_REHYDRATE_BYTES,
  readSnapshot,
  utf8Bytes,
  type V2Core,
} from "../../db/v2-core";
import { createV2FilesRepository } from "../../db/v2-files";
import { researchRevisionBase } from "../../db/v2-research-revision";
import type { ReworkWriteGuard } from "../../db/v2-rework";
import { createV2WorkspaceRepository } from "../../db/v2-workspace";
import {
  type LegalAnalysisInput,
  legalAnalysisInputSchema,
} from "../legal-retrieval/analysis/context";
import { MATERIAL_CONTEXT_BYTES, readMaterialWindow } from "../workspace/materials";
import { createReworkCaseService, ReworkError } from "./case-context";

export type AnalysisScope = LegalAnalysisInput["scope"];
export const defaultAnalysisScope = (): AnalysisScope => ({
  excludedFileIds: [],
  maskIdentifiers: false,
});
const reportScopeSchema = z.object({
  excludedFileIds: legalAnalysisInputSchema.shape.scope.shape.excludedFileIds,
  maskIdentifiers: z.boolean(),
});

/** Scope lookup never calls reports.get, which retains legacy create-on-read semantics. */
export async function readAnalysisScope(
  core: V2Core,
  a: Actor,
  id: string,
): Promise<AnalysisScope> {
  const row = await core
    .statement(
      `SELECT r.id,r.workspace_revision,s.id review_id FROM v2_reports r JOIN v2_workspaces w ON w.id=r.workspace_id LEFT JOIN v2_private_snapshots s ON s.owner_id=w.owner_id AND s.target_id=r.id AND s.purpose='report' AND s.revision=r.workspace_revision+1 AND s.state='published' WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace} AND r.id NOT LIKE 'export-%' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='report' AND target_id=r.id) ORDER BY r.revision DESC,r.created_at DESC,r.id DESC LIMIT 1`,
      [id, a.ownerId],
    )
    .first<{ id: string; workspace_revision: number; review_id: string | null }>();
  if (!row?.review_id) return defaultAnalysisScope();
  const value = await readSnapshot(
    core,
    a,
    row.review_id,
    "report",
    row.id,
    row.workspace_revision + 1,
    reportScopeSchema,
  );
  if (!value) throw new ReworkError("STALE_REVISION");
  return value;
}

/** Exact confirmed sources, filtered before model input. No network or dispatch. */
export async function loadAnalysisInput(
  core: V2Core,
  a: Actor,
  id: string,
  scope: AnalysisScope = defaultAnalysisScope(),
) {
  scope = legalAnalysisInputSchema.shape.scope.parse(scope);
  const repo = createV2WorkspaceRepository(core.binding, core.cipher),
    files = createV2FilesRepository(core);
  const workspace = await repo.findWorkspace(a, id);
  if (!workspace) throw new ReworkError("NOT_FOUND");
  const context = await createReworkCaseService(core, { clock: () => a.now }).get(a.ownerId, id);
  const source = await core
    .statement(
      `SELECT w.encrypted_payload,i.summary_id FROM v2_workspaces w JOIN v2_intakes i ON i.id=w.id WHERE w.id=? AND w.owner_id=? AND w.revision=? AND ${aliveWorkspace}`,
      [id, a.ownerId, workspace.workspaceRevision],
    )
    .first<{ encrypted_payload: string; summary_id: string | null }>();
  if (!source) throw new ReworkError("STALE_REVISION");
  const rows = (
    await core
      .statement(
        `SELECT f.id,f.revision,f.state,f.encrypted_payload,f.manifest_snapshot_id,f.coverage_snapshot_id FROM v2_files f JOIN v2_workspaces w ON w.id=f.workspace_id WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace} AND f.state!='deleting' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id) ORDER BY f.id LIMIT 101`,
        [id, a.ownerId],
      )
      .all<{
        id: string;
        revision: number;
        state: string;
        encrypted_payload: string;
        manifest_snapshot_id: string | null;
        coverage_snapshot_id: string | null;
      }>()
  ).results;
  if (rows.length > 100) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
  const pendingEvidenceIds = rows
    .filter((r) => !scope.excludedFileIds.includes(r.id) && !["ready", "failed"].includes(r.state))
    .map((r) => r.id);
  const frozen = JSON.stringify(rows);
  const authority: ReworkWriteGuard = {
    sql: `w.encrypted_payload=? AND EXISTS(SELECT 1 FROM v2_intakes WHERE id=w.id AND summary_id IS ?) AND (SELECT json_group_array(json_object('id',id,'revision',revision,'state',state,'encrypted_payload',encrypted_payload,'manifest_snapshot_id',manifest_snapshot_id,'coverage_snapshot_id',coverage_snapshot_id)) FROM (SELECT f.id,f.revision,f.state,f.encrypted_payload,f.manifest_snapshot_id,f.coverage_snapshot_id FROM v2_files f WHERE f.workspace_id=w.id AND f.state!='deleting' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id) ORDER BY f.id))=?`,
    values: [source.encrypted_payload, source.summary_id, frozen],
  };
  const current = async () =>
    !!(await core
      .statement(
        `SELECT w.id FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND w.revision=? AND ${aliveWorkspace} AND (${authority.sql})`,
        [id, a.ownerId, workspace.workspaceRevision, ...authority.values],
      )
      .first());
  const limits: string[] = [];
  if (rows.some((r) => r.state === "failed" && !scope.excludedFileIds.includes(r.id)))
    limits.push(
      "처리에 실패한 자료는 분석 근거로 사용하지 않았어요. 자료 화면에서 실제 오류와 원본을 확인해 주세요.",
    );
  if (!workspace.confirmedSummaryRevision) {
    if (!(await current())) throw new ReworkError("STALE_REVISION");
    return {
      workspace,
      context: context.context,
      input: null,
      pendingEvidenceIds,
      authority,
      limits,
    };
  }
  let text = "",
    bytes = 0;
  for await (const part of repo.summaryFragments(a, id)) {
    bytes += utf8Bytes(part.text);
    if (bytes > MAX_REHYDRATE_BYTES) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
    text += part.text;
  }
  // The stream stops when its owner/revision source fence changes. Never parse
  // that interrupted (possibly empty) JSON as if it were a complete snapshot.
  if (!(await current())) throw new ReworkError("STALE_REVISION");
  const original = v2SummarySchema.parse(JSON.parse(text));
  if (original.revision !== workspace.confirmedSummaryRevision)
    throw new ReworkError("STALE_REVISION");
  const includedEvidence: LegalAnalysisInput["includedEvidence"] = [],
    materials: LegalAnalysisInput["materials"] = [];
  let materialBytes = 0;
  for (const row of rows) {
    if (row.state !== "ready" || scope.excludedFileIds.includes(row.id)) continue;
    const metadata = await files.metadata(a, row.id);
    if (!metadata?.manifestSnapshotId) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
    const manifestRevision = await core
      .statement("SELECT revision FROM v2_private_snapshots WHERE id=?", [
        metadata.manifestSnapshotId,
      ])
      .first<number>("revision");
    const manifest = manifestRevision
      ? await readSnapshot(
          core,
          a,
          metadata.manifestSnapshotId,
          "file_manifest",
          row.id,
          manifestRevision,
          v2OriginalManifestSchema,
        )
      : null;
    if (!manifest) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
    includedEvidence.push({
      fileId: row.id,
      fileRevision: row.revision,
      contentHash: manifest.contentHash,
    });
    let ordinal = 0;
    while (true) {
      const window = await readMaterialWindow(
        core,
        a,
        id,
        { fileId: row.id, fileRevision: row.revision, startOrdinal: ordinal, count: 32 },
        MATERIAL_CONTEXT_BYTES - materialBytes,
      );
      for (const m of window.materials) {
        materials.push({
          reference: m.reference,
          text: m.text,
          coverage: legalAnalysisInputSchema.shape.materials.element.shape.coverage.parse(
            m.coverage,
          ),
        });
        materialBytes += utf8Bytes(JSON.stringify(m));
      }
      if (materials.length > 100 || materialBytes > MATERIAL_CONTEXT_BYTES)
        throw new ReworkError("DEPENDENCY_UNAVAILABLE");
      if (window.nextOrdinal === null) break;
      if (window.nextOrdinal <= ordinal) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
      ordinal = window.nextOrdinal;
    }
  }
  // Excluding evidence also excludes dependent assertions and their unresolved
  // conflict group. It never upgrades the remaining side into a proven fact.
  const ids = new Set(
    original.facts
      .filter((f) =>
        f.references.every(
          (r) =>
            r.kind !== "user_material" ||
            includedEvidence.some(
              (e) => e.fileId === r.fileId && e.fileRevision === r.fileRevision,
            ),
        ),
      )
      .map((f) => f.id),
  );
  let removed = true;
  while (removed) {
    removed = false;
    for (const f of original.facts)
      if (ids.has(f.id) && f.conflictingFactIds.some((id) => !ids.has(id))) {
        ids.delete(f.id);
        removed = true;
      }
  }
  let facts = original.facts.filter((f) => ids.has(f.id));
  if (facts.length !== original.facts.length)
    limits.push(
      "제외되었거나 현재 확인할 수 없는 자료에 의존하는 사실과 연결된 상충 사실은 이번 분석에 포함하지 않았어요. 원래 사건 정리와 이전 리포트는 보존돼요.",
    );
  let summary: V2Summary = { ...original, facts };
  const inputContext = structuredClone(context.context);
  if (scope.maskIdentifiers) {
    const names = original.parties
      .map((p) => p.label)
      .filter(
        (name) =>
          name.length > 1 &&
          !/^(사용자|상대방|당사자|본인|회사|기업|고객|법원|기관|미확인|우리 측)$/.test(name),
      );
    const mask = (s: string) =>
      names.reduce((out, name) => out.split(name).join("[당사자 가림]"), maskReportText(s));
    const maskFact = (f: V2Fact) => ({ ...f, text: mask(f.text) });
    facts = facts.map(maskFact);
    summary = {
      ...summary,
      overview: mask(summary.overview),
      facts,
      parties: summary.parties.map((p) => ({ ...p, label: mask(p.label), role: mask(p.role) })),
      unknowns: summary.unknowns.map(mask),
      notices: summary.notices.map(mask),
    };
    for (const m of materials) m.text = mask(m.text);
    if (inputContext.procedure.description)
      inputContext.procedure.description = mask(inputContext.procedure.description);
  }
  const input = legalAnalysisInputSchema.parse({
    context: inputContext,
    confirmedSummary: summary,
    facts,
    includedEvidence,
    materials,
    researchRevision: await researchRevisionBase(
      core,
      a.ownerId,
      id,
      workspace.workspaceRevision,
      workspace.confirmedSummaryRevision,
    ),
    scope,
  });
  if (!(await current())) throw new ReworkError("STALE_REVISION");
  return { workspace, context: context.context, input, pendingEvidenceIds, authority, limits };
}
