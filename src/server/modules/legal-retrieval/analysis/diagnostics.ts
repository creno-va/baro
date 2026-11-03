import { z } from "zod";
import { safeClaimFailure } from "../../citation/claim-diagnostics";
import { safeWorkspaceAuditFailure } from "../../workspace/audit-diagnostics";

const header = z.object({
  stage: z.enum([
    "context",
    "planning",
    "retrieval",
    "generation",
    "grounding",
    "audit",
    "claims",
    "source_recheck",
    "publication",
    "report_continuation",
  ]),
  reason: z.enum([
    "provider_refusal",
    "model_schema",
    "invalid_plan",
    "draft_grounding",
    "unsupported_instrument_number",
    "audit_rejected",
    "claim_validation",
    "stale_revision",
    "source_unavailable",
    "dependency_unavailable",
    "unknown",
  ]),
});
export type LegalAnalysisFailure = z.infer<typeof header> & {
  auditFailure?: NonNullable<ReturnType<typeof safeWorkspaceAuditFailure>>;
  claimFailure?: NonNullable<ReturnType<typeof safeClaimFailure>>;
};

/** Private workflow receipt: enums/counts only. Never retain draft, text, IDs or offsets. */
export function safeLegalAnalysisFailure(raw: unknown): LegalAnalysisFailure | undefined {
  const parsed = header.safeParse(raw);
  if (!parsed.success) return undefined;
  const value = raw as Record<string, unknown>;
  const auditFailure = safeWorkspaceAuditFailure(value.auditFailure);
  const claimFailure = safeClaimFailure(value.claimFailure);
  return {
    ...parsed.data,
    ...(auditFailure ? { auditFailure } : {}),
    ...(claimFailure ? { claimFailure } : {}),
  };
}
