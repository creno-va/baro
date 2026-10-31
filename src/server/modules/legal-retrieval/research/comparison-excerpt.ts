import { researchExcerpt } from "./topics";

/** Keep one exact, bounded original span. Long appellate introductions often
 * contain abstract law or cited cases rather than this judgment's case facts.
 * Never splice distant passages or renumber original UTF-16 coordinates.
 */
export function comparisonExcerpt(body: string) {
  if (body.length <= 4000) return researchExcerpt(body, [], 4000);
  const reason = /(?:^|\n)\s*[【[]\s*이\s*유\s*[】\]]/.exec(body);
  const reasonStart = reason?.index ?? 0;
  const facts =
    /(?:^|\n)\s*(?:[【[]\s*)?(?:\d+[.)]\s*)?(?:[가-힣][.)]\s*)?(?:사안의\s*개요|사건의\s*개요|기초\s*사실|인정\s*사실|사실\s*관계)(?:\s|[:】\]\n]|$)/.exec(
      body.slice(reasonStart),
    );
  const offset = facts ? reasonStart + facts.index : reasonStart;
  const excerpt = researchExcerpt(body.slice(offset), [], 4000);
  return {
    ...excerpt,
    startUtf16: offset + excerpt.startUtf16,
    endUtf16: offset + excerpt.endUtf16,
    fullLengthUtf16: body.length,
    truncated: offset + excerpt.startUtf16 > 0 || offset + excerpt.endUtf16 < body.length,
  };
}
