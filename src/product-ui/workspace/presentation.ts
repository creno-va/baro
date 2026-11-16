import type { FileView } from "../../client/api/types";
export const tabLabels = {
  chat: "대화",
  files: "자료",
  timeline: "타임라인",
  actions: "다음 행동",
};
export const fileStatus: Record<FileView["status"], string> = {
  uploading: "업로드 중",
  processing: "처리 중",
  ready: "결과 확인 가능",
  failed: "처리 실패",
  waiting: "처리 대기",
};
export function size(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.ceil(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
