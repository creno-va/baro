import { z } from "zod";
import { safeClaimFailure } from "../../citation/claim-diagnostics";
import { safeQuotationResolution } from "../../citation/literal-quotation";
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
    "quotation_contract",
    "stale_revision",
    "source_unavailable",
    "dependency_unavailable",
    "unknown",
  ]),
});
export type LegalAnalysisFailure = z.infer<typeof header> & {
  auditFailure?: NonNullable<ReturnType<typeof safeWorkspaceAuditFailure>>;
  claimFailure?: NonNullable<ReturnType<typeof safeClaimFailure>>;
  quotationResolution?: NonNullable<ReturnType<typeof safeQuotationResolution>>;
};

/** Private workflow receipt: enums/counts only. Never retain draft, text, IDs or offsets. */
export function safeLegalAnalysisFailure(raw: unknown): LegalAnalysisFailure | undefined {
  const parsed = header.safeParse(raw);
  if (!parsed.success) return undefined;
  const value = raw as Record<string, unknown>;
  const auditFailure = safeWorkspaceAuditFailure(value.auditFailure);
  const claimFailure = safeClaimFailure(value.claimFailure);
  const quotationResolution = safeQuotationResolution(value.quotationResolution);
  return {
    ...parsed.data,
    ...(auditFailure ? { auditFailure } : {}),
    ...(claimFailure ? { claimFailure } : {}),
    ...(quotationResolution ? { quotationResolution } : {}),
  };
}
