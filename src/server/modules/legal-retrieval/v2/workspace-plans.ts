import { z } from "zod";
import { planSchema, type RetrievalPlan } from "./contracts";

// Observed existing registry page only. Models select keys, never document IDs/URLs.
export const workspaceGuidePlans = {
  legal_consultation: {
    kind: "official_guide",
    institutionId: "moleg_easylaw",
    endpointId: "easylaw_text_section",
    csmSeq: "734",
    ccfNo: "3",
    cciNo: "1",
    cnpClsNo: "4",
  },
} as const satisfies Record<string, RetrievalPlan>;

// Public legal concepts only. A model cannot send a person's narrative to a law search endpoint.
export const publicLawTitles = [
  "민법",
  "형법",
  "민사소송법",
  "형사소송법",
  "행정소송법",
  "행정절차법",
  "상법",
  "근로기준법",
  "노동조합 및 노동관계조정법",
  "산업재해보상보험법",
  "고용보험법",
  "국세기본법",
  "소득세법",
  "부가가치세법",
  "법인세법",
  "지방세법",
  "가사소송법",
  "주택임대차보호법",
  "상가건물 임대차보호법",
  "부동산등기법",
  "개인정보 보호법",
  "저작권법",
  "특허법",
  "상표법",
  "소비자기본법",
  "전자상거래 등에서의 소비자보호에 관한 법률",
  "독점규제 및 공정거래에 관한 법률",
  "채무자 회생 및 파산에 관한 법률",
  "출입국관리법",
  "국제사법",
  "건축법",
  "국토의 계획 및 이용에 관한 법률",
  "보험업법",
  "의료법",
  "국가배상법",
  "학교폭력예방 및 대책에 관한 법률",
  "도로교통법",
  "가정폭력범죄의 처벌 등에 관한 특례법",
] as const;
export const publicLegalConcepts = [
  "계약",
  "손해배상",
  "임대차",
  "대여금",
  "부당이득",
  "소유권",
  "이혼",
  "상속",
  "양육",
  "임금",
  "해고",
  "산업재해",
  "조세",
  "행정처분",
  "형사절차",
  "명예훼손",
  "사기",
  "폭행",
  "지식재산",
  "저작권",
  "개인정보",
  "소비자",
  "회사",
  "공정거래",
  "회생",
  "파산",
  "국제거래",
  "출입국",
  "부동산",
  "건축",
  "보험",
  "의료",
  "학교폭력",
  "교통사고",
  "가정폭력",
] as const;
export const workspaceSourceRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("statute"),
    lawTitle: z.enum(publicLawTitles),
    articles: planSchema.options[0].shape.articles.refine(
      (rows) => rows.length <= 2,
      "At most two articles per workspace request",
    ),
  }),
  z.strictObject({ kind: z.literal("precedent"), concept: z.enum(publicLegalConcepts) }),
  z.strictObject({ kind: z.literal("official_guide"), guideKey: z.enum(["legal_consultation"]) }),
]);
export type WorkspaceSourceRequest = z.infer<typeof workspaceSourceRequestSchema>;
export function workspaceRetrievalPlans(raw: unknown): RetrievalPlan[] {
  return z
    .array(workspaceSourceRequestSchema)
    .max(2)
    .parse(raw)
    .map((plan) =>
      plan.kind === "official_guide"
        ? { ...workspaceGuidePlans[plan.guideKey] }
        : plan.kind === "precedent"
          ? { kind: "precedent", query: plan.concept, limit: 1 }
          : plan,
    );
}
export const isWorkspacePublicQuery = (value: string) =>
  publicLawTitles.some((title) => title === value) ||
  publicLegalConcepts.some((concept) => concept === value);
