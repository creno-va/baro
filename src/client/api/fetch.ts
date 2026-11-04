/** Metadata and job admission must not hold a UI poll forever on a broken
 * connection. Aborting the HTTP read does not cancel an admitted server job.
 * Binary transfers, synchronous report generation/saving and native processing retain
 * their longer technical limit. */
export function apiFetch(path: string, init: RequestInit = {}) {
  const transfer =
    /\/(original|pdf|zip|html)(?:\?|$)|\/parts\/\d+(?:\?|$)|\/complete(?:\?|$)|\/content(?:\?|$)/.test(
      path,
    );
  const reportWrite =
    ["POST", "PATCH"].includes(init.method?.toUpperCase() ?? "GET") &&
    /^\/api\/v2\/cases\/[^/?]+\/reports(?:\?|$)/.test(path);
  const deadline = AbortSignal.timeout(transfer || reportWrite ? 300_000 : 30_000);
  return fetch(path, {
    ...init,
    credentials: "same-origin",
    signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
  });
}
