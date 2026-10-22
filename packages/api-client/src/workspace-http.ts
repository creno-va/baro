import { ApiError } from "./errors";

/** Shared transport returns a Response for both mock and same-origin real requests. */
export type WorkspaceTransport = (path: string, init?: RequestInit) => Promise<Response>;
export function workspaceError(code: ApiError["code"], message: string, retryable = false) {
  return new ApiError(code, message, retryable);
}
export async function workspaceResponse(response: Response) {
  if (!response.ok) {
    const value = (await response.json().catch(() => null)) as {
      error?: { code?: string; retryable?: boolean };
    } | null;
    const wireCode = value?.error?.code;
    const code =
      response.status === 401
        ? "UNAUTHENTICATED"
        : wireCode === "CONSENT_REQUIRED"
          ? "CONSENT_REQUIRED"
          : response.status === 404 || wireCode === "ROLE_REQUIRED"
            ? "NOT_FOUND"
            : response.status === 409
              ? "CONFLICT"
              : response.status === 429
                ? "QUOTA_EXCEEDED"
                : response.status === 400 && wireCode === "FILE_REJECTED"
                  ? "FILE_REJECTED"
                  : response.status === 400 || response.status === 413
                    ? "VALIDATION_ERROR"
                    : "UNAVAILABLE";
    const messages: Record<string, string> = {
      UNAUTHENTICATED: "로그인한 뒤 사건을 이어서 확인해 주세요.",
      CONSENT_REQUIRED: "최신 동의 내용을 확인해 주세요.",
      NOT_FOUND: "사건 또는 자료를 찾을 수 없어요.",
      CONFLICT: "다른 화면에서 내용이 바뀌었어요. 최신 내용을 확인해 주세요.",
      QUOTA_EXCEEDED: "사용 한도에 도달했어요. 저장된 내용은 보존됩니다.",
      VALIDATION_ERROR: "입력 또는 파일 형식·크기를 확인해 주세요.",
      FILE_REJECTED:
        "파일 형식과 내용을 확인해 주세요. 암호·보호를 해제하거나 지원하는 형식으로 저장한 뒤 다시 추가해 주세요.",
      UNAVAILABLE: "지금 요청을 처리할 수 없어요. 잠시 후 다시 시도해 주세요.",
    };
    throw workspaceError(
      code,
      messages[code] ?? "지금 요청을 처리할 수 없어요. 잠시 후 다시 시도해 주세요.",
      code !== "FILE_REJECTED" && (value?.error?.retryable === true || response.status >= 500),
    );
  }
  return response;
}

/** Mutation identities belong to one domain instance, never a module-global account cache. */
export function createWorkspaceOperations(newKey: () => string) {
  async function workspaceJson(
    request: WorkspaceTransport,
    path: string,
    init?: RequestInit,
  ): Promise<unknown> {
    const response = await workspaceResponse(await request(path, init));
    const key = new Headers(init?.headers).get("idempotency-key");
    const value = await response.json();
    if (key)
      for (const [signature, value] of signatures) if (value === key) signatures.delete(signature);
    return value;
  }
  const signatures = new Map<string, string>();
  function workspaceMutation(path: string, body: unknown, method = "POST"): RequestInit {
    const signature = JSON.stringify({ path, body, method });
    const key = signatures.get(signature) ?? newKey();
    signatures.set(signature, key);
    if (signatures.size > 100) signatures.delete(signatures.keys().next().value ?? "");
    return {
      method,
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(body),
    };
  }

  return { workspaceJson, workspaceMutation };
}
