import { LAW_API_REFERER } from "../request-headers";
import {
  type Access,
  type FailureReason,
  MAX_RESPONSE_BYTES,
  RetrievalFailure,
  safePermit,
} from "./contracts";
import { assertOfficialUrl } from "./registry";

export type Transport = (url: string, init: RequestInit) => Promise<Response>;
export type LegalRequestObservation = {
  endpointId: string;
  attempt: number;
  durationMs: number;
  httpStatus: number | null;
  reason: FailureReason | null;
};
function retryAfter(value: string | null) {
  if (!value || value.length > 128) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}
export function createBoundedTransport(
  transport: Transport = fetch,
  options: {
    timeoutMs?: number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    observeRequest?: (value: LegalRequestObservation) => void | Promise<void>;
  } = {},
) {
  if (
    options.timeoutMs !== undefined &&
    (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 30000)
  )
    throw new RetrievalFailure("schema_mismatch");
  return async (url: URL, endpointId: string, access: Access, guide = false): Promise<string> => {
    assertOfficialUrl(url.href, guide);
    const invocationId = crypto.randomUUID();
    const attemptTimeout = options.timeoutMs ?? 10000;
    // Keep the existing three attempt timeouts plus 100/200ms backoff ceiling.
    // Provider-directed waits consume this same budget, never extend it.
    const deadline = performance.now() + attemptTimeout * 3 + 300;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (access.signal?.aborted) throw new RetrievalFailure("cancelled");
      if (performance.now() >= deadline) throw new RetrievalFailure("timeout");
      if (!(await safePermit(access.authorize))) throw new RetrievalFailure("not_authorized");
      if (!(await safePermit(() => access.reserveRequest({ invocationId, attempt, endpointId }))))
        throw new RetrievalFailure("budget_exhausted");
      // Reservation can yield to revocation/deletion. The final authorization
      // must follow that await so private query disclosure never precedes it.
      if (access.signal?.aborted) throw new RetrievalFailure("cancelled");
      const finalAuthorized = await safePermit(access.authorize);
      if (access.signal?.aborted) throw new RetrievalFailure("cancelled");
      if (!finalAuthorized) throw new RetrievalFailure("not_authorized");
      if (performance.now() >= deadline) throw new RetrievalFailure("timeout");
      const controller = new AbortController();
      const externalAbort = () => controller.abort();
      access.signal?.addEventListener("abort", externalAbort, { once: true });
      const timeout = setTimeout(
        () => controller.abort(),
        Math.max(0, Math.min(attemptTimeout, deadline - performance.now())),
      );
      let retry = false;
      let retryAfterMs: number | null = null;
      let lastFailure: RetrievalFailure | undefined;
      let httpStatus: number | null = null;
      const started = performance.now();
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
            // Workers rejects redirect:"error" before sending the request.
            // Manual preserves the no-follow boundary; all 3xx fail below.
            redirect: "manual",
            signal: controller.signal,
            headers: guide
              ? { Accept: "text/html" }
              : { Accept: "application/json", Referer: LAW_API_REFERER },
          }),
          aborted,
        ]);
        httpStatus = response.status;
        const rejectBody = (reason: ConstructorParameters<typeof RetrievalFailure>[0]) => {
          // Cancellation itself can be a stalled producer promise. Do not await
          // it outside the request deadline or retain a retry response body.
          void response.body?.cancel().catch(() => {});
          return new RetrievalFailure(reason);
        };
        if (response.status === 429 || response.status >= 500) {
          retry = attempt < 3;
          retryAfterMs = retryAfter(response.headers.get("retry-after"));
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
        if (!response.body)
          throw new RetrievalFailure("schema_mismatch", {
            stage: "response_body",
            issues: [{ field: "body", expected: "nonempty_body" }],
          });
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
              throw new RetrievalFailure("schema_mismatch", {
                stage: "response_body",
                issues: [{ field: "encoding", expected: "utf8" }],
              });
            }
          }
          try {
            text += decoder.decode();
          } catch {
            throw new RetrievalFailure("schema_mismatch", {
              stage: "response_body",
              issues: [{ field: "encoding", expected: "utf8" }],
            });
          }
        } finally {
          void reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        if (declared && Number(declared) !== bytes)
          throw new RetrievalFailure("schema_mismatch", {
            stage: "response_body",
            issues: [{ field: "length", expected: "declared_bytes" }],
          });
        if (!(await safePermit(access.authorize))) throw new RetrievalFailure("not_authorized");
        if (controller.signal.aborted)
          throw new RetrievalFailure(access.signal?.aborted ? "cancelled" : "timeout");
        return text;
      } catch (error) {
        if (access.signal?.aborted) throw new RetrievalFailure("cancelled");
        const failure =
          error instanceof RetrievalFailure
            ? error
            : new RetrievalFailure(controller.signal.aborted ? "timeout" : "upstream_unavailable");
        lastFailure = failure;
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
        try {
          if (options.observeRequest)
            void Promise.resolve(
              options.observeRequest({
                endpointId,
                attempt,
                durationMs: Math.max(0, Math.round(performance.now() - started)),
                httpStatus,
                reason: access.signal?.aborted ? "cancelled" : (lastFailure?.reason ?? null),
              }),
            ).catch(() => undefined);
        } catch {
          /* Diagnostics never change results or retries. */
        }
      }
      const delay = Math.max(100 * 2 ** (attempt - 1), retryAfterMs ?? 0);
      const remaining = deadline - performance.now();
      if (delay >= remaining) throw lastFailure ?? new RetrievalFailure("timeout");
      if (options.sleep) {
        const waitController = new AbortController();
        const cancel = () => waitController.abort();
        access.signal?.addEventListener("abort", cancel, { once: true });
        const timer = setTimeout(cancel, Math.max(0, remaining));
        try {
          await Promise.race([
            options.sleep(delay, waitController.signal),
            new Promise<never>((_, reject) => {
              waitController.signal.addEventListener(
                "abort",
                () =>
                  reject(new RetrievalFailure(access.signal?.aborted ? "cancelled" : "timeout")),
                { once: true },
              );
              if (access.signal?.aborted) cancel();
              if (waitController.signal.aborted)
                reject(new RetrievalFailure(access.signal?.aborted ? "cancelled" : "timeout"));
            }),
          ]);
        } catch {
          throw new RetrievalFailure(
            access.signal?.aborted
              ? "cancelled"
              : waitController.signal.aborted
                ? "timeout"
                : "upstream_unavailable",
          );
        } finally {
          clearTimeout(timer);
          access.signal?.removeEventListener("abort", cancel);
        }
      } else
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(done, delay);
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
