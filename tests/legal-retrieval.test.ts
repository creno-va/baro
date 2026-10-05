import { afterEach, expect, test } from "bun:test";
import { createCaseDataCipher } from "../src/server/crypto";
import { createDomainRepository } from "../src/server/db/repository";
import { validateCitations } from "../src/server/modules/citation/validate";
import {
  createLegalRetrieval,
  type LegalRetrievalDiagnostic,
  parseOfficialDetail,
  selectLaw,
  textHash,
} from "../src/server/modules/legal-retrieval/service";
import { guidance } from "./fixtures/contracts";
import { createTestDatabase } from "./helpers/d1";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
test("HTTP 200 error envelopes distinguish registration and credential rejection without raw diagnostics", async () => {
  const f = await fixture();
  const sensitive = "synthetic-private-oc https://example.test/?OC=synthetic-private-oc";
  for (const [message, category] of [
    [
      `유관기관 서비스에 등록된 아이피 및 등록상태를 확인 ${sensitive}`,
      "upstream-registration-rejected",
    ],
    [`API 인증키 OC를 확인 ${sensitive}`, "upstream-credential-rejected"],
    ["요청을 처리할 수 없습니다 synthetic-private-oc", "upstream-error"],
    ["서비스 점검 중", "upstream-error"],
  ] as const) {
    const observations: LegalRetrievalDiagnostic[] = [];
    let calls = 0;
    const adapter = createLegalRetrieval(
      { LAW_API_OC: "synthetic-private-oc" },
      f.repo,
      async () => {
        calls++;
        return Response.json({ result: "private-status", msg: message });
      },
      async () => {},
      (value) => observations.push(value),
    );
    await expect(adapter.retrieve(["loan"], "2026-10-05", NOW)).rejects.toThrow(
      "LEGAL_SOURCE_UNAVAILABLE",
    );
    expect(calls).toBe(1);
    expect(observations).toEqual([{ stage: "list", category, httpStatus: 200 }]);
    const serialized = JSON.stringify(observations);
    expect(serialized).not.toContain("synthetic-private-oc");
    expect(serialized).not.toContain("example.test");
    expect(serialized).not.toContain("private-status");
  }
});
test("safe diagnostics preserve bounded retries, strict schemas and observer isolation", async () => {
  const f = await fixture();
  const observations: LegalRetrievalDiagnostic[] = [];
  let calls = 0;
  const adapter = createLegalRetrieval(
    { LAW_API_OC: "synthetic-private-oc" },
    f.repo,
    async (url) => {
      calls++;
      if (calls === 1) return new Response("private-error-body", { status: 503 });
      return Response.json(url.includes("lawSearch") ? list : detail);
    },
    async () => {},
    (value) => observations.push(value),
  );
  const result = await adapter.retrieve(["loan"], "2026-10-05", NOW);
  expect(result.chunks).toHaveLength(1);
  expect(calls).toBe(3);
  expect(observations).toEqual([
    { stage: "list", category: "server-unavailable", httpStatus: 503 },
  ]);
  observations.length = 0;
  const malformed = createLegalRetrieval(
    { LAW_API_OC: "synthetic-private-oc" },
    f.repo,
    async () => Response.json({ LawSearch: { totalCnt: 1, law: { secret: "private" } } }),
    async () => {},
    (value) => observations.push(value),
  );
  await expect(malformed.retrieve(["loan"], "2026-10-05", NOW)).rejects.toThrow(
    "LEGAL_SOURCE_UNAVAILABLE",
  );
  expect(observations).toEqual([{ stage: "retrieval", category: "schema-mismatch" }]);
  const brokenObserver = createLegalRetrieval(
    { LAW_API_OC: "synthetic-private-oc" },
    f.repo,
    async () => new Response("private error", { status: 403 }),
    async () => {},
    () => {
      throw new Error("private observer error");
    },
  );
  await expect(brokenObserver.retrieve(["loan"], "2026-10-05", NOW)).rejects.toThrow(
    "LEGAL_SOURCE_UNAVAILABLE",
  );
});
test("diagnostics identify invalid JSON, request quota and missing credentials without extra calls", async () => {
  const f = await fixture();
  for (const [credential, reserve, response, expected] of [
    ["", true, new Response("not-used"), "credential-missing"],
    ["synthetic", false, new Response("not-used"), "request-budget-exhausted"],
    ["synthetic", true, new Response("private malformed JSON"), "invalid-json"],
  ] as const) {
    const observations: LegalRetrievalDiagnostic[] = [];
    let calls = 0;
    const adapter = createLegalRetrieval(
      { LAW_API_OC: credential },
      f.repo,
      async () => {
        calls++;
        return response;
      },
      async () => {},
      (value) => observations.push(value),
    );
    await expect(
      adapter.retrieve(["loan"], "2026-10-05", NOW, async () => reserve),
    ).rejects.toThrow("LEGAL_SOURCE_UNAVAILABLE");
    expect(observations[0]?.category).toBe(expected);
    expect(calls).toBe(expected === "invalid-json" ? 1 : 0);
  }
});
const NOW = "2026-10-05T12:00:00.000Z";
const list = await Bun.file("tests/fixtures/legal/official-list.json").json();
const detail = await Bun.file("tests/fixtures/legal/official-sample.json").json();
async function fixture() {
  const db = await createTestDatabase();
  databases.push(db);
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("x".repeat(32)).replace(/=+$/, ""),
  });
  return { db, repo: createDomainRepository(db.binding, cipher) };
}
test("official response identity/date/article tree and checksums are verified", async () => {
  const candidate = selectLaw(list, "2026-10-05");
  expect(candidate?.법령ID).toBe("001706");
  if (!candidate) throw new Error("fixture");
  const chunks = await parseOfficialDetail(detail, candidate, ["598", "603"], "2026-10-05", NOW);
  expect(chunks).toHaveLength(2);
  expect(chunks[0]?.citation.contentHash).toBe(await textHash(chunks[0]?.text ?? ""));
  expect(
    chunks.every(
      (c) => !c.citation.url.includes("OC=") && c.citation.url.startsWith("https://law.go.kr/"),
    ),
  ).toBe(true);
  await expect(
    parseOfficialDetail(detail, { ...candidate, 법령ID: "999999" }, ["598"], "2026-10-05", NOW),
  ).rejects.toThrow();
  await expect(
    parseOfficialDetail(detail, candidate, ["598"], "2026-03-01", NOW),
  ).rejects.toThrow();
});
test("D1 TTL 24h, cache hash tampering and expiry fail closed, versions remain separate", async () => {
  const f = await fixture();
  let calls = 0;
  const transport = async (url: string) => {
    calls++;
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("www.law.go.kr");
    expect(parsed.searchParams.get("query") ?? "민법").toBe("민법");
    return Response.json(parsed.pathname.includes("lawSearch") ? list : detail);
  };
  const adapter = createLegalRetrieval(
    { LAW_API_OC: "synthetic" },
    f.repo,
    transport,
    async () => {},
  );
  const r = await adapter.retrieve(["loan", "repayment"], "2026-10-05", NOW);
  expect(calls).toBe(3);
  const again = await adapter.retrieve(["loan", "repayment"], "2026-10-05", NOW);
  expect(calls).toBe(4);
  expect(again).toEqual(r);
  const draft = {
    ...guidance,
    asOfDate: r.asOfDate,
    citations: r.chunks.map((c) => c.citation),
    issues: [],
    nextSteps: [],
  };
  expect(await validateCitations(draft, r)).toBe(true);
  const firstCitation = draft.citations[0];
  if (!firstCitation) throw new Error("fixture citation missing");
  expect(
    await validateCitations(
      { ...draft, citations: [{ ...firstCitation, url: "https://law.go.kr.attacker.test" }] },
      r,
    ),
  ).toBe(false);
  expect(
    await validateCitations(draft, {
      ...r,
      chunks: r.chunks.map((c) => ({ ...c, text: "tampered" })),
    }),
  ).toBe(false);
  await adapter.retrieve(["loan"], "2026-10-06", "2026-10-06T12:00:00.000Z");
  expect(calls).toBe(6);
  const old = r.chunks[0];
  if (!old) throw new Error("fixture missing");
  const changedText = `${old.text}\n공식 응답 변경 검증용 합성 원문`;
  const changedHash = await textHash(changedText);
  await f.repo.putLegalSource(
    {
      ...old.citation,
      id: `law_${changedHash}`,
      contentHash: changedHash,
      sourceId: old.citation.sourceId.replace(old.citation.contentHash, changedHash),
    },
    changedText,
    NOW,
    "2026-10-06T12:00:00.000Z",
  );
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM legal_source_cache").get()).toEqual({ n: 3 });
  f.db.sqlite.exec("UPDATE legal_source_cache SET body='tampered'");
  await expect(
    adapter.retrieve(["loan"], "2026-10-06", "2026-10-06T12:00:00.000Z"),
  ).rejects.toThrow("LEGAL_SOURCE_UNAVAILABLE");
});
test("missing secret, arbitrary queries, schema changes, timeout and transient retry are bounded", async () => {
  const f = await fixture();
  let calls = 0;
  const offline = async () => {
    calls++;
    throw new Error("synthetic timeout");
  };
  await expect(
    createLegalRetrieval({ LAW_API_OC: "" }, f.repo, offline, async () => {}).retrieve(
      ["loan"],
      "2026-10-05",
      NOW,
    ),
  ).rejects.toThrow("LEGAL_SOURCE_UNAVAILABLE");
  expect(calls).toBe(0);
  await expect(
    createLegalRetrieval({ LAW_API_OC: "synthetic" }, f.repo, offline, async () => {}).retrieve(
      ["borrower name"],
      "2026-10-05",
      NOW,
    ),
  ).rejects.toThrow();
  expect(calls).toBe(0);
  await expect(
    createLegalRetrieval({ LAW_API_OC: "synthetic" }, f.repo, offline, async () => {}).retrieve(
      ["loan"],
      "2026-10-05",
      NOW,
    ),
  ).rejects.toThrow();
  expect(calls).toBe(3);
  calls = 0;
  await expect(
    createLegalRetrieval(
      { LAW_API_OC: "synthetic" },
      f.repo,
      async () => {
        calls++;
        return Response.json({ changed: true });
      },
      async () => {},
    ).retrieve(["loan"], "2026-10-05", NOW),
  ).rejects.toThrow();
  expect(calls).toBe(1);
});
