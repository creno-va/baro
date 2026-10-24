import { z } from "zod";

export const APPLE_REVOCATION_TIMEOUT_MS = 10_000;
export const appleRevocationReasonSchema = z.enum([
  "revoked",
  "not_configured",
  "token_missing",
  "provider_error",
  "unexpected_response",
  "timeout",
]);
export type AppleRevocationResult = {
  status: "confirmed" | "unconfirmed";
  reason: z.infer<typeof appleRevocationReasonSchema>;
  httpStatus: number | null;
};
export type AppleCallbackMaterial = {
  subject: string;
  accessToken?: string;
  refreshToken?: string;
};
const opaque = z.string().min(1).max(16_384);
const credentialsSchema = z.object({
  APPLE_CLIENT_ID: z.string().min(1).max(512),
  APPLE_CLIENT_SECRET: opaque,
});
const failed = (
  reason: AppleRevocationResult["reason"],
  httpStatus: number | null = null,
): AppleRevocationResult => ({ status: "unconfirmed", reason, httpStatus });

/** Exactly one direct request. Provider credentials/material never leave the HTTPS form body. */
export async function revokeAppleAccess(
  environment: unknown,
  material: AppleCallbackMaterial | null,
  dependencies: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<AppleRevocationResult> {
  const credentials = credentialsSchema.safeParse(environment);
  if (!credentials.success) return failed("not_configured");
  const refresh = opaque.safeParse(material?.refreshToken),
    access = opaque.safeParse(material?.accessToken);
  if (!refresh.success && !access.success) return failed("token_missing");
  const timeout = dependencies.timeoutMs ?? APPLE_REVOCATION_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > APPLE_REVOCATION_TIMEOUT_MS)
    throw new Error("APPLE_REVOCATION_DEADLINE_INVALID");
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<AppleRevocationResult>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve(failed("timeout"));
    }, timeout);
  });
  const observe = async (): Promise<AppleRevocationResult> => {
    const response = await (dependencies.fetch ?? fetch)("https://appleid.apple.com/auth/revoke", {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      signal: controller.signal,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.data.APPLE_CLIENT_ID,
        client_secret: credentials.data.APPLE_CLIENT_SECRET,
        token: refresh.success ? refresh.data : access.success ? access.data : "",
        token_type_hint: refresh.success ? "refresh_token" : "access_token",
      }).toString(),
    });
    if (
      response.status !== 200 ||
      response.redirected ||
      (response.url && response.url !== "https://appleid.apple.com/auth/revoke")
    ) {
      await response.body?.cancel().catch(() => {});
      return failed(
        "provider_error",
        response.status >= 100 && response.status <= 599 ? response.status : null,
      );
    }
    if (!response.body) return { status: "confirmed", reason: "revoked", httpStatus: 200 };
    const reader = response.body.getReader();
    try {
      // Apple documents an empty successful body. Never parse/retain arbitrary provider JSON or HTML.
      for (let reads = 0; reads < 2; reads++) {
        const chunk = await reader.read();
        if (chunk.done) return { status: "confirmed", reason: "revoked", httpStatus: 200 };
        if (chunk.value.byteLength > 0) break;
      }
      await reader.cancel().catch(() => {});
      return failed("unexpected_response", 200);
    } finally {
      reader.releaseLock();
    }
  };
  try {
    return await Promise.race([
      observe().catch(() => failed(timedOut ? "timeout" : "provider_error")),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
