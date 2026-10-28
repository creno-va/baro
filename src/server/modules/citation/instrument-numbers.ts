import type { SourceClaim } from "./v2-validate";

// These identify promulgated instruments, not law.go.kr's internal officialId.
// Normalize presentation only here; quotation/span validation stays byte-exact.
function instrumentNumbers(text: string) {
  const normalized = text.normalize("NFKC").replace(/[*_`]/gu, "");
  return Array.from(
    normalized.matchAll(
      /(법률|대통령령|총리령|부령|헌법재판소규칙|대법원규칙|국회규칙|규칙|조례|고시|훈령|예규)\s*(?:(?:제\s*)?([0-9][0-9,]*)\s*호|(?:공포\s*)?번호\s*[:：]?\s*([0-9][0-9,]*))/gu,
    ),
    (match) =>
      `${match[1]}:${(match[2] ?? match[3] ?? "").replace(/,/gu, "").replace(/^0+(?=\d)/u, "")}`,
  );
}

/** Every generated instrument number needs its own cited excerpt, even if the
 * independent auditor approved the draft. IDs, dates, prior replies and other
 * uncited originals cannot establish a promulgation number. */
export function instrumentNumbersGrounded(
  draft: unknown,
  claims: readonly SourceClaim[],
  excerpts: readonly { citationId: string; text: string }[],
) {
  const supported = new Set<string>();
  for (const claim of claims) {
    const source = excerpts.find((text) => text.citationId === claim.citationId);
    if (!source || claim.startUtf16 < 0 || claim.endUtf16 > source.text.length) continue;
    const numbers = new Set(instrumentNumbers(source.text.slice(claim.startUtf16, claim.endUtf16)));
    for (const number of instrumentNumbers(claim.text)) {
      if (numbers.has(number)) supported.add(number);
    }
  }
  const check = (value: unknown): boolean => {
    if (typeof value === "string")
      return instrumentNumbers(value).every((number) => supported.has(number));
    if (Array.isArray(value)) return value.every(check);
    return !value || typeof value !== "object" || Object.values(value).every(check);
  };
  return check(draft);
}
