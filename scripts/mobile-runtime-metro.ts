import { createHash } from "node:crypto";
import { z } from "zod";

export const metroHttpProofSchema = z.strictObject({
  kind: z.literal("metro-http-response-only"),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  appExecutionVerified: z.literal(false),
});
export function localMetroBundleUrl(value: unknown, platform: "ios" | "android") {
  if (typeof value !== "string") throw new Error("RUNTIME_METRO_LOCAL_BUNDLE_REQUIRED");
  const url = new URL(value);
  if (
    url.origin !== "http://127.0.0.1:8081" ||
    url.username ||
    url.password ||
    url.hash ||
    !url.pathname.endsWith(".bundle") ||
    url.searchParams.get("platform") !== platform
  )
    throw new Error("RUNTIME_METRO_LOCAL_BUNDLE_REQUIRED");
  return url.toString();
}
async function boundedBody(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("RUNTIME_METRO_BODY_REQUIRED");
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error("RUNTIME_METRO_BODY_LIMIT");
      }
      parts.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts, bytes);
}
/** Checks generated HTTP bytes only; it never executes JS or claims an app mount. */
export async function preflightMetroBundle(
  platform: "ios" | "android",
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
) {
  const manifest = await fetcher("http://127.0.0.1:8081/", {
    headers: { accept: "application/expo+json", "expo-platform": platform },
    redirect: "error",
    signal: AbortSignal.timeout(180000),
  });
  if (
    !manifest.ok ||
    !/^application\/(?:expo\+)?json\b/i.test(manifest.headers.get("content-type") ?? "")
  )
    throw new Error("RUNTIME_METRO_MANIFEST_HTTP_FAILED");
  const data = z
    .object({ launchAsset: z.object({ url: z.string() }) })
    .parse(JSON.parse((await boundedBody(manifest, 262144)).toString("utf8")));
  const url = localMetroBundleUrl(data.launchAsset.url, platform),
    response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(180000) });
  if (
    !response.ok ||
    !/^(?:application|text)\/(?:javascript|x-javascript)\b/i.test(
      response.headers.get("content-type") ?? "",
    )
  )
    throw new Error("RUNTIME_METRO_BUNDLE_HTTP_FAILED");
  const body = await boundedBody(response, 67108864);
  return metroHttpProofSchema.parse({
    kind: "metro-http-response-only",
    bytes: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
    appExecutionVerified: false,
  });
}
