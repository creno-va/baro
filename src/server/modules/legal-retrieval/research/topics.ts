import type { V2Summary } from "../../../../contracts/v2";
import type { V2PrecedentTopic } from "../../../../contracts/v2/precedent-research";
export const RESEARCH_CONCEPTS: Record<V2PrecedentTopic, string> = {
  contract: "계약",
  loan: "대여금",
  lease: "임대차",
  damages: "손해배상",
  wages: "임금",
  dismissal: "해고",
  industrial_accident: "산업재해",
  divorce: "이혼",
  inheritance: "상속",
  custody: "양육",
  fraud: "사기",
  defamation: "명예훼손",
  assault: "폭행",
  privacy: "개인정보",
  copyright: "저작권",
  consumer: "소비자",
  tax: "조세",
  administrative: "행정처분",
  property: "소유권",
  corporate: "회사",
  insolvency: "회생",
  traffic: "교통사고",
  medical: "의료",
  construction: "건축",
};
const aliases: Partial<Record<V2PrecedentTopic, RegExp>> = {
  loan: /대여금|차용|빌려|빌린|빌렸|빌려준|빌려주|돈을 빌/,
  lease: /임대차|임대인|임차인|보증금|전세|월세/,
  wages: /임금|급여|월급|퇴직금|체불/,
  damages: /손해배상|배상|손해/,
  dismissal: /해고|권고사직|부당해고/,
  industrial_accident: /산업재해|산재|작업 중|업무상 재해/,
  insolvency: /회생|파산|면책/,
  consumer: /환불|소비자|청약철회/,
  traffic: /교통사고|자동차 사고|접촉사고/,
  administrative: /행정처분|영업정지|처분 취소/,
};
/** Topic suggestions only: no merits, factual similarity or outcome judgment. */
export function recommendPrecedentTopics(summary: V2Summary): V2PrecedentTopic[] {
  const text = [
    summary.overview,
    ...summary.facts.filter((f) => f.attribution !== "official_source").map((f) => f.text),
  ].join("\n");
  return (Object.keys(RESEARCH_CONCEPTS) as V2PrecedentTopic[])
    .filter((topic) => aliases[topic]?.test(text) ?? text.includes(RESEARCH_CONCEPTS[topic]))
    .sort((a, b) => Number(a === "contract") - Number(b === "contract"))
    .slice(0, 4);
}

export function researchExcerpt(body: string, terms: string[], limit = 600) {
  const found = terms.map((term) => body.indexOf(term)).filter((index) => index >= 0);
  let start = found.length ? Math.max(0, Math.min(...found) - 100) : 0;
  if (start && /[\uDC00-\uDFFF]/.test(body[start] ?? "")) start--;
  let end = Math.min(body.length, start + limit);
  if (end < body.length && /[\uD800-\uDBFF]/.test(body[end - 1] ?? "")) end--;
  const text = body.slice(start, end);
  const leading = text.length - text.trimStart().length;
  const trailing = text.length - text.trimEnd().length;
  start += leading;
  end -= trailing;
  return {
    text: body.slice(start, end),
    startUtf16: start,
    endUtf16: end,
    fullLengthUtf16: body.length,
    truncated: start > 0 || end < body.length,
  };
}
