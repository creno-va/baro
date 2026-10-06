import type { ApiErrorView } from "./types";
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
