import { expect, test } from "bun:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { NOW, syntheticDetail, syntheticList } from "../scripts/benchmarks/retrieval/harness";
import {
  inspectLegalV2,
  legalDiagnosticReceipt,
  legalReadinessScope,
  readinessV2Plans,
} from "../scripts/legal-readiness-v2";
import { workspaceGuidePlans } from "../src/server/modules/legal-retrieval/v2/workspace-plans";
import precedents from "./fixtures/legal/v2/precedents.json";
import { syntheticGeneralGuide } from "./helpers/synthetic-legal-guide";

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
      ? syntheticGeneralGuide
      : syntheticGeneralGuide.replace(/향후\s*업데이트\s*예정/g, "합성 검증 안내"),
  };
}
function transport(input: ReturnType<typeof responses>) {
  return async (value: string, init: RequestInit) => {
    const url = new URL(value),
      guide = url.hostname.includes("easylaw");
    expect(new Headers(init.headers).get("Referer")).toBe(guide ? null : "https://baro.site/");
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
    expect(receipt.requestObservations.map((request) => request.endpoint)).toEqual([
      "statute_list",
      "statute_detail",
      "precedent_list",
      "precedent_detail",
      "official_guide",
    ]);
    expect(receipt.requestObservations.every((request) => request.httpStatus === 200)).toBe(true);
    expect(receipt.runtimeWorker).toBe(false);
    expect(receipt.upstreamRejections).toEqual([]);
    expect(receipt.verifiedSourceCount).toBe(pending ? 2 : 3);
    expect(receipt.checkedClaimCount).toBe(pending ? 2 : 3);
    expect(receipt.claimIntegrity).toBe(true);
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
test("pending guide alone leaves claim integrity untested", async () => {
  const receipt = await inspectLegalV2({}, NOW, {
    transport: transport(responses(true)),
    plans: [workspaceGuidePlans.legal_consultation],
  });
  expect(receipt).toMatchObject({
    status: "failed",
    requests: 1,
    verifiedSourceCount: 0,
    checkedClaimCount: 0,
    claimIntegrity: null,
    outcomes: [{ kind: "official_guide", availability: "limited", reason: "update_pending" }],
  });
  expect(receipt.sources).toHaveLength(1);
});

test("core-source diagnostic verifies bounded originals without claiming full-source readiness", async () => {
  const selected = legalReadinessScope("core_sources");
  const payload = responses(true);
  payload.prec_list.PrecSearch.totalCnt = 200;
  const observed = await inspectLegalV2({ LAW_API_OC: "synthetic-private-only" }, NOW, {
    plans: selected.plans,
    transport: transport(payload),
  });
  expect(observed.status).toBe("failed");
  expect(observed.outcomes.map((o) => o.kind)).toEqual(["statute", "precedent"]);
  expect(observed.outcomes[1]).toMatchObject({
    availability: "verified",
    reason: null,
    searchTruncated: true,
  });
  expect(legalDiagnosticReceipt(observed)).toMatchObject({
    status: "diagnostic_passed",
    checkedClaimCount: 2,
    claimIntegrity: true,
    durationMs: expect.any(Number),
  });
  expect(
    observed.requestObservations.every((o) => Number.isInteger(o.durationMs) && o.durationMs >= 0),
  ).toBe(true);
});
test("unavailable sources leave claim integrity untested", async () => {
  const receipt = await inspectLegalV2({ LAW_API_OC: "synthetic-private-only" }, NOW, {
    transport: async () => new Response(null, { status: 403 }),
  });
  expect(receipt).toMatchObject({
    status: "failed",
    requests: 3,
    verifiedSourceCount: 0,
    checkedClaimCount: 0,
    claimIntegrity: null,
    sources: [],
  });
  expect(receipt.outcomes.every((outcome) => outcome.availability === "unavailable")).toBe(true);
  expect(receipt.requestObservations).toEqual(
    (["statute_list", "precedent_list", "official_guide"] as const).map((endpoint) => ({
      endpoint,
      httpStatus: 403,
      contentType: "missing",
      transport: "response",
      durationMs: expect.any(Number),
    })),
  );
});
test("readiness separates HTTP rejection from JSON error envelopes without retaining secrets", async () => {
  const privateValue = "synthetic-private-only";
  const receipt = await inspectLegalV2({ LAW_API_OC: privateValue }, NOW, {
    transport: async (url) =>
      new Response(JSON.stringify({ result: privateValue, msg: url }), {
        headers: { "content-type": "application/json; charset=utf-8", "x-private": privateValue },
      }),
    plans: readinessV2Plans.slice(0, 2),
  });
  expect(receipt.outcomes.every((outcome) => outcome.reason === "upstream_rejected")).toBe(true);
  expect(receipt.requestObservations).toEqual(
    (["statute_list", "precedent_list"] as const).map((endpoint) => ({
      endpoint,
      httpStatus: 200,
      contentType: "json",
      transport: "response",
      durationMs: expect.any(Number),
    })),
  );
  expect(receipt.claimIntegrity).toBeNull();
  const serialized = JSON.stringify(receipt);
  for (const excluded of [privateValue, "OC=", "lawSearch.do", "x-private", '"msg"'])
    expect(serialized).not.toContain(excluded);
});
test.each([
  [
    { result: "synthetic-private-code", msg: "유관기관 등록상태와 아이피 synthetic-private-oc" },
    "upstream-registration-rejected",
  ],
  [
    { result: "synthetic-private-code", msg: "API 인증키 OC를 확인 synthetic-private-oc" },
    "upstream-credential-rejected",
  ],
  [
    { result: "synthetic-private-code", msg: "알 수 없는 오류 synthetic-private-oc" },
    "upstream-error",
  ],
  [{ result: "synthetic-private-code" }, "upstream-error"],
  [{ msg: "API 인증키 OC를 확인 synthetic-private-oc" }, "upstream-error"],
] as const)("readiness retains only finite upstream categories: %j", async (envelope, category) => {
  const receipt = await inspectLegalV2({ LAW_API_OC: "synthetic-private-oc" }, NOW, {
    transport: async () => Response.json(envelope),
    plans: readinessV2Plans.slice(0, 2),
  });
  expect(receipt.upstreamRejections).toEqual([
    { endpointId: "moleg_eflaw_list", category },
    { endpointId: "moleg_prec_list", category },
  ]);
  expect(receipt.requests).toBe(2);
  expect(receipt.reservations).toBe(2);
  expect(receipt.status).toBe("failed");
  expect(receipt.outcomes.every((outcome) => outcome.reason === "upstream_rejected")).toBe(true);
  const serialized = JSON.stringify(receipt);
  for (const excluded of ["synthetic-private", '"msg"', '"result"', "OC=", "lawSearch.do"])
    expect(serialized).not.toContain(excluded);
});
test("readiness preserves transport failures and does not record exception or unexpected header text", async () => {
  let calls = 0;
  const privateValue = "synthetic-private-transport";
  const receipt = await inspectLegalV2({ LAW_API_OC: privateValue }, NOW, {
    transport: async () => {
      if (++calls === 1) throw new Error(privateValue);
      return new Response(privateValue, {
        status: 403,
        headers: { "content-type": `private/${privateValue}` },
      });
    },
    plans: readinessV2Plans.slice(0, 1),
  });
  expect(receipt.requests).toBe(2);
  expect(receipt.requestObservations).toEqual([
    {
      endpoint: "statute_list",
      httpStatus: null,
      contentType: null,
      transport: "failed",
      durationMs: expect.any(Number),
    },
    {
      endpoint: "statute_list",
      httpStatus: 403,
      contentType: "other",
      transport: "response",
      durationMs: expect.any(Number),
    },
  ]);
  expect(JSON.stringify(receipt)).not.toContain(privateValue);
});
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
      verifiedSourceCount: 3,
      checkedClaimCount: 3,
      claimIntegrity: true,
    });
  } finally {
    await mf.dispose();
  }
}, 30000);
