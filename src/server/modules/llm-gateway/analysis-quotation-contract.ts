import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import { emptyQuotationResolution, locateLiteralQuotation } from "../citation/literal-quotation";
import { legalAnalysisOutputSchema } from "./analysis-schema";

const excerptInput = z.object({
  citations: z.array(z.object({ id: opaqueIdSchema })).max(10),
  sourceTexts: z
    .array(z.object({ citationId: opaqueIdSchema, text: z.string().max(20000) }))
    .max(10),
});
/** Output-contract check only: supplied literal excerpts, no source authority.
 * Corrected output still needs domain grounding, independent audit and full claims. */
export function legalQuotationContractFailure(output: unknown, input: unknown) {
  const draft = legalAnalysisOutputSchema.safeParse(output);
  if (!draft.success) return undefined; // Existing schema boundary remains unchanged.
  const quotations = draft.data.sourceClaims.filter((claim) => claim.kind === "quotation");
  if (!quotations.length) return undefined;
  const resolution = emptyQuotationResolution();
  const sources = excerptInput.safeParse(input);
  for (const claim of quotations) {
    const texts = sources.success
      ? sources.data.sourceTexts.filter((t) => t.citationId === claim.citationId)
      : [];
    const citations = sources.success
      ? sources.data.citations.filter((c) => c.id === claim.citationId)
      : [];
    const text = texts[0]?.text;
    if (texts.length !== 1 || citations.length !== 1 || text === undefined) {
      resolution.source_unavailable++;
      continue;
    }
    resolution[locateLiteralQuotation(claim, text).kind]++;
  }
  return resolution.text_not_found ||
    resolution.ambiguous ||
    resolution.invalid_text ||
    resolution.source_unavailable
    ? resolution
    : undefined;
}
