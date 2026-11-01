import { createPrecedentRelevance } from "../research/relevance";
import { analysisCaseFacts, type LegalAnalysisInput } from "./context";

/** Pass to createV2LegalRetrieval's SERVER-ONLY precedentDiscovery option.
 * Rank the existing forty-title pool before spending detail requests; the case
 * context never becomes an external query. The common twelve-attempt cap stays. */
export function analysisPrecedentDiscovery(input: LegalAnalysisInput) {
  const relevance = createPrecedentRelevance({
    ...input.confirmedSummary,
    facts: analysisCaseFacts(input),
  });
  return { rank: relevance.candidates };
}
