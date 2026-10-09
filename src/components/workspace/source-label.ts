import type { TimelineView } from "../../client/api/types";
import type { V2FactReference, V2SourcePosition } from "../../contracts/v2";
export function positionLabel(position: V2SourcePosition): string {
  if (position.kind === "document")
    return `${position.page}쪽${position.paragraph ? ` · ${position.paragraph}번째 문단` : ""}${position.table ? ` · 표 ${position.table.index}, ${position.table.row}행 ${position.table.column}열` : ""}`;
  if (position.kind === "audio") return `${position.startSeconds}–${position.endSeconds}초`;
  if (position.kind === "video")
    return `${position.timestampSeconds}초 · 프레임 ${position.frameIndex}`;
  return position.region
    ? `이미지 영역 (${Math.round(position.region.x * 100)}%, ${Math.round(position.region.y * 100)}%)`
    : "이미지 전체";
}
export function referenceLabel(reference: V2FactReference): string {
  if (reference.kind === "intake_narrative") return "처음 입력한 이야기";
  if (reference.kind === "intake_answer") return "추가 질문에 대한 답변";
  if (reference.kind === "user_message") return "추가 대화의 사용자 진술";
  if (reference.kind === "official_source") return "검증한 공식 출처";
  return positionLabel(reference.position);
}
export function timelineDateLabel(entry: Pick<TimelineView, "date" | "datePrecision">): string {
  if (!entry.date || entry.datePrecision === "unknown") return "날짜 미상";
  if (entry.datePrecision === "year") return `${entry.date.slice(0, 4)}년 · 월·일 미상`;
  if (entry.datePrecision === "month")
    return `${entry.date.slice(0, 4)}년 ${entry.date.slice(5, 7)}월 · 일 미상`;
  return entry.date;
}
