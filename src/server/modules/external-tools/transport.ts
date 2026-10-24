/** Fixed server endpoints only. Never follow a redirect with credentials or emit
 * the request URL, query, response body or provider exception into diagnostics. */
export type LookupFetch = (url: URL, init: RequestInit) => Promise<Response>;
export async function lookupJson(
  network: LookupFetch,
  url: URL,
  body: unknown,
  headers: Record<string, string>,
  signal: AbortSignal,
) {
  const response = await network(url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(
      response.status === 401 || response.status === 403
        ? "LOOKUP_ACCESS_DENIED"
        : "LOOKUP_UNAVAILABLE",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("LOOKUP_UNAVAILABLE");
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 256 * 1024) throw new Error("LOOKUP_UNAVAILABLE");
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
