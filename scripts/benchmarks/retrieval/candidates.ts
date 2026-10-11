import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createV2LegalRetrieval } from "../../../src/server/modules/legal-retrieval/v2/service";

export const variants = ["baseline", "list-dedup", "json-reuse", "concurrency-2"] as const;
export type Variant = (typeof variants)[number];
export type ParseCounters = { jsonParses: number; jsonReuseHits: number; articleParses: number };
export type Factory = (
  env: Parameters<typeof createV2LegalRetrieval>[0],
  repo: Parameters<typeof createV2LegalRetrieval>[1],
  options: Parameters<typeof createV2LegalRetrieval>[2] & { benchmarkCounters: ParseCounters },
) => ReturnType<typeof createV2LegalRetrieval>;
const sourcePath = "src/server/modules/legal-retrieval/v2/service.ts";
function replace(source: string, before: string, after: string) {
  if (source.split(before).length !== 2) throw new Error("Benchmark source anchor changed");
  return source.replace(before, after);
}
export function candidateSource(source: string, variant: Variant): string {
  if (variant === "baseline") return source;
  if (variant === "list-dedup") {
    const start = source.indexOf("            const candidate = selectStatute(");
    const end = source.indexOf("            for (const article of plan.articles) {", start);
    if (start < 0 || end < 0) throw new Error("Benchmark statute candidate anchor changed");
    const block = source.slice(start, end);
    source = replace(source, block, "            const candidate = await selectedStatute(plan);\n");
    return replace(
      source,
      "      for (const plan of body.plans) {",
      `      // Verified statute candidates are scoped to this invocation's fixed dates.
      // Failures are never memoized; fresh cache discovery/hash checks still run.
      const candidates = new Map<string, ReturnType<typeof selectStatute>>();
      async function selectedStatute(plan: Extract<(typeof body.plans)[number], { kind: "statute" }>) {
        const url = lawUrl("lawSearch.do", "eflaw", {
          query: plan.lawTitle,
          ...(plan.lawId ? { LID: plan.lawId } : {}),
          nw: "1,3", sort: "efdes", display: "100", page: "1",
          efYd: "00010101~" + body.asOfDate.replaceAll("-", ""),
        });
        const key = url.href;
        const cached = candidates.get(key);
        if (cached) {
          if (access.signal?.aborted) throw new RetrievalFailure("cancelled");
          if (!(await safePermit(access.authorize))) throw new RetrievalFailure("not_authorized");
          if (access.signal?.aborted) throw new RetrievalFailure("cancelled");
          return cached;
        }
        const candidate = selectStatute(
          await json(url, "moleg_eflaw_list", boundedAccess), plan, body.asOfDate,
        );
        candidates.set(key, candidate);
        return candidate;
      }
      for (const plan of body.plans) {`,
    );
  }
  if (variant === "json-reuse") {
    source = replace(
      source,
      "async function json(url: URL, endpointId: string, access: Access)",
      "async function json(url: URL, endpointId: string, access: Access, decode = JSON.parse)",
    );
    source = replace(source, "value = JSON.parse(raw);", "value = decode(raw);");
    source = replace(
      source,
      "      for (const plan of body.plans) {",
      `      // Research only: exact raw JSON reuse, capped at 2 MiB per invocation.
      const values = new Map<string, unknown>();
      let memoBytes = 0;
      function decode(raw: string) {
        if (values.has(raw)) return values.get(raw);
        const value: unknown = JSON.parse(raw);
        const bytes = new TextEncoder().encode(raw).byteLength;
        if (memoBytes + bytes <= MAX_RESPONSE_BYTES) {
          values.set(raw, value);
          memoBytes += bytes;
        }
        return value;
      }
      async function requestJson(url: URL, endpointId: string, currentAccess: Access) {
        return json(url, endpointId, currentAccess, decode);
      }
      for (const plan of body.plans) {`,
    );
    return source.replaceAll("await json(\n", "await requestJson(\n");
  }
  const start = source.indexOf("            for (const article of plan.articles) {");
  const end = source.indexOf('          } else if (plan.kind === "precedent") {', start);
  if (start < 0 || end < 0) throw new Error("Benchmark article loop changed");
  const block = source.slice(start, end);
  const worker = block
    .replace(
      "            for (const article of plan.articles) {",
      "            const resolveArticle = async (article: (typeof plan.articles)[number]) => {",
    )
    .replace("if (cached) chunks.push(cached);", "if (cached) return cached;")
    .replace(
      "                chunks.push(\n                  await parseStatute(",
      "                return await parseStatute(",
    )
    .replace(
      "                  ),\n                );\n            }",
      "                  );\n            };",
    );
  if (worker === block || worker.includes("chunks.push"))
    throw new Error("Benchmark worker anchor changed");
  return (
    source.slice(0, start) +
    worker +
    `            // All workers settle before outcome/final authorization is released.
            for (let i = 0; i < plan.articles.length; i += 2) {
              const resolved = await Promise.allSettled(plan.articles.slice(i, i + 2).map(resolveArticle));
              for (const item of resolved) {
                if (item.status === "rejected") throw item.reason;
                chunks.push(item.value);
              }
            }
` +
    source.slice(end)
  );
}
export async function loadFactory(variant: Variant): Promise<Factory> {
  let source = candidateSource(await Bun.file(sourcePath).text(), variant);
  source = replace(
    source,
    "    bindCitation: (citation: V2OfficialCitation) => Promise<boolean>;",
    "    bindCitation: (citation: V2OfficialCitation) => Promise<boolean>;\n    benchmarkCounters: { jsonParses: number; jsonReuseHits: number; articleParses: number };",
  );
  source = source.replaceAll(
    "JSON.parse(raw)",
    "(options.benchmarkCounters.jsonParses++, JSON.parse(raw))",
  );
  source = source.replace(
    "if (values.has(raw)) return values.get(raw);",
    "if (values.has(raw)) { options.benchmarkCounters.jsonReuseHits++; return values.get(raw); }",
  );
  // Default decoder needs the same count as the request-local decoder.
  source = source.replace(
    "decode = JSON.parse",
    "decode = (raw: string) => (options.benchmarkCounters.jsonParses++, JSON.parse(raw))",
  );
  source = replace(
    source,
    "  return {\n    async retrieve",
    `  const measuredParseStatute = (...args: Parameters<typeof parseStatute>) => {
    options.benchmarkCounters.articleParses++;
    return parseStatute(...args);
  };
  return {
    async retrieve`,
  );
  source = source.replaceAll("await parseStatute(", "await measuredParseStatute(");
  const moduleDir = resolve("src/server/modules/legal-retrieval/v2");
  source = source.replace(
    /from "(\.[^"]+)"/g,
    (_, path: string) => `from ${JSON.stringify(pathToFileURL(resolve(moduleDir, path)).href)}`,
  );
  const dir = resolve(".wrangler/retrieval-benchmark");
  await mkdir(dir, { recursive: true });
  const path = `${dir}/${variant}.ts`;
  await Bun.write(path, source);
  const module = await import(pathToFileURL(path).href);
  return module.createV2LegalRetrieval as Factory;
}
