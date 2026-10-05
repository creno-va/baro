import { afterEach, describe, expect, test } from "bun:test";
import type { V2OfficialCitation } from "../src/contracts/v2";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import {
  createV2OfficialSourceRepository,
  type OfficialSourceWrite,
} from "../src/server/db/v2-official-sources";
import { citation, guide, precedent } from "./fixtures/contracts/v2";
import { createTestDatabase } from "./helpers/d1";

const NOW = "2026-10-06T00:00:00.000Z";
const EXPIRES = "2026-10-06T00:10:00.000Z";
const BODY = "공식 자료 저장소를 검증하는 합성 원문입니다. 🧪 실제 법령이 아닙니다.";
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function fixture(inputCitation: V2OfficialCitation = citation) {
  const database = await createTestDatabase();
  databases.push(database);
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const cipher = await createCaseDataCipher({ CASE_DATA_KEY_V1: key });
  const repo = createV2OfficialSourceRepository(createV2Core(database.binding, cipher), [
    "www.klac.or.kr",
  ]);
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(BODY))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const c = { ...inputCitation, verifiedAt: NOW, contentHash: digest };
  const source: OfficialSourceWrite = {
    sourceId: c.sourceId,
    sourceType: c.kind,
    officialId: "officialId" in c ? c.officialId : "synthetic_guide_document",
    version: "synthetic_version_1",
    section: c.kind === "statute" ? c.article : c.kind === "official_guide" ? c.section : "full",
    contentHash: digest,
    extractorVersion: "synthetic_extractor_1",
    canonicalUrl: c.url,
    title: c.title,
    body: BODY,
    sourceDate:
      c.kind === "statute"
        ? c.effectiveDate
        : c.kind === "precedent"
          ? c.decisionDate
          : c.publishedDate,
    fetchedAt: NOW,
    verifiedAt: NOW,
    expiresAt: EXPIRES,
    rightsProvenance: "Synthetic test only; no rights approval or live capture",
    institutionId: c.kind === "official_guide" ? c.institutionId : null,
    endpointId: c.kind === "official_guide" ? c.endpointId : null,
    court: c.kind === "precedent" ? c.court : null,
    caseNumber: c.kind === "precedent" ? c.caseNumber : null,
  };
  const lookup = {
    sourceId: source.sourceId,
    sourceType: source.sourceType,
    officialId: source.officialId,
    version: source.version,
    section: source.section,
    contentHash: source.contentHash,
    extractorVersion: source.extractorVersion,
  };
  const count = () =>
    (database.sqlite.query("SELECT count(*) AS n FROM v2_official_sources").get() as { n: number })
      .n;
  return { database, repo, c, source, lookup, count };
}

describe("v2 official-source storage identity and expiry", () => {
  for (const c of [citation, precedent, guide]) {
    test(`${c.kind}: stores exact hashed synthetic source and preserves its identity`, async () => {
      const f = await fixture(c);
      expect(await f.repo.put(f.source, f.c)).toBe(true);
      const row = (await f.repo.find(f.lookup, NOW)) as Record<string, unknown> | null;
      expect(row?.body).toBe(BODY);
      expect(row?.sourceType).toBe(c.kind);
      expect(row?.contentHash).toBe(f.source.contentHash);
      expect(row?.canonicalUrl).toBe(c.url);
      expect(f.count()).toBe(1);
      expect(
        await f.repo.find({ ...f.lookup, extractorVersion: "other_extractor" }, NOW),
      ).toBeNull();
      expect(await f.repo.find({ ...f.lookup, contentHash: "a".repeat(64) }, NOW)).toBeNull();
    });
  }

  test("rejects body/hash mismatch without persisting any source", async () => {
    const f = await fixture();
    expect(await f.repo.put({ ...f.source, body: `${BODY} changed` }, f.c)).toBe(false);
    expect(f.count()).toBe(0);
  });

  const mismatches: Array<[string, V2OfficialCitation, Partial<OfficialSourceWrite>]> = [
    ["statute official ID", citation, { officialId: "different_statute" }],
    ["statute article", citation, { section: "합성 제2조" }],
    ["statute effective date", citation, { sourceDate: "2026-02-01" }],
    ["precedent official ID", precedent, { officialId: "different_precedent" }],
    ["precedent court", precedent, { court: "다른 합성 법원" }],
    ["precedent case number", precedent, { caseNumber: "다른 합성 사건번호" }],
    ["precedent decision date", precedent, { sourceDate: "2026-02-01" }],
    ["guide institution", guide, { institutionId: "different_institution" }],
    ["guide endpoint", guide, { endpointId: "different_endpoint" }],
    ["guide section", guide, { section: "다른 합성 안내 항목" }],
    ["guide publication date", guide, { sourceDate: "2026-02-01" }],
    ["verification timestamp", citation, { verifiedAt: "2026-10-06T00:00:01.000Z" }],
  ];
  for (const [name, c, mutation] of mismatches) {
    test(`refuses citation/source mismatch: ${name}`, async () => {
      const f = await fixture(c);
      expect(await f.repo.put({ ...f.source, ...mutation }, f.c)).toBe(false);
      expect(f.count()).toBe(0);
    });
  }

  test("expiry excludes exact boundary, earlier observations and future verification", async () => {
    const f = await fixture();
    expect(await f.repo.put(f.source, f.c)).toBe(true);
    expect(await f.repo.find(f.lookup, "2026-10-05T23:59:59.999Z")).toBeNull();
    expect(await f.repo.find(f.lookup, "2026-10-06T00:09:59.999Z")).not.toBeNull();
    expect(await f.repo.find(f.lookup, EXPIRES)).toBeNull();
    expect(await f.repo.find(f.lookup, "2026-10-06T00:10:00.001Z")).toBeNull();
  });

  test("the same cache ID cannot refresh a different effective date even when the new citation agrees", async () => {
    const f = await fixture(citation);
    expect(await f.repo.put(f.source, f.c)).toBe(true);
    expect(
      await f.repo.put(
        { ...f.source, sourceDate: "2026-02-01" },
        {
          ...f.c,
          kind: "statute",
          officialId: "synthetic_statute",
          article: "합성 제1조",
          effectiveDate: "2026-02-01",
        },
      ),
    ).toBe(false);
    const row = (await f.repo.find(f.lookup, NOW)) as Record<string, unknown> | null;
    expect(row?.sourceDate).toBe("2026-01-01");
  });

  test("the same cache ID cannot silently refresh different precedent court metadata", async () => {
    const f = await fixture(precedent);
    if (f.c.kind !== "precedent") throw new Error("Expected synthetic precedent fixture");
    expect(await f.repo.put(f.source, f.c)).toBe(true);
    expect(
      await f.repo.put(
        { ...f.source, court: "다른 합성 법원" },
        {
          ...f.c,
          contentHash: f.source.contentHash,
          verifiedAt: NOW,
          court: "다른 합성 법원",
        },
      ),
    ).toBe(false);
    const row = (await f.repo.find(f.lookup, NOW)) as Record<string, unknown> | null;
    expect(row?.court).toBe("합성 법원");
  });

  test("refreshes matching immutable identity but rejects another version under the same ID", async () => {
    const f = await fixture();
    expect(await f.repo.put(f.source, f.c)).toBe(true);
    expect(
      await f.repo.put(
        {
          ...f.source,
          fetchedAt: "2026-10-06T00:01:00Z",
          verifiedAt: "2026-10-06T00:01:00Z",
          expiresAt: "2026-10-06T00:20:00Z",
        },
        { ...f.c, verifiedAt: "2026-10-06T00:01:00Z" },
      ),
    ).toBe(true);
    expect(await f.repo.put({ ...f.source, version: "synthetic_version_2" }, f.c)).toBe(false);
    const row = (await f.repo.find(f.lookup, EXPIRES)) as Record<string, unknown> | null;
    expect(row?.version).toBe("synthetic_version_1");
    expect(row?.expiresAt).toBe("2026-10-06T00:20:00.000Z");
    expect(f.count()).toBe(1);
  });
});
