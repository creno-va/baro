import { expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { NOW, syntheticDetail, syntheticList } from "../scripts/benchmarks/retrieval/harness";
import {
  inspectLegalV2,
  legalDiagnosticReceipt,
  legalReadinessScope,
} from "../scripts/legal-readiness-v2";
import { reportLegalRetrieval } from "../src/server/dependency-diagnostics";
import {
  legalSchemaDiagnostic,
  safeLegalSchemaDiagnostic,
} from "../src/server/modules/legal-retrieval/v2/schema-diagnostics";
import {
  safeWorkspaceAuditFailure,
  type WorkspaceAuditFailure,
} from "../src/server/modules/workspace/audit-diagnostics";

type DiagnosticList = {
  LawSearch: { totalCnt: unknown; law: (typeof syntheticList)["LawSearch"]["law"] };
};
type DiagnosticDetail = {
  법령: {
    기본정보: (typeof syntheticDetail)["법령"]["기본정보"];
    조문: { 조문단위: Record<string, unknown>[] };
  };
};

async function probe(
  change: (list: DiagnosticList, detail: DiagnosticDetail) => void,
  invalidJson = false,
) {
  const list: DiagnosticList = structuredClone(syntheticList),
    detail: DiagnosticDetail = structuredClone(syntheticDetail);
  const candidate = list.LawSearch.law[0];
  if (!candidate) throw new Error("Missing synthetic candidate");
  candidate.법령명한글 = "민법";
  detail.법령.기본정보.법령명_한글 = "민법";
  change(list, detail);
  let calls = 0;
  const plan = legalReadinessScope().plans[0];
  if (!plan) throw new Error("Missing synthetic plan");
  const result = await inspectLegalV2({ LAW_API_OC: "synthetic-private-credential" }, NOW, {
    plans: [plan],
    transport: async (url) => {
      calls++;
      return new Response(
        invalidJson
          ? "private response with invalid JSON"
          : JSON.stringify(new URL(url).pathname.endsWith("lawSearch.do") ? list : detail),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  expect(JSON.stringify(result)).not.toMatch(
    /synthetic-private-credential|private response|조문시행일자|stack|issues.*path/u,
  );
  return { result, calls };
}

test("unrelated heading without an article date reproduces rejection with only fixed detail evidence", async () => {
  const { result, calls } = await probe((_list, detail) => {
    detail.법령.조문.조문단위.unshift({
      조문번호: "0",
      조문여부: "전문",
      조문내용: "합성 장 제목",
    });
  });
  expect(calls).toBe(2);
  expect(result.outcomes[0]).toMatchObject({
    kind: "statute",
    availability: "unavailable",
    reason: "schema_mismatch",
    schemaFailure: {
      stage: "statute_detail",
      issues: expect.arrayContaining([{ field: "article_effective_date", expected: "date" }]),
    },
  });
  expect(result.verifiedSourceCount).toBe(0);
});

test("missing selected article date remains rejected and successful structure remains verified", async () => {
  const missing = await probe((_list, detail) => {
    const article = detail.법령.조문.조문단위[0];
    if (!article) throw new Error("Missing synthetic article");
    delete article.조문시행일자;
  });
  expect(missing.result.outcomes[0]?.schemaFailure?.issues).toContainEqual({
    field: "article_effective_date",
    expected: "date",
  });
  expect(missing.result.outcomes[0]?.availability).toBe("unavailable");
  const valid = await probe(() => {});
  expect(valid.calls).toBe(2);
  expect(valid.result.outcomes[0]).toEqual({
    kind: "statute",
    availability: "verified",
    reason: null,
  });
  expect(valid.result.claimIntegrity).toBe(true);
  const receipt = legalDiagnosticReceipt(valid.result);
  expect(receipt.status).toBe("diagnostic_passed");
  expect(receipt).not.toHaveProperty("sources");
  expect(JSON.stringify(receipt)).not.toMatch(/https?:|1706|284415|contentHash/u);
  expect(legalDiagnosticReceipt(missing.result).status).toBe("diagnostic_failed");
});

test("list, nested content and invalid JSON failures remain separate without response text", async () => {
  const list = await probe((list) => {
    list.LawSearch.totalCnt = "private bad count";
  });
  expect(list.calls).toBe(1);
  expect(list.result.outcomes[0]?.schemaFailure).toEqual({
    stage: "statute_list",
    issues: [{ field: "total_count", expected: "integer" }],
  });
  const nested = await probe((_list, detail) => {
    const article = detail.법령.조문.조문단위[0];
    if (!article) throw new Error("Missing synthetic article");
    article.항 = { 항내용: 123 };
  });
  expect(nested.result.outcomes[0]?.schemaFailure).toEqual({
    stage: "statute_nested",
    issues: [{ field: "paragraph_text", expected: "text" }],
  });
  const json = await probe(() => {}, true);
  expect(json.calls).toBe(1);
  expect(json.result.outcomes[0]?.schemaFailure).toEqual({
    stage: "response_json",
    issues: [{ field: "response", expected: "json" }],
  });
});

test("amendment text passes retrieval while rejected text exposes only finite stage labels", async () => {
  for (const [text, available] of [
    ["합성 조문 <개정 2013. 8. 13.>", true],
    ["합성 조문 <개정 private response>", false],
  ] as const) {
    const { result, calls } = await probe((_list, detail) => {
      const article = detail.법령.조문.조문단위[0];
      if (!article) throw new Error("Missing synthetic article");
      article.조문내용 = text;
    });
    expect(calls).toBe(2);
    expect(result.outcomes[0]?.availability).toBe(available ? "verified" : "unavailable");
    expect(result.claimIntegrity).toBe(available ? true : null);
    if (!available)
      expect(result.outcomes[0]?.schemaFailure).toEqual({
        stage: "statute_text",
        issues: [{ field: "article_text", expected: "plain_text" }],
      });
    expect(JSON.stringify(legalDiagnosticReceipt(result))).not.toContain("private response");
  }
});

test("schema paths and forged diagnostics cannot escape the finite output contract", () => {
  const failure = new z.ZodError([
    { code: "custom", path: ["private-id", 888], message: "private input SQL stack" },
  ]);
  const safe = legalSchemaDiagnostic("statute_detail", failure);
  expect(safe).toEqual({
    stage: "statute_detail",
    issues: [{ field: "unknown", expected: "unknown" }],
  });
  for (const malicious of [
    { ...safe, raw: "private" },
    { ...safe, stage: "private" },
    { ...safe, issues: [{ field: "private", expected: "text" }] },
  ])
    expect(safeLegalSchemaDiagnostic(malicious)).toBeUndefined();
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(
      reportLegalRetrieval({
        kind: "statute",
        availability: "unavailable",
        reason: "schema_mismatch",
        schemaFailure: safe,
      }).schemaFailure,
    ).toEqual(safe);
    expect(
      reportLegalRetrieval({
        kind: "statute",
        availability: "unavailable",
        reason: "schema_mismatch",
        schemaFailure: { ...safe, raw: "private" },
      }).schemaFailure,
    ).toBeUndefined();
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  } finally {
    log.mockRestore();
  }
});

test("audit diagnostic is bounded to existing enums, booleans and a fact count", () => {
  const value: WorkspaceAuditFailure = {
    pass: false,
    legalClaimsSupported: false,
    strategyDetected: false,
    unsupportedFactCount: 2,
    findings: [{ severity: "critical", code: "unsupported_legal_claim" }],
  };
  expect(safeWorkspaceAuditFailure(value)).toEqual(value);
  for (const invalid of [
    { ...value, unsupportedFactIds: ["private-id"] },
    { ...value, unsupportedFactCount: 301 },
    { ...value, unsupportedFactCount: -1 },
    { ...value, findings: [{ severity: "critical", code: "private-model-text" }] },
    { ...value, pass: "false" },
  ])
    expect(safeWorkspaceAuditFailure(invalid)).toBeUndefined();
});

test("manual legal diagnostic permits only the reviewed fixed public plan", () => {
  expect(legalReadinessScope("housing_article_3_2")).toEqual({
    scope: "housing_article_3_2",
    plans: [
      { kind: "statute", lawTitle: "주택임대차보호법", articles: [{ number: "3", branch: "2" }] },
    ],
  });
  for (const invalid of ["", "private query", "https://private.invalid", "production"])
    expect(() => legalReadinessScope(invalid)).toThrow("INVALID_LEGAL_DIAGNOSTIC_SCOPE");
});

test("fixed housing diagnostic uses the real article transport contract with synthetic responses", async () => {
  const selected = legalReadinessScope("housing_article_3_2");
  const list = structuredClone(syntheticList),
    detail = structuredClone(syntheticDetail);
  const candidate = list.LawSearch.law[0],
    article = detail.법령.조문.조문단위[0];
  if (!candidate || !article) throw new Error("Missing synthetic source");
  candidate.법령명한글 = "주택임대차보호법";
  detail.법령.기본정보.법령명_한글 = "주택임대차보호법";
  article.조문번호 = "3";
  article.조문가지번호 = "2";
  detail.법령.조문.조문단위 = [article];
  const observed = await inspectLegalV2({ LAW_API_OC: "synthetic-private-credential" }, NOW, {
    plans: selected.plans,
    transport: async (input) => {
      const url = new URL(input),
        search = url.pathname.endsWith("lawSearch.do");
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe("www.law.go.kr");
      expect(url.searchParams.get("target")).toBe("eflaw");
      if (search) expect(url.searchParams.get("query")).toBe("주택임대차보호법");
      else expect(url.searchParams.get("JO")).toBe("000302");
      return new Response(JSON.stringify(search ? list : detail), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const receipt = legalDiagnosticReceipt(observed);
  expect(receipt.status).toBe("diagnostic_passed");
  expect(receipt.requests).toBe(2);
  expect(receipt.claimIntegrity).toBe(true);
  expect(JSON.stringify(receipt)).not.toMatch(/https?:|1706|284415|synthetic-private-credential/u);
});
