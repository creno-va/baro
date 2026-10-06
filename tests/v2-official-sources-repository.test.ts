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
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z";
const EXPIRES = "2026-10-06T00:10:00.000Z";
const BODY = "공식 자료 저장소를 검증하는 합성 원문입니다. 🧪 실제 법령이 아닙니다.";
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

test("discovered public identity hits cache without a private query/sourceId/hash and uses the bounded discovery index", async () => {
  const f = await fixture();
  expect(await f.repo.put(f.source, f.c)).toBe(true);
  const { sourceType, officialId, version, section, extractorVersion } = f.source;
  const identity = { sourceType, officialId, version, section, extractorVersion };
  expect(await f.repo.findLatestByIdentity(identity, NOW)).toEqual(f.source);
  expect(await f.repo.findLatestByIdentity({ ...identity, version: "other" }, NOW)).toBeNull();
  await expect(
    f.repo.findLatestByIdentity(
      { ...identity, privateQuery: "synthetic-secret" } as typeof identity,
      NOW,
    ),
  ).rejects.toMatchObject({ code: "REPOSITORY_INPUT_INVALID" });
  const plan = f.database.sqlite
    .query(
      "EXPLAIN QUERY PLAN SELECT * FROM v2_official_sources WHERE source_type=? AND official_id=? AND version=? AND section=? AND extractor_version=? AND fetched_at<=? AND verified_at<=? AND expires_at>? ORDER BY fetched_at DESC,verified_at DESC,source_id ASC LIMIT 1",
    )
    .all(sourceType, officialId, version, section, extractorVersion, NOW, NOW, NOW);
  expect(JSON.stringify(plan)).toContain("v2_official_discovery_idx");
  expect(f.count()).toBe(1);
});
test("newer fetched body wins over delayed verification of older immutable content and equal times have deterministic sourceId order", async () => {
  const f = await fixture();
  expect(await f.repo.put(f.source, f.c)).toBe(true);
  const body = `${BODY} new synthetic public revision`;
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const source = {
    ...f.source,
    sourceId: "new-source",
    body,
    contentHash: hash,
    fetchedAt: "2026-10-06T00:00:01.000Z",
    verifiedAt: "2026-10-06T00:00:02.000Z",
  };
  const c = { ...f.c, sourceId: source.sourceId, contentHash: hash, verifiedAt: source.verifiedAt };
  expect(await f.repo.put(source, c)).toBe(true);
  const old = { ...f.source, verifiedAt: "2026-10-06T00:00:05.000Z" };
  expect(await f.repo.put(old, { ...f.c, verifiedAt: old.verifiedAt })).toBe(true);
  const { sourceType, officialId, version, section, extractorVersion } = source;
  const found = await f.repo.findLatestByIdentity(
    { sourceType, officialId, version, section, extractorVersion },
    "2026-10-06T00:00:06Z",
  );
  expect(found?.sourceId).toBe("new-source");
  expect(found?.body).toBe(body);
  expect(f.count()).toBe(2);
  expect(await f.repo.put(f.source, f.c)).toBe(false);
  const tiedBody = `${body} tied synthetic content`;
  const tiedHash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tiedBody))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const tied = { ...source, sourceId: "a-tied-source", body: tiedBody, contentHash: tiedHash };
  expect(await f.repo.put(tied, { ...c, sourceId: tied.sourceId, contentHash: tiedHash })).toBe(
    true,
  );
  expect(
    (
      await f.repo.findLatestByIdentity(
        { sourceType, officialId, version, section, extractorVersion },
        "2026-10-06T00:00:06Z",
      )
    )?.sourceId,
  ).toBe("a-tied-source");
});
test("discovered source enforces exact fractional expiry and bodyhash/official URL despite same-key persisted drift", async () => {
  const f = await fixture();
  expect(await f.repo.put(f.source, f.c)).toBe(true);
  const { sourceType, officialId, version, section, extractorVersion } = f.source,
    identity = { sourceType, officialId, version, section, extractorVersion };
  expect(await f.repo.findLatestByIdentity(identity, "2026-10-06T00:10:00Z")).toBeNull();
  f.database.sqlite
    .query("UPDATE v2_official_sources SET body=? WHERE source_id=?")
    .run("synthetic forged plaintext", f.source.sourceId);
  expect(await f.repo.findLatestByIdentity(identity, NOW)).toBeNull();
  f.database.sqlite
    .query("UPDATE v2_official_sources SET body=?,canonical_url=? WHERE source_id=?")
    .run(BODY, "https://example.test/foreign", f.source.sourceId);
  expect(await f.repo.findLatestByIdentity(identity, NOW)).toBeNull();
});
test("bindCitation normalizes nonfractional actor time, rejects 1ms future verification and exact expiry without partial binding", async () => {
  const f = await fixture();
  const user = await seedTestSession(f.database, { now: Date.parse(NOW), consent: true });
  const id = crypto.randomUUID();
  f.database.sqlite
    .query(
      "INSERT INTO v2_workspaces(id,owner_id,status,encrypted_payload,created_at,updated_at) VALUES(?,?,'intake','synthetic-private-envelope',?,?)",
    )
    .run(id, user.userId, NOW, NOW);
  const future = "2026-10-06T00:00:00.001Z",
    source = { ...f.source, verifiedAt: future },
    c = { ...f.c, verifiedAt: future };
  expect(await f.repo.put(source, c)).toBe(true);
  const g = {
    ownerId: user.userId,
    now: "2026-10-06T00:00:00Z",
    workspaceId: id,
    expectedRevision: 1,
  };
  expect(await f.repo.bindCitation(g, c)).toBe(false);
  expect(f.database.sqlite.query("SELECT * FROM v2_citation_bindings").all()).toEqual([]);
  expect(await f.repo.bindCitation({ ...g, now: future }, c)).toBe(true);
  expect(
    await f.repo.bindCitation(
      { ...g, now: "2026-10-06T00:10:00Z" },
      { ...c, id: crypto.randomUUID() },
    ),
  ).toBe(false);
  expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
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
