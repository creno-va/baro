import { z } from "zod";

const count = z.number().int().min(0).max(50);
const quotationResolutionSchema = z
  .strictObject({
    valid_span: count,
    unique_exact_match: count,
    text_not_found: count,
    ambiguous: count,
    invalid_text: count,
    source_unavailable: count,
  })
  .refine((value) => Object.values(value).reduce((sum, n) => sum + n, 0) <= 50);
export type QuotationResolution = z.infer<typeof quotationResolutionSchema>;
export function emptyQuotationResolution(): QuotationResolution {
  return {
    valid_span: 0,
    unique_exact_match: 0,
    text_not_found: 0,
    ambiguous: 0,
    invalid_text: 0,
    source_unavailable: 0,
  };
}
export function safeQuotationResolution(value: unknown) {
  const parsed = quotationResolutionSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
const scalarBoundary = (text: string, i: number) =>
  !(
    i > 0 &&
    i < text.length &&
    /[\uD800-\uDBFF]/.test(text[i - 1] ?? "") &&
    /[\uDC00-\uDFFF]/.test(text[i] ?? "")
  );
type Located =
  | { kind: "valid_span" | "unique_exact_match"; startUtf16: number; endUtf16: number }
  | { kind: "text_not_found" | "ambiguous" | "invalid_text" };
/** Literal location in the supplied excerpt only. This grants no source authority
 * and never changes text; callers still validate bindings, full originals and audit. */
export function locateLiteralQuotation(
  claim: { text: string; startUtf16: number; endUtf16: number },
  text: string,
): Located {
  if (
    !claim.text.length ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(claim.text)
  )
    return { kind: "invalid_text" };
  if (
    claim.startUtf16 >= 0 &&
    claim.endUtf16 <= text.length &&
    scalarBoundary(text, claim.startUtf16) &&
    scalarBoundary(text, claim.endUtf16) &&
    text.slice(claim.startUtf16, claim.endUtf16) === claim.text
  )
    return { kind: "valid_span", startUtf16: claim.startUtf16, endUtf16: claim.endUtf16 };
  const start = text.indexOf(claim.text);
  if (start < 0) return { kind: "text_not_found" };
  if (text.indexOf(claim.text, start + 1) !== -1) return { kind: "ambiguous" };
  const end = start + claim.text.length;
  if (!scalarBoundary(text, start) || !scalarBoundary(text, end)) return { kind: "invalid_text" };
  return { kind: "unique_exact_match", startUtf16: start, endUtf16: end };
}
