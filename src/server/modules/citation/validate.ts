import { citationSchema, type Result, retrievalOutputSchema } from "../../../contracts";
import { textHash } from "../legal-retrieval/service";

export async function validateCitations(result: Result, retrieval: unknown): Promise<boolean> {
  const sources = retrievalOutputSchema.safeParse(retrieval);
  if (!sources.success || result.asOfDate !== sources.data.asOfDate) return false;
  if (result.kind !== "guidance") return false;
  const allowed = new Map(sources.data.chunks.map((chunk) => [chunk.citation.id, chunk]));
  for (const citation of result.citations) {
    const parsed = citationSchema.safeParse(citation);
    const chunk = allowed.get(citation.id);
    if (
      !parsed.success ||
      !chunk ||
      JSON.stringify(citation) !== JSON.stringify(chunk.citation) ||
      (await textHash(chunk.text)) !== citation.contentHash
    )
      return false;
  }
  const used = new Set(result.citations.map((c) => c.id));
  return [...result.issues, ...result.nextSteps].every((item) =>
    item.citationIds.every((id) => used.has(id)),
  );
}
