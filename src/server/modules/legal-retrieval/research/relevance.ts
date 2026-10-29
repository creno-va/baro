import type { V2Summary } from "../../../../contracts/v2";
import type { V2PrecedentTopic } from "../../../../contracts/v2/precedent-research";
import type { PrecedentCandidate } from "../v2/precedents";
import { RESEARCH_CONCEPTS } from "./topics";

// Reviewed public concepts, never arbitrary tokens extracted from a private case.
const topicPatterns: Partial<Record<V2PrecedentTopic, RegExp>> = {
  loan: /대여금|대여\s*금|차용금|차용증|금전소비대차/,
  contract: /계약|약정금|계약금|매매대금/,
  lease: /임대차|보증금|전세|차임|월세/,
  wages: /임금|급여|퇴직금|수당|체불/,
  dismissal: /해고|근로자지위|부당해고/,
  industrial_accident: /산업재해|산재|업무상\s*재해/,
  damages: /손해배상|배상금/,
  insolvency: /회생|파산|면책/,
  consumer: /소비자|환불|청약철회|물품대금/,
  construction: /공사대금|건축|건설|하자보수|건물철거/,
  property: /소유권|소유권이전|부동산인도/,
  traffic: /교통사고|자동차사고|구상금/,
};
const features = [
  /송금|계좌\s*이체|이체\s*내역|거래\s*내역/,
  /차용증|차용\s*계약|금전소비대차/,
  /변제기|상환|돌려받|갚지|반환\s*약속|미변제/,
  /구두|구술|문자|메시지|카카오톡|메신저/,
  /보증인|연대보증/,
  /임대차|전세|월세|보증금/,
  /계약\s*해제|계약\s*해지|계약\s*종료/,
  /임금|급여|퇴직금|체불/,
  /해고|근로자\s*지위/,
  /공사|건축|건설|하자/,
  /사고|상해|치료|진단/,
  /이혼|양육|상속/,
  /환불|청약철회|배송|물품/,
  /명예훼손|게시글|허위\s*사실/,
] as const;
const domains = [
  { title: /공사대금|건물철거|하자보수/, context: /공사|건축|건설|건물|하자/ },
  { title: /임대차|임차보증금|전세금/, context: /임대차|임대인|임차인|보증금|전세|월세/ },
  { title: /임금|퇴직금|근로자지위|해고/, context: /임금|퇴직금|근로|급여|해고|고용/ },
  { title: /이혼|양육|상속/, context: /이혼|양육|상속|배우자|가족/ },
  { title: /조세|법인세|소득세|부가가치세/, context: /조세|세금|법인세|소득세|부가가치세/ },
] as const;
const procedure = /소송비용|소송구조|결정\s*\(조서\)|재심청구|관할이송/;

/** Local discovery relevance only. Not a similarity percentage or legal judgment. */
export function createPrecedentRelevance(summary: V2Summary) {
  const caseText = [
    summary.overview,
    ...summary.facts
      .filter(
        (f) =>
          (f.attribution === "user_statement" || f.attribution === "user_material") &&
          f.certainty !== "uncertain" &&
          f.certainty !== "conflicting",
      )
      .map((f) => f.text),
  ].join("\n");
  const activeFeatures = features.filter((pattern) => pattern.test(caseText));
  const matches = (topic: V2PrecedentTopic, text: string) =>
    topicPatterns[topic]?.test(text) ?? text.includes(RESEARCH_CONCEPTS[topic]);
  const score = (title: string, body: string, topics: readonly V2PrecedentTopic[]) => {
    // Later citations in appellate judgments must not dominate the main dispute.
    const mainText = body.slice(0, 12000);
    const topicScore = Math.max(
      0,
      ...topics.map((topic) => (matches(topic, title) ? 24 : matches(topic, mainText) ? 5 : 0)),
    );
    const shared = activeFeatures.reduce(
      (sum, pattern) => sum + (pattern.test(title) ? 6 : pattern.test(mainText) ? 3 : 0),
      0,
    );
    const otherDomain = domains.reduce(
      (sum, domain) => sum + (domain.title.test(title) && !domain.context.test(caseText) ? 16 : 0),
      0,
    );
    const titleRelevant = topics.some((topic) => matches(topic, title));
    return {
      score:
        topicScore +
        shared -
        otherDomain -
        (procedure.test(title) && !procedure.test(caseText) ? 18 : 0),
      relevant: topicScore > 0 && (otherDomain === 0 || titleRelevant),
    };
  };
  return {
    score,
    candidates(rows: readonly PrecedentCandidate[], query: string) {
      const topic = (Object.keys(RESEARCH_CONCEPTS) as V2PrecedentTopic[]).find(
        (topic) => RESEARCH_CONCEPTS[topic] === query,
      );
      return [...rows]
        .sort((a, b) => {
          const relevance = (row: PrecedentCandidate) =>
            score(row.사건명, "", topic ? [topic] : []).score;
          return (
            relevance(b) - relevance(a) ||
            b.선고일자.localeCompare(a.선고일자) ||
            a.판례일련번호.localeCompare(b.판례일련번호)
          );
        })
        .map((row) => row.판례일련번호);
    },
  };
}
