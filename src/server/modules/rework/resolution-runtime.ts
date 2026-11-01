import type { ReworkReportView } from "@baro/api-client";
import type { V2ResolutionDraftRequest, V2ResolutionMutation } from "../../../contracts/v2";
import { v2ResolutionStateForGuidesSchema } from "../../../contracts/v2";
import { createV2AccountingRepository, operationStatements } from "../../db/v2-accounting";
import { sqlClaim, type V2Core } from "../../db/v2-core";
import { createV2FilesRepository } from "../../db/v2-files";
import { createV2ReworkRepository } from "../../db/v2-rework";
import { canonicalAnalysisJson } from "../legal-retrieval/analysis/context";
import { textHash } from "../legal-retrieval/service";
import { readBoundSourceBatch } from "../legal-retrieval/v2/bound-sources";
import { capturePublicationSourceAuthority } from "../legal-retrieval/v2/publication-authority";
import { GUIDE_HOSTS } from "../legal-retrieval/v2/registry";
import { reportSessionFence } from "../reports/fence";
import { buildProcedureSources } from "../resolution/procedure-sources";
import { createResolutionRuntimeAdapter } from "../resolution/runtime-adapter";
import { createResolutionService, ResolutionError } from "../resolution/service";
import { buildResolutionSource } from "../resolution/source-loader";
import type { ResolutionSource } from "../resolution/types";
import { loadAnalysisInput, readAnalysisScope } from "./analysis-input";
import { ReworkError } from "./case-context";
import { preparedAnalysisRecordSchema } from "./records";
import { readPreparedAnalysis, reworkAccess } from "./state";

/** Trusted local projection only: no retrieval, model, report creation or dispatch. */
export function createReworkResolutionRuntime(
  core: V2Core,
  deps: {
    clock: () => string;
    sessionId?: string;
    peekReport: (ownerId: string, caseId: string) => Promise<ReworkReportView | null>;
  },
) {
  const records = createV2ReworkRepository(core, { clock: deps.clock });
  const accounting = createV2AccountingRepository(core);
  const schema = v2ResolutionStateForGuidesSchema(GUIDE_HOSTS);
  const actor = (ownerId: string) => ({ ownerId, now: deps.clock() });
  async function requireSession(ownerId: string, caseId: string) {
    const session = reportSessionFence(deps.sessionId);
    if (
      !(await core
        .statement(
          `SELECT w.id FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? ${session.sql}`,
          [caseId, ownerId, ...session.values],
        )
        .first())
    )
      throw new ReworkError("NOT_FOUND");
  }
  async function source(ownerId: string, caseId: string) {
    if (!(await reworkAccess(core, ownerId, caseId))) throw new ReworkError("NOT_FOUND");
    await requireSession(ownerId, caseId);
    const a = actor(ownerId),
      scope = await readAnalysisScope(core, a, caseId);
    const loaded = await loadAnalysisInput(core, a, caseId, scope);
    const report = await deps.peekReport(ownerId, caseId);
    const raw = await records.read(a, caseId, "analysis", caseId, preparedAnalysisRecordSchema);
    const reportProof = report
      ? await core
          .statement(
            `SELECT revision,snapshot_id,encrypted_payload,
      (SELECT encrypted_payload FROM v2_private_snapshots WHERE id=r.snapshot_id AND state='published') canonical,
      (SELECT json_object('id',id,'payload',encrypted_payload) FROM v2_private_snapshots WHERE owner_id=? AND target_id=r.id AND purpose='report' AND revision=r.workspace_revision+1 AND state='published') review
      FROM v2_reports r WHERE id=? AND workspace_id=?`,
            [ownerId, report.id, caseId],
          )
          .first<{
            revision: number;
            snapshot_id: string;
            encrypted_payload: string;
            canonical: string | null;
            review: string | null;
          }>()
      : null;
    if (
      report &&
      (!reportProof || reportProof.revision !== report.revision || !reportProof.canonical)
    )
      throw new ReworkError("STALE_REVISION");
    const reportAuthority =
      report && reportProof
        ? {
            sql: `EXISTS(SELECT 1 FROM v2_reports r WHERE r.workspace_id=w.id AND r.id=? AND r.revision=? AND r.snapshot_id=? AND r.encrypted_payload=? AND (SELECT encrypted_payload FROM v2_private_snapshots WHERE id=r.snapshot_id AND state='published') IS ? AND (SELECT json_object('id',id,'payload',encrypted_payload) FROM v2_private_snapshots WHERE owner_id=w.owner_id AND target_id=r.id AND purpose='report' AND revision=r.workspace_revision+1 AND state='published') IS ?)`,
            values: [
              report.id,
              reportProof.revision,
              reportProof.snapshot_id,
              reportProof.encrypted_payload,
              reportProof.canonical,
              reportProof.review,
            ],
          }
        : { sql: "1", values: [] };

    const analysis = await readPreparedAnalysis(core, a, caseId, scope);
    const chunks = raw?.value.procedureCitations.length
      ? await readBoundSourceBatch(
          core,
          caseId,
          raw.value.procedureCitations.map((c) => c.id),
          a.now,
          GUIDE_HOSTS,
        )
      : [];
    const procedure = await buildProcedureSources({
      context: loaded.context,
      asOfDate:
        analysis?.asOfDate ?? new Date(Date.parse(a.now) + 9 * 3600000).toISOString().slice(0, 10),
      now: a.now,
      outcomes: chunks.flatMap((chunk, i) =>
        chunk &&
        canonicalAnalysisJson(chunk.citation) ===
          canonicalAnalysisJson(raw?.value.procedureCitations[i])
          ? [
              {
                kind: "official_guide" as const,
                availability: "verified" as const,
                reason: null,
                chunks: [chunk],
              },
            ]
          : [],
      ),
    });
    const input = loaded.input;
    let value: Omit<ResolutionSource, "stored">;
    if (input) {
      const unmasked = scope.maskIdentifiers
        ? await loadAnalysisInput(core, a, caseId, { ...scope, maskIdentifiers: false })
        : loaded;
      const fileNames: Record<string, string> = {};
      const files = createV2FilesRepository(core);
      for (const f of input.includedEvidence) {
        const file = await files.read(a, f.fileId);
        if (!file || file.revision !== f.fileRevision) throw new ReworkError("STALE_REVISION");
        fileNames[f.fileId] = file.name;
      }
      value = await buildResolutionSource({
        input,
        context: loaded.context,
        workspaceRevision: loaded.workspace.workspaceRevision,
        currentAnalysis: analysis,
        report,
        procedureSources: procedure,
        maskingTokens: unmasked.input?.confirmedSummary.parties.map((p) => p.label) ?? [],
        fileNames,
      });
    } else
      value = {
        basis: null,
        context: loaded.context,
        report: report
          ? {
              id: report.id,
              revision: report.revision,
              stale: true,
              selectedFileIds: [],
              maskIdentifiers: report.maskIdentifiers,
            }
          : null,
        facts: [],
        files: [],
        analysis: null,
        citations: [],
        sourceClaims: [],
        procedureChecks: procedure.procedureChecks,
        documentSupport: [],
        maskingTokens: [],
      };
    const proof = await capturePublicationSourceAuthority(
      core,
      { ...a, workspaceId: caseId, expectedRevision: loaded.workspace.workspaceRevision },
      value.citations.map((c) => ({ kind: "official_source" as const, citationId: c.id })),
      value.citations,
      GUIDE_HOSTS,
    );
    if (!proof) throw new ReworkError("STALE_REVISION");
    const guard = (now: string) => ({
      sql: `(${loaded.authority.sql}) AND (${proof.sql}) AND (${reportAuthority.sql}) ${reportSessionFence(deps.sessionId).sql} AND (SELECT id FROM v2_reports WHERE workspace_id=w.id AND id NOT LIKE 'export-%' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='report' AND target_id=v2_reports.id) ORDER BY revision DESC,created_at DESC,id DESC LIMIT 1) IS ? AND (SELECT id FROM v2_rework_records WHERE workspace_id=w.id AND kind='analysis' AND entity_id=w.id AND state='published' ORDER BY revision DESC LIMIT 1) IS ?`,
      values: [
        ...loaded.authority.values,
        ...proof.values(now),
        ...reportAuthority.values,
        ...reportSessionFence(deps.sessionId).values,
        report?.id ?? null,
        raw?.id ?? null,
      ],
    });
    return { value, guard, workspaceRevision: loaded.workspace.workspaceRevision };
  }
  function service(receipt?: {
    ownerId: string;
    caseId: string;
    route: string;
    key: string;
    hash: string;
  }) {
    let publicationRevision: number | null = null;
    return createResolutionService(
      createResolutionRuntimeAdapter(core, {
        guideHosts: GUIDE_HOSTS,
        now: deps.clock,
        loadSource: async (owner, id) => (await source(owner, id)).value,
        authorize: async (owner, id, basis, mode) => {
          if (!(await reworkAccess(core, owner, id, mode === "write"))) return false;
          if (!basis) return true;
          const fresh = await source(owner, id);
          return canonicalAnalysisJson(fresh.value.basis) === canonicalAnalysisJson(basis);
        },
        publicationAuthority: async (owner, id, basis) => {
          const fresh = await source(owner, id);
          if (basis && canonicalAnalysisJson(fresh.value.basis) !== canonicalAnalysisJson(basis))
            throw new ResolutionError("STALE_REVISION");
          publicationRevision = fresh.workspaceRevision;
          return (now) => {
            const guard = fresh.guard(now);
            return receipt
              ? {
                  sql: `(${guard.sql}) AND NOT EXISTS(SELECT 1 FROM v2_idempotency WHERE owner_id=w.owner_id AND route=? AND key=? AND expires_at>?)`,
                  values: [...guard.values, receipt.route, receipt.key, now],
                }
              : guard;
          };
        },
        ...(receipt
          ? {
              publicationStatements: (claim: string, id: string) => {
                if (publicationRevision === null) throw new ReworkError("STALE_REVISION");
                return [
                  ...operationStatements(
                    core,
                    actor(receipt.ownerId),
                    {
                      id,
                      workspaceId: receipt.caseId,
                      kind: "report",
                      revision: publicationRevision,
                      route: receipt.route,
                      key: receipt.key,
                      requestHash: receipt.hash,
                    },
                    claim,
                  ),
                  core.statement(
                    `UPDATE v2_operations SET state='completed' WHERE id=? AND ${sqlClaim}`,
                    [id, claim],
                  ),
                ];
              },
            }
          : {}),
      }),
    );
  }
  const replay = async (
    ownerId: string,
    caseId: string,
    route: string,
    key: string,
    hash: string,
  ) => {
    if (!(await reworkAccess(core, ownerId, caseId))) throw new ReworkError("NOT_FOUND");
    if (!(await reworkAccess(core, ownerId, caseId, true)))
      throw new ReworkError("CONSENT_REQUIRED");
    const previous = await accounting.findOperation(actor(ownerId), route, key, hash);
    if (previous?.kind === "conflict") throw new ReworkError("IDEMPOTENCY_CONFLICT");
    if (!previous) return null;
    await requireSession(ownerId, caseId);
    const saved = await records.read(
      actor(ownerId),
      caseId,
      "resolution",
      caseId,
      schema,
      previous.operation.id,
    );
    if (!saved) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
    await requireSession(ownerId, caseId);
    // Replay retains its original bytes, but cannot grant current source authority.
    return saved.value;
  };
  async function mutate(
    ownerId: string,
    caseId: string,
    key: string,
    input: V2ResolutionMutation | V2ResolutionDraftRequest,
    draft: boolean,
    override?: { route: string; hash: string },
  ) {
    const route =
      override?.route ?? `/api/v2/cases/${caseId}/rework/resolution${draft ? "/draft" : ""}`;
    const hash = override?.hash ?? (await textHash(canonicalAnalysisJson(input)));
    const previous = await replay(ownerId, caseId, route, key, hash);
    if (previous) return previous;
    const s = service({ ownerId, caseId, route, key, hash });
    try {
      return await (draft
        ? s.prepareDraft(ownerId, caseId, input)
        : s.update(ownerId, caseId, input));
    } catch (error) {
      const won = await replay(ownerId, caseId, route, key, hash);
      if (won) return won;
      throw error;
    }
  }
  return {
    get: (owner: string, id: string) => service().get(owner, id),
    update: (owner: string, id: string, key: string, input: V2ResolutionMutation) =>
      mutate(owner, id, key, input, false),
    draft: (owner: string, id: string, key: string, input: V2ResolutionDraftRequest) =>
      mutate(owner, id, key, input, true),
    select: async (
      owner: string,
      id: string,
      key: string,
      choice: "self" | "lawyer" | "save_report",
      hash: string,
    ) => {
      const route = `/api/v2/cases/${id}/rework/actions`;
      const previous = await replay(owner, id, route, key, hash);
      if (previous) return previous;
      const current = await service().get(owner, id);
      const currentReport = (await source(owner, id)).value.report;
      if (!currentReport) throw new ResolutionError("REVIEW_REQUIRED");
      return mutate(
        owner,
        id,
        key,
        {
          action: "select",
          choice,
          expectedRevision: current.revision,
          reportId: currentReport.id,
          reportRevision: currentReport.revision,
          selectedFileIds: current.selectedFileIds,
          maskIdentifiers: current.maskIdentifiers,
        },
        false,
        { route, hash },
      );
    },
    replay,
  };
}
