import {
  ApiError,
  type DomainRequest,
  responseError,
  type WorkspaceTransport,
} from "@baro/api-client";

const messages = {
  STALE_REVISION:
    "사건이나 리포트 버전이 바뀌었어요. 편집 내용을 확인한 뒤 저장 상태를 다시 불러와 주세요.",
  EDITS_REQUIRE_SAVE: "본문 편집을 먼저 저장한 뒤 자료 제외를 적용해 주세요.",
  EXPORT_RETRY_EXHAUSTED:
    "이 다운로드의 재시도 횟수를 모두 사용했어요. 검토 내용을 새 버전으로 저장한 뒤 다시 다운로드해 주세요.",
  EXPORT_LIMIT_EXCEEDED:
    "리포트 또는 다운로드의 처리 한도를 넘었어요. 제외할 자료나 ZIP 원본 선택을 확인해 주세요.",
  REVIEW_REQUIRED: "현재 사건 요약을 확인한 뒤 리포트를 만들어 주세요.",
  STORAGE_UNAVAILABLE: "파일을 준비하지 못했어요. 저장한 검토 내용은 보존돼요. 다시 시도해 주세요.",
  BUDGET_UNAVAILABLE:
    "파일 저장을 지금 시작할 수 없어요. 검토 내용은 보존돼요. 잠시 후 다시 확인해 주세요.",
  USER_QUOTA_EXCEEDED: "저장 공간이 부족해요. 보관한 자료나 사건을 확인해 주세요.",
  IDEMPOTENCY_CONFLICT: "다른 입력에 사용된 요청이에요. 최신 저장 상태를 확인해 주세요.",
  LEGAL_SOURCE_UNAVAILABLE:
    "리포트에 쓰인 공식 출처를 현재 검증할 수 없어요. 출처를 확인한 뒤 새 버전을 만들어 주세요.",
} as const;
export type ReportFailureReason = keyof typeof messages;
export class ReportFailure extends ApiError {
  constructor(public readonly reason: ReportFailureReason) {
    super(
      reason === "STALE_REVISION" ||
        reason === "IDEMPOTENCY_CONFLICT" ||
        reason === "EXPORT_RETRY_EXHAUSTED"
        ? "CONFLICT"
        : reason === "USER_QUOTA_EXCEEDED"
          ? "QUOTA_EXCEEDED"
          : ["EDITS_REQUIRE_SAVE", "EXPORT_LIMIT_EXCEEDED", "REVIEW_REQUIRED"].includes(reason)
            ? "VALIDATION_ERROR"
            : "UNAVAILABLE",
      messages[reason],
      ["STORAGE_UNAVAILABLE", "BUDGET_UNAVAILABLE", "LEGAL_SOURCE_UNAVAILABLE"].includes(reason),
    );
  }
}
export async function checkReportResponse(response: Response) {
  if (response.ok) return;
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { error?: { code?: unknown } } | null;
  const code = body?.error?.code;
  if (typeof code === "string" && Object.hasOwn(messages, code))
    throw new ReportFailure(code as ReportFailureReason);
  throw await responseError(response);
}
export function createReportHttp(transport: WorkspaceTransport): DomainRequest {
  return async <T>(path: string, options = {}) => {
    const init = options as import("@baro/api-client").DomainRequestInit;
    let response: Response;
    try {
      response = await transport(path, {
        method: init.method ?? "GET",
        headers: { ...init.headers, "content-type": "application/json" },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        ...(init.signal ? { signal: init.signal } : {}),
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("UNAVAILABLE", "서버에 연결하지 못했어요. 다시 시도해 주세요.", true);
    }
    await checkReportResponse(response);
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError("UNAVAILABLE", "리포트 응답을 확인하지 못했어요.", true);
    }
  };
}
