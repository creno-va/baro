import { type Access, MAX_RESPONSE_BYTES, RetrievalFailure, safePermit } from "./contracts";
import { assertOfficialUrl } from "./registry";

export type Transport = (url: string, init: RequestInit) => Promise<Response>;
export function createBoundedTransport(
  transport: Transport = fetch,
  options: { timeoutMs?: number; sleep?: (ms: number, signal: AbortSignal) => Promise<void> } = {},
) {
  if (
    options.timeoutMs !== undefined &&
    (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 30000)
  )
    throw new RetrievalFailure("schema_mismatch");
  return async (url: URL, endpointId: string, access: Access, guide = false): Promise<string> => {
    assertOfficialUrl(url.href, guide);
    const invocationId = crypto.randomUUID();
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (access.signal?.aborted) throw new RetrievalFailure("cancelled");
      if (!(await safePermit(access.authorize))) throw new RetrievalFailure("not_authorized");
      if (!(await safePermit(() => access.reserveRequest({ invocationId, attempt, endpointId }))))
        throw new RetrievalFailure("budget_exhausted");
      const controller = new AbortController();
      const externalAbort = () => controller.abort();
      access.signal?.addEventListener("abort", externalAbort, { once: true });
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
      let retry = false;
      try {
        if (access.signal?.aborted) throw new RetrievalFailure("cancelled");
        // Race even test/nonconforming transports; drain cancellation below is also bounded.
        const aborted = new Promise<never>((_, reject) =>
          controller.signal.addEventListener(
            "abort",
            () => reject(new RetrievalFailure(access.signal?.aborted ? "cancelled" : "timeout")),
            { once: true },
          ),
        );
        const response = await Promise.race([
          transport(url.href, {
            redirect: "error",
            signal: controller.signal,
            headers: { Accept: guide ? "text/html" : "application/json" },
          }),
          aborted,
        ]);
        const rejectBody = (reason: ConstructorParameters<typeof RetrievalFailure>[0]) => {
          // Cancellation itself can be a stalled producer promise. Do not await
          // it outside the request deadline or retain a retry response body.
          void response.body?.cancel().catch(() => {});
          return new RetrievalFailure(reason);
        };
        if (response.status === 429 || response.status >= 500) {
          retry = attempt < 3;
          throw rejectBody(response.status === 429 ? "rate_limited" : "upstream_unavailable");
        }
        if (!response.ok) throw rejectBody("upstream_rejected");
        if (response.redirected || (response.url && response.url !== url.href))
          throw rejectBody("unsafe_url");
        const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
        if (!(guide ? type === "text/html" : type === "application/json" || type === "text/json"))
          throw rejectBody("unsupported_format");
        const declared = response.headers.get("content-length");
        if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
          throw rejectBody("too_large");
        }
        if (!response.body) throw new RetrievalFailure("schema_mismatch");
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let text = "",
          bytes = 0;
        try {
          for (;;) {
            const item = await Promise.race([reader.read(), aborted]);
            if (item.done) break;
            bytes += item.value.byteLength;
            if (bytes > MAX_RESPONSE_BYTES) throw new RetrievalFailure("too_large");
            try {
              text += decoder.decode(item.value, { stream: true });
            } catch {
              throw new RetrievalFailure("schema_mismatch");
            }
          }
          try {
            text += decoder.decode();
          } catch {
            throw new RetrievalFailure("schema_mismatch");
          }
        } finally {
          void reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        if (declared && Number(declared) !== bytes) throw new RetrievalFailure("schema_mismatch");
        if (!(await safePermit(access.authorize))) throw new RetrievalFailure("not_authorized");
        return text;
      } catch (error) {
        if (access.signal?.aborted) throw new RetrievalFailure("cancelled");
        const failure =
          error instanceof RetrievalFailure
            ? error
            : new RetrievalFailure(controller.signal.aborted ? "timeout" : "upstream_unavailable");
        if (
          !(
            retry ||
            ((failure.reason === "timeout" || failure.reason === "upstream_unavailable") &&
              attempt < 3)
          )
        )
          throw failure;
      } finally {
        clearTimeout(timeout);
        access.signal?.removeEventListener("abort", externalAbort);
      }
      if (options.sleep) {
        try {
          await options.sleep(
            100 * 2 ** (attempt - 1),
            access.signal ?? new AbortController().signal,
          );
        } catch {
          throw new RetrievalFailure(access.signal?.aborted ? "cancelled" : "upstream_unavailable");
        }
      } else
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(done, 100 * 2 ** (attempt - 1));
          function done() {
            access.signal?.removeEventListener("abort", cancel);
            resolve();
          }
          function cancel() {
            clearTimeout(timer);
            reject(new RetrievalFailure("cancelled"));
          }
          access.signal?.addEventListener("abort", cancel, { once: true });
          if (access.signal?.aborted) cancel();
        });
    }
    throw new RetrievalFailure("upstream_unavailable");
  };
}
