import { afterEach, expect, test } from "bun:test";
import { createCaseDataCipher } from "../src/server/crypto";
import { createDomainRepository } from "../src/server/db/repository";
import { validateCitations } from "../src/server/modules/citation/validate";
import {
  createLegalRetrieval,
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
