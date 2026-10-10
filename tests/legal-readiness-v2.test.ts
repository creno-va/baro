import { expect, test } from "bun:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { NOW, syntheticDetail, syntheticList } from "../scripts/benchmarks/retrieval/harness";
import { inspectLegalV2 } from "../scripts/legal-readiness-v2";
import capturedGuide from "./fixtures/legal/v2/captured-guide-structure.json";
import precedents from "./fixtures/legal/v2/precedents.json";

function responses(pending = false) {
  const eflaw_list = structuredClone(syntheticList),
    eflaw_detail = structuredClone(syntheticDetail);
  const law = eflaw_list.LawSearch.law[0];
  if (!law) throw new Error("Missing synthetic statute");
  law.법령명한글 = "민법";
  eflaw_detail.법령.기본정보.법령명_한글 = "민법";
  const list = precedents.find((p) => p.id === "precedent_list_candidate"),
    detail = precedents.find((p) => p.id === "precedent_verified");
  if (!list || !detail) throw new Error("Missing synthetic precedent");
  return {
    eflaw_list,
    eflaw_detail,
    prec_list: JSON.parse(list.response.body),
    prec_detail: { PrecService: JSON.parse(detail.response.body).판례정보 },
    guide: pending
      ? capturedGuide.body
      : capturedGuide.body.replace(/향후\s*업데이트\s*예정/g, "합성 검증 안내"),
  };
}
function transport(input: ReturnType<typeof responses>) {
  return async (value: string) => {
    const url = new URL(value),
      guide = url.hostname.includes("easylaw");
    const key = guide
      ? "guide"
      : `${url.searchParams.get("target")}_${url.pathname.endsWith("lawSearch.do") ? "list" : "detail"}`;
    const body = input[key as keyof typeof input];
    return new Response(guide ? String(body) : JSON.stringify(body), {
      headers: { "content-type": guide ? "text/html" : "application/json" },
    });
  };
}
test.each([false, true])(
  "v2 receipt covers all source kinds, with pending=%s preserved",
  async (pending) => {
    const receipt = await inspectLegalV2({ LAW_API_OC: "synthetic-private-only" }, NOW, {
      transport: transport(responses(pending)),
    });
    expect(receipt.status).toBe(pending ? "failed" : "passed");
    expect(receipt.requests).toBe(5);
    expect(receipt.runtimeWorker).toBe(false);
    expect(receipt.sources.map((source) => source.sourceType)).toEqual([
      "statute",
      "precedent",
      "official_guide",
    ]);
    expect(
      receipt.sources.every(
        (source) =>
          source.canonicalUrl.startsWith("https:") &&
          source.contentHash.length === 64 &&
          !!source.version,
      ),
    ).toBe(true);
    expect(JSON.stringify(receipt)).not.toContain("synthetic-private-only");
    expect(JSON.stringify(receipt)).not.toContain('"body"');
  },
);
test("v2 readiness executes product source/hash/claim checks in local workerd", async () => {
  const build = await Bun.build({
    entrypoints: ["tests/helpers/legal-readiness-worker.ts"],
    target: "browser",
    format: "esm",
  });
  expect(build.success).toBe(true);
  const output = build.outputs[0];
  if (!output) throw new Error("Missing worker bundle");
  const script = await output.text();
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script,
      compatibilityDate: "2026-10-01",
      cf: false,
      unsafeRegisterWorker: false,
    }),
  );
  try {
    // Direct local HTTP also works when Bun's fetch shim cannot honor Undici dispatchers.
    const response = await fetch(await mf.ready, {
      method: "POST",
      body: JSON.stringify({ now: NOW, responses: responses() }),
    });
    expect(await response.json()).toMatchObject({
      status: "passed",
      runtimeWorker: true,
      synthetic: true,
      requests: 5,
      claimIntegrity: true,
    });
  } finally {
    await mf.dispose();
  }
}, 30000);
