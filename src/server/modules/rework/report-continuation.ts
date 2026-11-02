import { opaqueIdSchema } from "../../../contracts";
import { v2FailureCodeSchema } from "../../../contracts/v2";
import { createV2AccountingRepository, operationStatements } from "../../db/v2-accounting";
import { sqlClaim, type V2Core } from "../../db/v2-core";
import { createV2ReworkRepository } from "../../db/v2-rework";
import { createV2WorkspaceRepository } from "../../db/v2-workspace";
import { analysisBasis, canonicalAnalysisJson } from "../legal-retrieval/analysis/context";
import { textHash } from "../legal-retrieval/service";
import { createCaseReportDependencies } from "../reports/runtime";
import { createReportsService } from "../reports/service";
import type { ReportDependencies } from "../reports/storage";
import { loadAnalysisInput, readAnalysisScope } from "./analysis-input";
import { ReworkError } from "./case-context";
import {
  automaticPreparationRecordSchema,
  preparedAnalysisRecordSchema,
  reportContinuationSchema,
} from "./records";
import { readPreparedAnalysis, reworkAccess } from "./state";

/** A durable, exactly-once registration precedes model-free report generation.
 * Its receipt retains the original report CAS across retries/browser closure. */
export function createReportContinuation(
  core: V2Core,
  env: Env,
  deps: {
    clock?: () => string;
    reportDependencies?: (ownerId: string, caseId: string) => Promise<ReportDependencies>;
  } = {},
) {
  const clock = deps.clock ?? (() => new Date().toISOString()),
    entityId = "report-continuation",
    records = createV2ReworkRepository(core, { clock }),
    accounting = createV2AccountingRepository(core),
    workspaces = createV2WorkspaceRepository(core.binding, core.cipher);
  return {
    async prepare(
      ownerId: string,
      caseId: string,
      requestId: string,
      expectedRevision: number | null,
      originalRequestHash?: string,
    ) {
      opaqueIdSchema.parse(requestId);
      if (!(await reworkAccess(core, ownerId, caseId))) throw new ReworkError("NOT_FOUND");
      if (!(await reworkAccess(core, ownerId, caseId, true)))
        throw new ReworkError("CONSENT_REQUIRED");
      const actor = () => ({ ownerId, now: clock() }),
        route = `/api/v2/cases/${caseId}/rework/report-continuation`;
      const hash =
        originalRequestHash ??
        (await textHash(canonicalAnalysisJson({ requestId, expectedRevision })));
      const replay = await accounting.findOperation(actor(), route, requestId, hash);
      if (replay?.kind === "conflict") throw new ReworkError("IDEMPOTENCY_CONFLICT");
      let registered = replay
        ? await records.read(
            actor(),
            caseId,
            "checkpoint",
            entityId,
            reportContinuationSchema,
            replay.operation.id,
          )
        : null;
      if (replay && !registered) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
      if (!registered) {
        const raw = await records.read(
          actor(),
          caseId,
          "analysis",
          caseId,
          preparedAnalysisRecordSchema,
        );
        const automatic = await records.read(
          actor(),
          caseId,
          "checkpoint",
          "automatic-preparation",
          automaticPreparationRecordSchema,
        );
        const useAutomatic =
          automatic?.value.status === "failed" &&
          (!raw ||
            canonicalAnalysisJson(automatic.value.basis) !==
              canonicalAnalysisJson(raw.value.basis));
        const proofRecord = useAutomatic ? automatic : raw;
        const basis = proofRecord?.value.basis;
        if (!basis) throw new ReworkError("REVIEW_REQUIRED");
        const snapshot = await readPreparedAnalysis(core, actor(), caseId);
        if (!snapshot) {
          const current = await loadAnalysisInput(
            core,
            actor(),
            caseId,
            useAutomatic ? await readAnalysisScope(core, actor(), caseId) : raw?.value.scope,
          );
          if (
            !(raw?.value.failure || automatic?.value.status === "failed") ||
            !current.input ||
            canonicalAnalysisJson(await analysisBasis(current.input)) !==
              canonicalAnalysisJson(basis)
          )
            throw new ReworkError("STALE_REVISION");
        }
        const w = await workspaces.findWorkspace(actor(), caseId);
        if (!w || w.currentJobId) throw new ReworkError("STALE_REVISION");
        const prior = await records.head(actor(), caseId, "checkpoint", entityId);
        const g = { ...actor(), workspaceId: caseId, expectedRevision: w.workspaceRevision };
        registered = await records.write(g, {
          kind: "checkpoint",
          entityId,
          expectedVersion: prior?.revision ?? 0,
          schema: reportContinuationSchema,
          value: {
            format: "report-continuation-v1",
            requestId,
            requestHash: hash,
            basis,
            expectedReportRevision: expectedRevision,
            registeredWorkspaceRevision: g.expectedRevision,
            status: "pending",
            failure: null,
            errorCode: null,
            reportId: null,
            reportRevision: null,
          },
          authority: {
            sql: "EXISTS(SELECT 1 FROM v2_rework_records r WHERE r.id=? AND r.workspace_id=w.id AND r.state='published' AND r.revision=(SELECT max(revision) FROM v2_rework_records WHERE workspace_id=w.id AND kind=r.kind AND entity_id=r.entity_id AND state='published')) AND NOT EXISTS(SELECT 1 FROM v2_idempotency WHERE owner_id=w.owner_id AND route=? AND key=? AND expires_at>?)",
            values: [proofRecord?.id, route, requestId, g.now],
          },
          statements: (claim, id) => [
            ...operationStatements(
              core,
              g,
              {
                id,
                workspaceId: caseId,
                kind: "report",
                revision: w.workspaceRevision,
                route,
                key: requestId,
                requestHash: hash,
              },
              claim,
            ),
            // This operation confirms registration, not report completion. The
            // actual report owns its existing generation operation and job.
            core.statement(
              `UPDATE v2_operations SET state='completed' WHERE id=? AND ${sqlClaim}`,
              [id, claim],
            ),
          ],
        });
        if (!registered) {
          const won = await accounting.findOperation(actor(), route, requestId, hash);
          if (won?.kind !== "replay") throw new ReworkError("STALE_REVISION");
          registered = await records.read(
            actor(),
            caseId,
            "checkpoint",
            entityId,
            reportContinuationSchema,
            won.operation.id,
          );
          if (!registered) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
        }
      }
      const original = registered.value;
      const mark = async (
        status: "ready" | "failed",
        report: { id: string; revision: number } | null,
        errorCode: string | null,
      ) => {
        const [latest, w] = await Promise.all([
          records.read(actor(), caseId, "checkpoint", entityId, reportContinuationSchema),
          workspaces.findWorkspace(actor(), caseId),
        ]);
        if (
          !latest ||
          !w ||
          latest.value.requestId !== requestId ||
          latest.value.requestHash !== hash
        )
          return;
        const code = v2FailureCodeSchema.safeParse(errorCode);
        await records.write(
          { ...actor(), workspaceId: caseId, expectedRevision: w.workspaceRevision },
          {
            kind: "checkpoint",
            entityId,
            expectedVersion: latest.revision,
            schema: reportContinuationSchema,
            value: {
              ...original,
              status,
              reportId: report?.id ?? null,
              reportRevision: report?.revision ?? null,
              failure:
                status === "failed" ? (code.success ? code.data : "STORAGE_UNAVAILABLE") : null,
              errorCode,
            },
            ...(w.currentJobId ? { metadataJobId: w.currentJobId } : {}),
          },
        );
      };
      try {
        const report = await createReportsService(
          core,
          await (deps.reportDependencies?.(ownerId, caseId) ??
            createCaseReportDependencies(env, core, ownerId, caseId, undefined, clock)),
        ).generate(ownerId, caseId, `rework-report-${await textHash(requestId)}`, {
          expectedRevision: original.expectedReportRevision,
        });
        await mark("ready", report, null);
        return report;
      } catch (error) {
        const code = (error as { code?: string })?.code;
        const known = v2FailureCodeSchema.safeParse(code);
        const errorCode = known.success
          ? known.data
          : [
                "STALE_REVISION",
                "IDEMPOTENCY_CONFLICT",
                "EXPORT_LIMIT_EXCEEDED",
                "REVIEW_REQUIRED",
                "CONSENT_REQUIRED",
                "NOT_FOUND",
              ].includes(code ?? "")
            ? (code as string)
            : "STORAGE_UNAVAILABLE";
        // Preserve the actual generation error even if consent/revision changed
        // before the failure checkpoint could be saved. The pending intent remains.
        try {
          await mark("failed", null, errorCode);
        } catch {
          /* no private diagnostic payload */
        }
        throw error;
      }
    },
  };
}
