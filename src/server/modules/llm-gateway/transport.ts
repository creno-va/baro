import { rememberDependencyFailure } from "../../dependency-diagnostics";

export type GatewayRequestIssue =
  | "thinking_configuration"
  | "thinking_output_limit"
  | "unsupported_parameter"
  | "schema_constraint";
const requestIssues = new WeakMap<object, GatewayRequestIssue>();
export const gatewayRequestIssue = (error: unknown) =>
  error && typeof error === "object" ? requestIssues.get(error) : undefined;
function rememberRequestIssue(error: object, raw: unknown) {
  const message =
    raw && typeof raw === "object" && "message" in raw && typeof raw.message === "string"
      ? raw.message
      : "";
  const issue =
    /(?:thinking|reasoning).*(?:budget|token).*(?:exceed|less than|greater than|max.output|max_completion)|(?:max.output|max_completion).*(?:thinking|reasoning)/i.test(
      message,
    )
      ? "thinking_output_limit"
      : /reasoning_effort|thinking_level|thinkingBudget|thinking_config|thinking.*(?:unsupported|not supported)/i.test(
            message,
          )
        ? "thinking_configuration"
        : /(?:unsupported|unknown|unrecognized|not supported).*(?:parameter|field)|(?:parameter|field).*(?:unsupported|unknown|unrecognized|not supported)/i.test(
              message,
            )
          ? "unsupported_parameter"
          : /response_format|json.?schema|additionalProperties|anyOf|oneOf/i.test(message)
            ? "schema_constraint"
            : undefined;
  if (issue) requestIssues.set(error, issue);
}

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
  if (value.ok) {
    const body = await boundedJson(value, 1024 * 1024);
    if (body && typeof body === "object" && "success" in body) {
      const envelope = body as Record<string, unknown>;
      if (envelope.success === false) {
        const failure = new Error("GATEWAY_PROVIDER_ERROR");
        rememberRequestIssue(failure, Array.isArray(envelope.errors) ? envelope.errors[0] : null);
        rememberDependencyFailure(
          failure,
          Array.isArray(envelope.errors) ? envelope.errors[0] : null,
          "provider_request",
        );
        throw failure;
      }
      if (
        envelope.success === true &&
        envelope.result &&
        typeof envelope.result === "object" &&
        !Array.isArray(envelope.result) &&
        !("choices" in envelope) &&
        !("candidates" in envelope)
      )
        return envelope.result;
    }
    return body;
  }
  const body = await boundedJson(value, 16 * 1024).catch(() => null);
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const nested = record.error ?? (Array.isArray(record.errors) ? record.errors[0] : null);
  const failure = Object.assign(new Error("GATEWAY_HTTP_ERROR"), { status: value.status });
  rememberRequestIssue(failure, nested);
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
