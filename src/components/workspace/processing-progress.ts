import type { FileUploadProgress, FileView } from "../../client/api/types";

export function elapsedLabel(startedAt: string | number, now: number): string | null {
  const start = typeof startedAt === "number" ? startedAt : Date.parse(startedAt);
  if (!Number.isFinite(start) || !Number.isFinite(now) || now < start) return null;
  const seconds = Math.floor((now - start) / 1000);
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 ${seconds % 60}초`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 ${minutes % 60}분`;
  return `${Math.floor(hours / 24)}일 ${hours % 24}시간`;
}

export function uploadProgressLabel(progress: FileUploadProgress): string {
  const labels = {
    checking_access: "계정과 업로드 권한 확인 중",
    hashing: "원본 파일 확인 중",
    preparing: "업로드 준비 중",
    uploading: "원본 파일 전송 중",
    checking: "서버에서 파일 형식과 저장 내용 확인 중",
    confirming: "접수 결과 확인 중",
  };
  return labels[progress.stage];
}

/** Public failure enums only; never show provider errors or assume the file is invalid. */
export function fileFailureLabel(file: Pick<FileView, "failure" | "canRetry">): string {
  if (file.failure === "UPLOAD_EXPIRED")
    return "업로드 유효 시간이 지났어요. 자료를 삭제한 뒤 같은 원본을 다시 추가해 주세요.";
  if (file.failure === "FILE_REJECTED")
    return "지원하는 형식과 파일 내용을 확인한 뒤 원본을 다시 추가해 주세요.";
  const reason =
    file.failure === "JOB_TIMEOUT"
      ? "자료 처리가 제한 시간 안에 끝나지 않았어요."
      : "자료 처리를 완료하지 못했어요.";
  return file.canRetry
    ? `${reason} 저장된 원본으로 처리를 다시 시도할 수 있어요.`
    : `${reason} 자료 확인에서 원본을 확인하거나 자료를 삭제할 수 있어요.`;
}
