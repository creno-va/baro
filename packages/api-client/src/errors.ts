import type { ApiErrorView } from "@baro/client-core";
export class ApiError extends Error implements ApiErrorView {
  constructor(
    public code: ApiErrorView["code"],
    message: string,
    public retryable = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "요청을 완료하지 못했어요. 다시 시도해 주세요.";
}

export async function responseError(response: Response): Promise<ApiError> {
  const statusCodes = {
    401: "UNAUTHENTICATED",
    404: "NOT_FOUND",
    409: "CONFLICT",
    429: "QUOTA_EXCEEDED",
  } as const;
  const serverCodes = {
    UNAUTHENTICATED: "UNAUTHENTICATED",
    CONSENT_REQUIRED: "CONSENT_REQUIRED",
    ROLE_REQUIRED: "NOT_FOUND",
    NOT_FOUND: "NOT_FOUND",
    CONFLICT: "CONFLICT",
    REVISION_CONFLICT: "CONFLICT",
    QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
    RATE_LIMITED: "QUOTA_EXCEEDED",
    TURNSTILE_FAILED: "VALIDATION_ERROR",
    VALIDATION_ERROR: "VALIDATION_ERROR",
    BUDGET_UNAVAILABLE: "UNAVAILABLE",
    UNAVAILABLE: "UNAVAILABLE",
  } as const;
  let raw: string | undefined;
  try {
    const body = (await response.json()) as { error?: { code?: unknown }; code?: unknown };
    const candidate = body.error?.code ?? body.code;
    if (typeof candidate === "string") raw = candidate;
  } catch {
    /* Untrusted or non-JSON errors use a safe status fallback. */
  }
  const code =
    serverCodes[raw as keyof typeof serverCodes] ??
    statusCodes[response.status as keyof typeof statusCodes] ??
    (response.status >= 500 ? "UNAVAILABLE" : "VALIDATION_ERROR");
  const messages = {
    UNAUTHENTICATED: "로그인이 필요해요.",
    CONSENT_REQUIRED: "필수 동의를 확인해 주세요.",
    NOT_FOUND:
      raw === "ROLE_REQUIRED"
        ? "이용 유형이 변경됐어요. 로그인 화면에서 이용 유형을 확인해 주세요."
        : "요청한 내용을 찾지 못했어요.",
    CONFLICT: "내용이 변경됐어요. 다시 불러온 뒤 저장해 주세요.",
    QUOTA_EXCEEDED: "이용 한도에 도달했어요. 잠시 후 다시 시도해 주세요.",
    VALIDATION_ERROR:
      raw === "TURNSTILE_FAILED"
        ? "보안 확인을 다시 진행해 주세요."
        : "입력한 내용을 확인해 주세요.",
    UNAVAILABLE:
      raw === "BUDGET_UNAVAILABLE"
        ? "AI 처리를 지금 시작할 수 없어요. 저장한 내용은 보존돼요."
        : "요청을 완료하지 못했어요. 다시 시도해 주세요.",
  };
  return new ApiError(code, messages[code], code === "UNAVAILABLE" || code === "QUOTA_EXCEEDED");
}
