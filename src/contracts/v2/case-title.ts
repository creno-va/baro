import { displayText } from "../common";

export const caseTitleSchema = displayText(40).refine((value) => !/[\r\n]/.test(value));

/** Old cases remain readable without reprocessing their private narrative. */
export function caseDisplayTitle(narrative: string, generated?: string | null): string {
  const title = caseTitleSchema.safeParse(generated);
  if (title.success) return title.data;
  const text = narrative.normalize("NFC");
  if (/빌려|빌린|빌렸|대여금|차용|대여/.test(text))
    return /빌린|빌렸|차용했/.test(text) ? "빌린 돈과 상환 약속" : "빌려준 돈과 반환 약속";
  if (/보증금/.test(text)) return "임대차 보증금과 반환 문제";
  if (/임대|임차|전세|월세/.test(text)) return "임대차 계약과 이용 문제";
  if (/퇴직금/.test(text)) return "퇴직금 지급 문제";
  if (/해고|권고사직/.test(text)) return "퇴사 경위와 근로관계";
  if (/임금|급여|월급/.test(text)) return "임금 지급과 근로관계";
  if (/교통사고|차량 사고|접촉사고/.test(text)) return "교통사고 경위와 피해 정리";
  if (/폭행|상해/.test(text)) return "폭행 관련 사건 경위";
  if (/명예훼손|모욕|악성.*게시글/.test(text)) return "게시글과 발언으로 인한 피해 문제";
  if (/사기|기망/.test(text)) return "거래 경위와 피해 확인";
  if (/상속|유산/.test(text)) return "상속 재산과 가족 간 협의";
  if (/이혼|양육|친권/.test(text)) return "가족관계와 양육 문제";
  if (/계약|납품|용역|대금/.test(text)) return "계약 내용과 이행 문제";
  return "사건 경위와 확인할 내용";
}
