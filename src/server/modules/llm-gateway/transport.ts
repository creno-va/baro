import { rememberDependencyFailure } from "../../dependency-diagnostics";

async function boundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximumBytes) throw new Error("GATEWAY_RESPONSE_TOO_LARGE");
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Read the status from this response, never the shared AI binding's last request.
 * Cloudflare's default InferenceUpstreamError discards the HTTP status. Internal
 * numeric error codes in its message are not HTTP codes and must not drive retries.
 */
export async function gatewayResponse(value: unknown): Promise<unknown> {
  // Synthetic adapters can still return the already-decoded completion.
  if (!(value instanceof Response)) return value;
  if (value.ok) return boundedJson(value, 1024 * 1024);
  const body = await boundedJson(value, 16 * 1024).catch(() => null);
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const nested = record.error ?? (Array.isArray(record.errors) ? record.errors[0] : null);
  const failure = Object.assign(new Error("GATEWAY_HTTP_ERROR"), { status: value.status });
  const retryAfter = value.headers.get("retry-after");
  if (retryAfter !== null && /^\d+(?:\.\d+)?$/.test(retryAfter))
    Object.assign(failure, { retryAfter: Math.min(30, Number(retryAfter)) });
  // Only a static category survives; never retain the provider body/message/SQL.
  rememberDependencyFailure(
    failure,
    nested && typeof nested === "object" ? nested : { message: record.description },
    value.status === 401 || value.status === 403
      ? "provider_auth"
      : value.status === 402
        ? "provider_budget"
        : value.status === 429
          ? "provider_rate"
          : value.status >= 500
            ? "provider_unavailable"
            : "provider_request",
  );
  throw failure;
}
