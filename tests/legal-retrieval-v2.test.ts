import { afterEach, expect, test } from "bun:test";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2OfficialSourceRepository } from "../src/server/db/v2-official-sources";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { validateV2Claims } from "../src/server/modules/citation/v2-validate";
import { textHash } from "../src/server/modules/legal-retrieval/service";
import { createWorkspaceSourceAuthorization } from "../src/server/modules/legal-retrieval/v2/authorization";
import {
  type Access,
  MAX_RESPONSE_BYTES,
  requestSchema,
} from "../src/server/modules/legal-retrieval/v2/contracts";
import { parseGuide } from "../src/server/modules/legal-retrieval/v2/guides";
import {
  matchesPrecedentCaseNumber,
  parsePrecedent,
  precedentCandidates,
} from "../src/server/modules/legal-retrieval/v2/precedents";
import {
  assertOfficialUrl,
  DISABLED_CATALOG,
} from "../src/server/modules/legal-retrieval/v2/registry";
import { createV2LegalRetrieval } from "../src/server/modules/legal-retrieval/v2/service";
import {
  parseStatute,
  parseStatuteCandidate,
  selectStatute,
  selectStatuteHistory,
} from "../src/server/modules/legal-retrieval/v2/statutes";
import { createBoundedTransport } from "../src/server/modules/legal-retrieval/v2/transport";
import { workspaceRetrievalPlans } from "../src/server/modules/legal-retrieval/v2/workspace-plans";
import { projectWorkspaceSources } from "../src/server/modules/legal-retrieval/v2/workspace-sources";
import officialList from "./fixtures/legal/official-list.json";
import officialDetail from "./fixtures/legal/official-sample.json";
import capturedGuide from "./fixtures/legal/v2/captured-guide-structure.json";
import capturedPrecedent from "./fixtures/legal/v2/captured-precedent-structure.json";
import families from "./fixtures/legal/v2/families.json";
import guides from "./fixtures/legal/v2/guides.json";
import precedents from "./fixtures/legal/v2/precedents.json";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z";
// Captured list is 20 of 78 results. Keep it unchanged and assert incomplete
// history rejection. Runtime positives use an explicitly synthetic complete
// response containing one actual captured row; this is not a live-list success.
const syntheticCompleteList = { LawSearch: { totalCnt: 1, law: [officialList.LawSearch.law[0]] } };
const statutePlan = {
  kind: "statute" as const,
  lawTitle: "민법",
  articles: [{ number: "598", branch: "0" }],
};
const guidePlan = {
  kind: "official_guide" as const,
  institutionId: "moleg_easylaw" as const,
  endpointId: "easylaw_text_section" as const,
  csmSeq: "734",
  ccfNo: "3",
  cciNo: "1",
  cnpClsNo: "4",
};
const input = (plans: unknown[] = [statutePlan]) => ({ asOfDate: "2026-10-06", now: NOW, plans });
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
// Preserve old provisional fixtures. Only the synthetic values below are
// rewrapped in the actual captured root; no public legal body is copied.
function syntheticPrecedentDetail(raw: string) {
  return { PrecService: JSON.parse(raw).판례정보 };
}
const syntheticAccess: Access = {
  authorize: async () => true,
  authorizeQuery: async () => true,
  reserveRequest: async () => true,
};
const requestUrl = new URL("https://www.law.go.kr/DRF/lawSearch.do?target=eflaw&type=JSON");
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
  const stranger = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
  const actor = { ownerId: owner.userId, now: NOW };
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("l".repeat(32)).replace(/=+$/, ""),
  });
  const core = createV2Core(db.binding, cipher),
    ws = createV2WorkspaceRepository(db.binding, cipher);
  const id = crypto.randomUUID();
  expect(
    (
      await ws.create(
        actor,
        id,
        {
          narrative: "합성 사건이며 실제 사용자나 비공개 정보가 포함되어 있지 않습니다.",
          subjectContext: "individual",
          jurisdiction: "KR",
          turnstileToken: "synthetic",
        },
        { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: "a".repeat(64) },
      )
    ).kind,
  ).toBe("created");
  const guard = { ...actor, workspaceId: id, expectedRevision: 1 };
  const repo = createV2OfficialSourceRepository(core, ["www.easylaw.go.kr", "easylaw.go.kr"]);
  const authorize = createWorkspaceSourceAuthorization(db.binding, guard);
  const attempts: Parameters<Access["reserveRequest"]>[0][] = [];
  const access: Access = {
    authorize,
    authorizeQuery: async () => true,
    reserveRequest: async (attempt) => {
      attempts.push(attempt);
      return true;
    },
  };
  const calls: string[] = [];
  const transport = async (url: string) => {
    const u = new URL(url);
    calls.push(u.pathname);
    return response(u.pathname.endsWith("lawSearch.do") ? syntheticCompleteList : officialDetail);
  };
  const service = (overrides: Partial<Parameters<typeof createV2LegalRetrieval>[2]> = {}) =>
    createV2LegalRetrieval({ LAW_API_OC: "synthetic-private-test" }, repo, {
      transport,
      sleep: async () => {},
      bindCitation: (c) => repo.bindCitation(guard, c),
      ...overrides,
    });
  return {
    db,
    actor,
    id,
    guard,
    repo,
    access,
    attempts,
    calls,
    service,
    core,
    ws,
    stranger: { ownerId: stranger.userId, now: NOW },
    deletion: createV2DeletionRepository(core),
  };
}

test("captured official statute list/detail parse exact identity, dates, article and normalized hash without v1 mutation", async () => {
  expect(() => selectStatute(officialList, statutePlan, "2026-10-06")).toThrow();
  const candidate = parseStatuteCandidate(officialList.LawSearch.law[0]);
  const chunk = await parseStatute(
    officialDetail,
    candidate,
    { number: "598", branch: "00" },
    "2026-10-06",
    NOW,
  );
  expect(chunk.citation.kind).toBe("statute");
  expect(chunk.source.officialId).toBe("1706");
  expect(chunk.source.version).toBe("284415");
  expect(chunk.source.section).toBe("제598조");
  expect(chunk.source.sourceDate).toBe("2026-03-17");
  expect(chunk.span.text).toBe(chunk.source.body);
  expect(chunk.source.body).toContain("소비대차");
  expect(chunk.source.body).not.toContain("OC=");
});

function syntheticLongHistory() {
  const base = officialList.LawSearch.law[0];
  if (!base) throw new Error("Missing synthetic history base");
  const current = structuredClone(base);
  const older = Array.from({ length: 100 }, (_, index) => ({
    ...current,
    // One promulgation legitimately has multiple effective-date rows.
    법령일련번호: index === 0 ? current.법령일련번호 : String(800000 + index),
    시행일자: new Date(Date.UTC(1990, 0, index + 1)).toISOString().slice(0, 10).replaceAll("-", ""),
    공포일자: "19890101",
  }));
  const firstPage = { LawSearch: { totalCnt: 101, page: 1, law: older } };
  const lastPage = { LawSearch: { totalCnt: 101, page: 2, law: [current] } };
  return [firstPage, lastPage] as const;
}

test("complete multi-page statute history selects the valid version and caches only the verified original", async () => {
  const f = await fixture(),
    pages = syntheticLongHistory();
  const calls: string[] = [];
  const service = f.service({
    transport: async (raw) => {
      const url = new URL(raw);
      calls.push(
        url.pathname.endsWith("lawSearch.do") ? `list_${url.searchParams.get("page")}` : "detail",
      );
      return response(
        url.pathname.endsWith("lawSearch.do")
          ? pages[Number(url.searchParams.get("page")) - 1]
          : officialDetail,
      );
    },
  });
  for (const cached of [false, true]) {
    calls.length = 0;
    const result = await service.retrieve(input(), f.access);
    expect(result.outcomes[0]?.availability).toBe("verified");
    expect(result.chunks[0]?.source.version).toBe("284415");
    expect(calls).toEqual(cached ? ["list_1", "list_2"] : ["list_1", "list_2", "detail"]);
  }
  expect(f.attempts).toHaveLength(5);
});

test.each(["missing", "overlap", "changed_total", "wrong_page"])(
  "statute pagination rejects %s history instead of publishing a partial version",
  async (mode) => {
    const pages = syntheticLongHistory();
    const second = pages[1];
    if (mode === "missing") second.LawSearch.law = [];
    if (mode === "overlap") {
      const first = pages[0].LawSearch.law[0];
      if (!first) throw new Error("Missing synthetic history row");
      second.LawSearch.law = [first];
    }
    if (mode === "changed_total") second.LawSearch.totalCnt = 102;
    if (mode === "wrong_page") second.LawSearch.page = 1;
    await expect(
      selectStatuteHistory(pages[0], async () => second, statutePlan, "2026-10-06"),
    ).rejects.toMatchObject({ reason: "history_incomplete" });
  },
);

test("statute history page limit stops before issuing more upstream requests", async () => {
  const pages = syntheticLongHistory();
  pages[0].LawSearch.totalCnt = 501;
  let extra = 0;
  await expect(
    selectStatuteHistory(
      pages[0],
      async () => {
        extra++;
        return pages[1];
      },
      statutePlan,
      "2026-10-06",
    ),
  ).rejects.toMatchObject({ reason: "history_incomplete" });
  expect(extra).toBe(0);
});

test.each(["quota", "consent", "cancel"])(
  "statute page two respects %s before making the next upstream request",
  async (mode) => {
    const f = await fixture(),
      pages = syntheticLongHistory(),
      controller = new AbortController();
    let calls = 0;
    const service = f.service({
      transport: async () => {
        calls++;
        if (mode === "consent")
          f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
        if (mode === "cancel") controller.abort();
        return response(pages[0]);
      },
    });
    const result = await service.retrieve(input(), {
      ...f.access,
      signal: controller.signal,
      reserveRequest: async (attempt) =>
        mode !== "quota" || attempt.endpointId !== "moleg_eflaw_list" || calls === 0,
    });
    expect(result.chunks).toEqual([]);
    expect(result.outcomes[0]?.reason).toBe(
      mode === "quota" ? "budget_exhausted" : mode === "consent" ? "not_authorized" : "cancelled",
    );
    expect(calls).toBe(1);
  },
);

test("actual SQL discovery cache needs no caller source keys and preserves fresh workspace citations", async () => {
  const f = await fixture();
  const result = await f.service().retrieve(input(), f.access);
  expect(result.outcomes[0]?.availability).toBe("verified");
  expect(result.chunks).toHaveLength(1);
  expect(f.calls).toHaveLength(2);
  expect(f.attempts).toHaveLength(2);
  const source = result.chunks[0]?.source;
  if (!source) throw new Error("Missing official source");
  expect(
    f.db.sqlite
      .query("SELECT count(*) AS n FROM v2_citation_bindings WHERE workspace_id=?")
      .get(f.id),
  ).toEqual({ n: 1 });
  const row = f.db.sqlite
    .query("SELECT * FROM v2_official_sources WHERE source_id=?")
    .get(source.sourceId) as Record<string, unknown>;
  expect(Object.keys(row)).not.toContain("query");
  expect(Object.keys(row)).not.toContain("owner_id");
  expect(JSON.stringify(row)).not.toContain("synthetic-private-test");
  const key = {
    sourceId: source.sourceId,
    sourceType: source.sourceType,
    officialId: source.officialId,
    version: source.version,
    section: source.section,
    contentHash: source.contentHash,
    extractorVersion: source.extractorVersion,
  };
  f.calls.length = 0;
  const repeated = await f.service().retrieve(input(), f.access);
  expect(repeated.chunks).toHaveLength(1);
  expect(repeated.chunks[0]?.source).toEqual(source);
  expect(repeated.chunks[0]?.citation.id).not.toBe(result.chunks[0]?.citation.id);
  expect(f.calls).toHaveLength(1);
  expect(await f.repo.find(key, "2026-10-07T00:00:00.000Z")).toBeNull();
});

test("discovery chooses newer fetched content over an older body with later verification", async () => {
  const f = await fixture();
  const candidate = parseStatuteCandidate(officialList.LawSearch.law[0]);
  const newer = await parseStatute(
    officialDetail,
    candidate,
    { number: "598", branch: "0" },
    "2026-10-06",
    NOW,
  );
  expect(await f.repo.put(newer.source, newer.citation)).toBe(true);
  const olderDetail = structuredClone(officialDetail);
  const article = olderDetail.법령.조문.조문단위.find((row) => row.조문번호 === "598");
  if (!article) throw new Error("Missing article fixture");
  article.조문내용 = "합성 이전 수집 본문이며 실제 법률 판단이 아닙니다.";
  const older = await parseStatute(
    olderDetail,
    candidate,
    { number: "598", branch: "0" },
    "2026-10-06",
    "2026-10-05T23:50:00Z",
  );
  expect(
    await f.repo.put({ ...older.source, verifiedAt: NOW }, { ...older.citation, verifiedAt: NOW }),
  ).toBe(true);
  const output = await f.service().retrieve(input(), f.access);
  expect(output.chunks[0]?.source.sourceId).toBe(newer.source.sourceId);
  expect(output.chunks[0]?.source.body).toBe(newer.source.body);
  expect(f.calls).toHaveLength(1);
});

test("source discovery preserves canonical UTC for equivalent precision and refreshes exact expiry", async () => {
  const f = await fixture();
  const first = await f.service().retrieve(input(), f.access);
  f.calls.length = 0;
  const sameInstant = await f
    .service()
    .retrieve({ ...input(), now: "2026-10-06T00:00:00Z" }, f.access);
  expect(sameInstant.chunks[0]?.source).toEqual(first.chunks[0]?.source);
  expect(sameInstant.chunks[0]?.citation.verifiedAt).toBe(NOW);
  expect(f.calls).toHaveLength(1);
  f.calls.length = 0;
  const laterGuard = { ...f.guard, now: "2026-10-07T00:00:00.000Z" };
  const refreshed = await f
    .service({ bindCitation: (c) => f.repo.bindCitation(laterGuard, c) })
    .retrieve(
      { ...input(), now: laterGuard.now },
      { ...f.access, authorize: createWorkspaceSourceAuthorization(f.db.binding, laterGuard) },
    );
  expect(refreshed.outcomes[0]?.availability).toBe("verified");
  expect(refreshed.chunks[0]?.source.sourceId).toBe(first.chunks[0]?.source.sourceId);
  expect(refreshed.chunks[0]?.source.fetchedAt).toBe(laterGuard.now);
  expect(f.calls).toHaveLength(2);
});

test("changed official version requires new detail instead of reusing the prior article cache", async () => {
  const f = await fixture();
  const first = await f.service().retrieve(input(), f.access);
  const changedList = structuredClone(syntheticCompleteList);
  const row = changedList.LawSearch.law[0];
  if (!row) throw new Error("Missing list fixture");
  row.법령일련번호 = "999999";
  let calls = 0;
  const result = await f
    .service({
      transport: async (url) => {
        calls++;
        return response(
          new URL(url).pathname.endsWith("lawSearch.do") ? changedList : officialDetail,
        );
      },
    })
    .retrieve(input(), f.access);
  expect(calls).toBe(2);
  expect(result.outcomes[0]?.availability).toBe("verified");
  expect(result.chunks[0]?.source.version).toBe("999999");
  expect(result.chunks[0]?.source.sourceId).not.toBe(first.chunks[0]?.source.sourceId);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_official_sources").get()).toEqual({
    n: 2,
  });
});

test("an article cache cannot satisfy another requested article or extractor revision", async () => {
  const f = await fixture();
  const first = await f.service().retrieve(input(), f.access);
  const changed = structuredClone(officialDetail);
  changed.법령.조문.조문단위 = changed.법령.조문.조문단위.filter(
    (article) => article.조문번호 !== "599",
  );
  const row = changed.법령.조문.조문단위.find((article) => article.조문번호 === "598");
  if (!row) throw new Error("Missing article fixture");
  row.조문번호 = "599";
  let details = 0;
  const articleResult = await f
    .service({
      transport: async (url) => {
        const request = new URL(url);
        if (request.pathname.endsWith("lawSearch.do")) return response(syntheticCompleteList);
        details++;
        expect(request.searchParams.get("JO")).toBe("059900");
        return response(changed);
      },
    })
    .retrieve(input([{ ...statutePlan, articles: [{ number: "599", branch: "0" }] }]), f.access);
  expect(articleResult.chunks[0]?.source.section).toBe("제599조");
  expect(details).toBe(1);
  const original = first.chunks[0]?.source;
  if (!original) throw new Error("Missing source");
  // Corruption deliberately exercises exact extractor isolation and immutable upsert rejection.
  f.db.sqlite
    .query("UPDATE v2_official_sources SET extractor_version='other_extractor' WHERE source_id=?")
    .run(original.sourceId);
  f.calls.length = 0;
  const wrongExtractor = await f.service().retrieve(input(), f.access);
  expect(wrongExtractor.outcomes[0]?.reason).toBe("cache_invalid");
  expect(wrongExtractor.chunks).toEqual([]);
  expect(f.calls).toHaveLength(2);
});

test.each([
  ["canonical_url", "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=999999"],
  ["title", "다른 합성 법령 제목"],
  ["source_date", "2027-01-01"],
  ["rights_provenance", "확인되지 않은 합성 권리 표시"],
  ["court", "법령에 잘못 연결된 합성 법원"],
  ["institution_id", "unexpected_institution"],
] as const)(
  "discovered statute cache rejects %s drift without new citation binding",
  async (column, value) => {
    const f = await fixture();
    const first = await f.service().retrieve(input(), f.access);
    const source = first.chunks[0]?.source;
    if (!source) throw new Error("Missing source");
    // Deliberate unsupported SQLite metadata corruption, not a source-writing API.
    f.db.sqlite
      .query(`UPDATE v2_official_sources SET ${column}=? WHERE source_id=?`)
      .run(value, source.sourceId);
    f.calls.length = 0;
    const result = await f.service().retrieve(input(), f.access);
    expect(result.outcomes[0]?.reason).toBe("cache_invalid");
    expect(result.chunks).toEqual([]);
    expect(f.calls).toHaveLength(1);
    expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
      n: 1,
    });
  },
);

test("SQLite forbids null statute dates and keeps the previously verified cache intact", async () => {
  const f = await fixture();
  const first = await f.service().retrieve(input(), f.access);
  const source = first.chunks[0]?.source;
  if (!source) throw new Error("Missing source");
  expect(() =>
    f.db.sqlite
      .query("UPDATE v2_official_sources SET source_date=NULL WHERE source_id=?")
      .run(source.sourceId),
  ).toThrow();
  f.calls.length = 0;
  const repeated = await f.service().retrieve(input(), f.access);
  expect(repeated.outcomes[0]?.availability).toBe("verified");
  expect(repeated.chunks[0]?.source).toEqual(source);
  expect(f.calls).toHaveLength(1);
});

test("a matching body and official tuple do not legitimize a forged generated source identity", async () => {
  const f = await fixture();
  const chunk = await parseStatute(
    officialDetail,
    parseStatuteCandidate(officialList.LawSearch.law[0]),
    { number: "598", branch: "0" },
    "2026-10-06",
    NOW,
  );
  const forged = `source_${"0".repeat(64)}`;
  expect(
    await f.repo.put(
      { ...chunk.source, sourceId: forged },
      {
        ...chunk.citation,
        sourceId: forged,
        id: `cite_${crypto.randomUUID().replaceAll("-", "_")}`,
      },
    ),
  ).toBe(true);
  const result = await f.service().retrieve(input(), f.access);
  expect(result.outcomes[0]?.reason).toBe("cache_invalid");
  expect(result.chunks).toEqual([]);
});

test.each(["consent", "revision", "tombstone", "delete", "cancel"])(
  "real %s change after actual cache lookup releases no cached chunk or new binding",
  async (boundary) => {
    const f = await fixture();
    await f.service().retrieve(input(), f.access);
    const controller = new AbortController();
    const repo = {
      ...f.repo,
      findLatestByIdentity: async (...args: Parameters<typeof f.repo.findLatestByIdentity>) => {
        const source = await f.repo.findLatestByIdentity(...args);
        expect(source).not.toBeNull();
        if (boundary === "consent")
          f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
        if (boundary === "revision") expect(await f.ws.changeState(f.guard, "archive")).toBe(true);
        if (boundary === "tombstone")
          f.db.sqlite.query("INSERT INTO v2_tombstones VALUES('workspace',?,?)").run(f.id, NOW);
        if (boundary === "delete") expect(await f.deletion.workspace(f.guard)).toBe(true);
        if (boundary === "cancel") controller.abort();
        return source;
      },
    };
    let calls = 0;
    const service = createV2LegalRetrieval({ LAW_API_OC: "synthetic-private-test" }, repo, {
      transport: async () => {
        calls++;
        return response(syntheticCompleteList);
      },
      bindCitation: (c) => f.repo.bindCitation(f.guard, c),
    });
    const result = await service.retrieve(input(), { ...f.access, signal: controller.signal });
    expect(result.chunks).toEqual([]);
    expect(result.outcomes[0]?.reason).toBe(boundary === "cancel" ? "cancelled" : "not_authorized");
    expect(calls).toBe(1);
    expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
      n: boundary === "delete" ? 0 : 1,
    });
  },
);

test.each(["owner", "consent", "revision", "tombstone"])(
  "real SQL %s guard blocks before transport and leaves factual preparation available",
  async (boundary) => {
    const f = await fixture();
    let access = f.access;
    if (boundary === "owner")
      access = {
        ...access,
        authorize: createWorkspaceSourceAuthorization(f.db.binding, {
          ...f.guard,
          ownerId: f.stranger.ownerId,
        }),
      };
    if (boundary === "consent")
      f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
    if (boundary === "revision") expect(await f.ws.changeState(f.guard, "archive")).toBe(true);
    if (boundary === "tombstone")
      f.db.sqlite.query("INSERT INTO v2_tombstones VALUES('workspace',?,?)").run(f.id, NOW);
    const result = await f.service().retrieve(input(), access);
    expect(result.chunks).toEqual([]);
    expect(f.calls).toEqual([]);
    expect(result.factualPreparationAvailable).toBe(true);
    expect(result.outcomes[0]?.reason).toBe("not_authorized");
  },
);

test("actual workspace deletion while a response is pending releases no source/citation", async () => {
  const f = await fixture();
  const result = await f
    .service({
      transport: async () => {
        expect(await f.deletion.workspace(f.guard)).toBe(true);
        return response(officialList);
      },
    })
    .retrieve(input(), f.access);
  expect(result.chunks).toEqual([]);
  expect(result.outcomes[0]?.reason).toBe("not_authorized");
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
    n: 0,
  });
});

test("unapproved query text is never sent and safe configuration errors contain no credential or upstream message", async () => {
  const f = await fixture();
  const blocked = await f
    .service()
    .retrieve(input(), { ...f.access, authorizeQuery: async () => false });
  expect(blocked.chunks).toEqual([]);
  expect(f.calls).toEqual([]);
  const missing = createV2LegalRetrieval({ LAW_API_OC: "" }, f.repo, {
    transport: async () => {
      throw new Error("never");
    },
    bindCitation: async () => false,
  });
  expect((await missing.retrieve(input(), f.access)).outcomes[0]?.reason).toBe(
    "configuration_missing",
  );
  const rejected = await f
    .service({
      transport: async () =>
        response({ result: false, msg: "synthetic-private-test private upstream diagnostics" }),
    })
    .retrieve(input(), f.access);
  expect(rejected.outcomes[0]?.reason).toBe("upstream_rejected");
  expect(JSON.stringify(rejected)).not.toContain("private");
});

test.each(["sync", "async", "pending"] as const)(
  "%s diagnostic observer preserves the public rejection and single request",
  async (failure) => {
    const f = await fixture();
    let requests = 0;
    const observations: unknown[] = [];
    const rejected = await f
      .service({
        transport: async () => {
          requests++;
          return response({ result: false, msg: "API 인증키 OC를 확인 synthetic-private" });
        },
        observeUpstreamRejection: (observation) => {
          observations.push(observation);
          if (failure === "pending") return new Promise<void>(() => {});
          if (failure === "async") return Promise.reject(new Error("synthetic-private-observer"));
          throw new Error("synthetic-private-observer");
        },
      })
      .retrieve(input(), f.access);
    expect(observations).toEqual([
      { endpointId: "moleg_eflaw_list", category: "upstream-credential-rejected" },
    ]);
    expect(requests).toBe(1);
    expect(f.attempts).toHaveLength(1);
    expect(rejected.outcomes[0]?.reason).toBe("upstream_rejected");
    expect(rejected.chunks).toEqual([]);
    expect(JSON.stringify(rejected)).not.toContain("synthetic-private");
  },
);

test("malformed JSON never reaches the upstream envelope observer", async () => {
  const f = await fixture();
  let observations = 0;
  const rejected = await f
    .service({
      transport: async () =>
        new Response("synthetic-private-json", {
          headers: { "content-type": "application/json" },
        }),
      observeUpstreamRejection: () => {
        observations++;
      },
    })
    .retrieve(input(), f.access);
  expect(observations).toBe(0);
  expect(rejected.outcomes[0]?.reason).toBe("schema_mismatch");
  expect(f.attempts).toHaveLength(1);
});

test.each([
  "wrongid",
  "wrongdate",
  "wrongpromulgation",
  "missingarticle",
  "incompletehistory",
  "malformedUnicode",
])("official %s counterexample is unavailable without invented source", async (mode) => {
  const f = await fixture();
  const detail = structuredClone(officialDetail);
  const list = structuredClone(syntheticCompleteList);
  if (mode === "wrongid") detail.법령.기본정보.법령ID = "99999";
  if (mode === "wrongdate") detail.법령.기본정보.시행일자 = "20270101";
  if (mode === "wrongpromulgation") detail.법령.기본정보.공포번호 = "99999";
  if (mode === "missingarticle") detail.법령.조문.조문단위 = [];
  if (mode === "incompletehistory") list.LawSearch.totalCnt = 101;
  if (mode === "malformedUnicode") {
    const row = detail.법령.조문.조문단위.find((r) => r.조문번호 === "598");
    if (!row) throw new Error("Missing captured article");
    row.조문내용 = "합성 잘못된 Unicode \ud800";
  }
  const result = await f
    .service({
      transport: async (url) =>
        response(new URL(url).pathname.endsWith("lawSearch.do") ? list : detail),
    })
    .retrieve(input(), f.access);
  expect(result.chunks).toEqual([]);
  expect(result.outcomes[0]?.availability).toBe("unavailable");
});

test("transport retries reserve each invocation attempt and never retry an unclassified HTTP200 upstream rejection", async () => {
  let calls = 0;
  const reservations: Parameters<Access["reserveRequest"]>[0][] = [];
  const request = createBoundedTransport(
    async () => (++calls < 3 ? response({}, 503) : response({ safe: true })),
    { sleep: async () => {} },
  );
  expect(
    await request(requestUrl, "moleg_eflaw_list", {
      ...syntheticAccess,
      reserveRequest: async (a) => {
        reservations.push(a);
        return true;
      },
    }),
  ).toBe('{"safe":true}');
  expect(reservations.map((a) => a.attempt)).toEqual([1, 2, 3]);
  expect(new Set(reservations.map((a) => a.invocationId)).size).toBe(1);
  const f = await fixture();
  const value = await f
    .service({
      transport: async () => {
        calls++;
        return response({ result: false, msg: "required term" });
      },
    })
    .retrieve(input(), f.access);
  expect(value.outcomes[0]?.reason).toBe("upstream_rejected");
  expect(f.attempts).toHaveLength(1);
});

test("statute requests retain documented date/version/article parameters over HTTPS", async () => {
  const f = await fixture();
  const requests: { path: string; parameters: Record<string, string> }[] = [];
  const output = await f
    .service({
      transport: async (raw) => {
        const url = new URL(raw);
        expect(url.origin).toBe("https://www.law.go.kr");
        expect(url.searchParams.get("OC")).toBe("synthetic-private-test");
        url.searchParams.delete("OC");
        requests.push({ path: url.pathname, parameters: Object.fromEntries(url.searchParams) });
        return response(
          url.pathname.endsWith("lawSearch.do") ? syntheticCompleteList : officialDetail,
        );
      },
    })
    .retrieve(input([{ ...statutePlan, lawId: "1706" }]), f.access);
  expect(output.legalSourceStatus).toBe("verified");
  expect(requests).toEqual([
    {
      path: "/DRF/lawSearch.do",
      parameters: {
        target: "eflaw",
        type: "JSON",
        query: "민법",
        LID: "1706",
        nw: "1,3",
        sort: "efdes",
        display: "100",
        page: "1",
        efYd: "00010101~20261006",
      },
    },
    {
      path: "/DRF/lawService.do",
      parameters: {
        target: "eflaw",
        type: "JSON",
        MST: "284415",
        efYd: "20260317",
        JO: "059800",
      },
    },
  ]);
});

test("precedent requests use bounded dated lists and the validated ID for detail", async () => {
  const f = await fixture();
  const list = precedents.find((v) => v.id === "precedent_list_candidate");
  const detail = precedents.find((v) => v.id === "precedent_verified");
  if (!list || !detail) throw new Error("Missing synthetic precedent");
  const requests: { path: string; parameters: Record<string, string> }[] = [];
  const output = await f
    .service({
      transport: async (raw) => {
        const url = new URL(raw);
        expect(url.origin).toBe("https://www.law.go.kr");
        expect(url.searchParams.get("OC")).toBe("synthetic-private-test");
        url.searchParams.delete("OC");
        requests.push({ path: url.pathname, parameters: Object.fromEntries(url.searchParams) });
        return response(
          url.pathname.endsWith("lawSearch.do")
            ? JSON.parse(list.response.body)
            : syntheticPrecedentDetail(detail.response.body),
        );
      },
    })
    .retrieve(input([{ kind: "precedent", query: "합성 개념", limit: 3 }]), f.access);
  expect(output.legalSourceStatus).toBe("verified");
  expect(requests).toEqual([
    {
      path: "/DRF/lawSearch.do",
      parameters: {
        target: "prec",
        type: "JSON",
        query: "합성 개념",
        search: "2",
        datSrcNm: "대법원",
        display: "3",
        page: "1",
        sort: "ddes",
        prncYd: "00010101~20261006",
      },
    },
    {
      path: "/DRF/lawService.do",
      parameters: {
        target: "prec",
        type: "JSON",
        ID: "90000000201",
      },
    },
  ]);
});

test("top-one court precedent remains bound and quotable while larger search coverage stays partial", async () => {
  const f = await fixture();
  const list = precedents.find((v) => v.id === "precedent_list_candidate");
  const detail = precedents.find((v) => v.id === "precedent_verified");
  if (!list || !detail) throw new Error("Missing synthetic precedent");
  const body = JSON.parse(list.response.body);
  body.PrecSearch.totalCnt = 200;
  let calls = 0;
  const service = f.service({
    transport: async (raw) => {
      calls++;
      const url = new URL(raw);
      if (url.pathname.endsWith("lawSearch.do")) {
        expect(url.searchParams.get("datSrcNm")).toBe("대법원");
        expect(url.searchParams.get("display")).toBe("1");
        return response(body);
      }
      return response(syntheticPrecedentDetail(detail.response.body));
    },
  });
  const plans = workspaceRetrievalPlans([{ kind: "precedent", concept: "대여금" }]);
  for (const cached of [false, true]) {
    calls = 0;
    const result = await service.retrieve(input(plans), f.access);
    expect(result.outcomes[0]).toMatchObject({
      availability: "verified",
      reason: null,
      searchTruncated: true,
    });
    const projected = await projectWorkspaceSources(result);
    expect(projected.citations).toHaveLength(1);
    expect(projected.sourceCoverage.sourcesPartial).toBe(true);
    expect(projected.sourceCoverage.outcomes[0]?.searchTruncated).toBe(true);
    const citation = projected.citations[0];
    const excerpt = projected.sourceTexts[0];
    if (!citation || !excerpt) throw new Error("Missing verified precedent");
    expect(
      (
        await validateV2Claims(
          [
            {
              id: "synthetic_claim",
              kind: "quotation",
              text: excerpt.text,
              citationId: citation.id,
              startUtf16: 0,
              endUtf16: excerpt.text.length,
            },
          ],
          projected.citations,
          projected.sourceRetrieval,
        )
      ).valid,
    ).toBe(true);
    expect(calls).toBe(cached ? 1 : 2);
  }
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
    n: 2,
  });
});

test("precedent source filter remains server-selected and cannot admit arbitrary source parameters", () => {
  const url = new URL(
    "https://www.law.go.kr/DRF/lawSearch.do?target=prec&type=JSON&datSrcNm=대법원",
  );
  expect(assertOfficialUrl(url.href).hostname).toBe("www.law.go.kr");
  for (const source of ["국세법령정보시스템", "arbitrary", ""]) {
    url.searchParams.set("datSrcNm", source);
    expect(() => assertOfficialUrl(url.href)).toThrow();
  }
  url.searchParams.set("datSrcNm", "대법원");
  url.searchParams.append("datSrcNm", "대법원");
  expect(() => assertOfficialUrl(url.href)).toThrow();
});

test("general consultation selects general legal aid rather than crime-victim eligibility", () => {
  expect(
    workspaceRetrievalPlans([{ kind: "official_guide", guideKey: "legal_consultation" }]),
  ).toEqual([
    {
      kind: "official_guide",
      institutionId: "moleg_easylaw",
      endpointId: "easylaw_text_section",
      csmSeq: "568",
      ccfNo: "2",
      cciNo: "2",
      cnpClsNo: "1",
    },
  ]);
});

test("stream limits count bytes despite deceptive Content-Length and cancel oversized bodies", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = createBoundedTransport(
    async () =>
      new Response(body, {
        headers: { "content-type": "application/json", "content-length": "1" },
      }),
  );
  await expect(request(requestUrl, "moleg_eflaw_list", syntheticAccess)).rejects.toMatchObject({
    reason: "too_large",
  });
  expect(cancelled).toBe(true);
});

test.each([301, 302, 303, 307, 308])(
  "bounded transport rejects redirect %i without following, retrying or retaining its body",
  async (status) => {
    let calls = 0;
    let reservations = 0;
    let waits = 0;
    let cancelled = false;
    const transport = createBoundedTransport(
      async (_url, init) => {
        calls++;
        expect(init.redirect).toBe("manual");
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status, headers: { location: "https://untrusted.example.invalid/collect" } },
        );
      },
      {
        sleep: async () => {
          waits++;
        },
      },
    );
    await expect(
      transport(requestUrl, "moleg_eflaw_list", {
        ...syntheticAccess,
        reserveRequest: async () => {
          reservations++;
          return true;
        },
      }),
    ).rejects.toMatchObject({ reason: "upstream_rejected" });
    expect(calls).toBe(1);
    expect(reservations).toBe(1);
    expect(waits).toBe(0);
    expect(cancelled).toBe(true);
  },
);

test("timeout includes stalled body reads, cancellation stops retries, wrong media/redirect fail closed", async () => {
  let calls = 0;
  const stalled = createBoundedTransport(
    async () => {
      calls++;
      return new Response(
        new ReadableStream({
          pull() {
            return new Promise(() => {});
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
    { timeoutMs: 5, sleep: async () => {} },
  );
  await expect(stalled(requestUrl, "moleg_eflaw_list", syntheticAccess)).rejects.toMatchObject({
    reason: "timeout",
  });
  expect(calls).toBe(3);
  const controller = new AbortController();
  controller.abort();
  calls = 0;
  const normal = createBoundedTransport(async () => {
    calls++;
    return response({});
  });
  await expect(
    normal(requestUrl, "moleg_eflaw_list", { ...syntheticAccess, signal: controller.signal }),
  ).rejects.toMatchObject({ reason: "cancelled" });
  expect(calls).toBe(0);
  await expect(
    createBoundedTransport(
      async () => new Response("html", { headers: { "content-type": "text/html" } }),
    )(requestUrl, "moleg_eflaw_list", syntheticAccess),
  ).rejects.toMatchObject({ reason: "unsupported_format" });
  await expect(
    createBoundedTransport(
      async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1" } }),
    )(requestUrl, "moleg_eflaw_list", syntheticAccess),
  ).rejects.toMatchObject({ reason: "upstream_rejected" });
});

test.each([
  "http://www.law.go.kr/DRF/lawService.do",
  "https://law.go.kr.evil.test/DRF/lawService.do",
  "https://127.0.0.1/DRF/lawService.do",
  "https://www.law.go.kr:444/DRF/lawService.do",
  "https://www.law.go.kr/DRF/lawService.do/evil",
])("rejects unsafe source URL %s before transport", (url) => {
  expect(() => assertOfficialUrl(url)).toThrow();
});

test("captured EasyLaw structural subset uses actual selectors/basis date; pending update stays limited", async () => {
  const parsed = await parseGuide(capturedGuide.body, guidePlan, "2026-10-06", NOW);
  expect(parsed.reason).toBe("update_pending");
  expect(parsed.chunk.source.sourceDate).toBe("2026-09-15");
  expect(parsed.chunk.source.title).toContain("법률지원");
  expect(parsed.chunk.source.body).toContain("법률상담");
  expect(parsed.chunk.source.body).not.toContain("javascript");
  expect(DISABLED_CATALOG.map((v) => v.id)).toContain("klac_summary_candidate");
  const synthetic = guides.find((v) => v.id === "guide_verified");
  if (!synthetic) throw new Error("Missing fixture");
  await expect(
    parseGuide(synthetic.response.body, guidePlan, "2026-10-06", NOW),
  ).rejects.toBeDefined();
});

test("guide canonical substitution, duplicate identities and future basis dates are rejected", async () => {
  await expect(
    parseGuide(
      capturedGuide.body.replace("csmSeq=734", "csmSeq=999"),
      guidePlan,
      "2026-10-06",
      NOW,
    ),
  ).rejects.toBeDefined();
  await expect(
    parseGuide(
      capturedGuide.body.replace("2026년 9월 15일", "2027년 9월 15일"),
      guidePlan,
      "2026-10-06",
      NOW,
    ),
  ).rejects.toMatchObject({ reason: "date_invalid" });
  await expect(
    parseGuide(capturedGuide.body + capturedGuide.body, guidePlan, "2026-10-06", NOW),
  ).rejects.toMatchObject({ reason: "identity_mismatch" });
});

test("documented synthetic precedent fields reject altered court/date/identity and distinguish summary-only from full text", async () => {
  const list = precedents.find((v) => v.id === "precedent_list_candidate"),
    detail = precedents.find((v) => v.id === "precedent_verified");
  if (!list || !detail) throw new Error("Missing synthetic precedent");
  const selected = precedentCandidates(JSON.parse(list.response.body), "2026-10-06", 3).rows[0];
  if (!selected) throw new Error("Missing synthetic candidate");
  expect(
    (
      await parsePrecedent(
        syntheticPrecedentDetail(detail.response.body),
        selected,
        "2026-10-06",
        NOW,
      )
    ).full,
  ).toBe(true);
  const raw = syntheticPrecedentDetail(detail.response.body);
  expect(capturedPrecedent.wrapper).toBe("PrecService");
  expect(Object.keys(raw.PrecService)).toEqual(Object.keys(capturedPrecedent.fieldTypes));
  await expect(
    parsePrecedent(JSON.parse(detail.response.body), selected, "2026-10-06", NOW),
  ).rejects.toBeDefined();
  delete raw.PrecService.판례내용;
  expect((await parsePrecedent(raw, selected, "2026-10-06", NOW)).full).toBe(false);
  raw.PrecService.법원명 = "다른 법원";
  await expect(parsePrecedent(raw, selected, "2026-10-06", NOW)).rejects.toMatchObject({
    reason: "identity_mismatch",
  });
  await expect(
    parsePrecedent(
      syntheticPrecedentDetail(detail.response.body),
      { ...selected, 데이터출처명: "국세법령정보시스템" },
      "2026-10-06",
      NOW,
    ),
  ).rejects.toMatchObject({ reason: "unsupported_format" });
});

test("precedent list dotted dates match compact detail dates while impossible dates and missing courts fail closed", async () => {
  const list = precedents.find((v) => v.id === "precedent_list_candidate"),
    detail = precedents.find((v) => v.id === "precedent_verified");
  if (!list || !detail) throw new Error("Missing synthetic precedent");
  const value = JSON.parse(list.response.body);
  const row = value.PrecSearch.prec[0];
  row.선고일자 = "2026.01.02";
  const selected = precedentCandidates(value, "2026-10-06", 3).rows[0];
  if (!selected) throw new Error("Missing synthetic candidate");
  expect(selected.선고일자).toBe("2026-01-02");
  expect(
    (
      await parsePrecedent(
        syntheticPrecedentDetail(detail.response.body),
        selected,
        "2026-10-06",
        NOW,
      )
    ).full,
  ).toBe(true);
  for (const invalid of [
    "2026.02.30",
    "2026.13.01",
    "2026.1.02",
    "2026/01/02",
    "2026.01.02extra",
  ]) {
    row.선고일자 = invalid;
    expect(() => precedentCandidates(value, "2026-10-06", 3)).toThrow();
  }
  row.선고일자 = "2027.01.02";
  expect(precedentCandidates(value, "2026-10-06", 3).rows).toEqual([]);
  row.선고일자 = "2026.01.02";
  row.법원명 = "";
  expect(() => precedentCandidates(value, "2026-10-06", 3)).toThrow();
  row.데이터출처명 = "국세법령정보시스템";
  const tax = precedentCandidates(value, "2026-10-06", 3).rows[0];
  if (!tax) throw new Error("Missing synthetic tax candidate");
  await expect(
    parsePrecedent(syntheticPrecedentDetail(detail.response.body), tax, "2026-10-06", NOW),
  ).rejects.toMatchObject({ reason: "unsupported_format" });
});

test("all nationwide synthetic families keep factual preparation when no source is requested, without model fallback", async () => {
  const f = await fixture();
  for (const family of families) {
    expect(family.jurisdiction).toBe("KR");
    const result = await f.service().retrieve(input([]), f.access);
    expect(result.chunks).toEqual([]);
    expect(result.factualPreparationAvailable).toBe(true);
  }
  expect(f.calls).toEqual([]);
  expect(
    requestSchema.safeParse(input([{ ...statutePlan, url: "https://evil.test" }])).success,
  ).toBe(false);
});
test("synthetic precedent full text and actual-selector guide flow through the real public cache/binding repository", async () => {
  const f = await fixture();
  const list = precedents.find((v) => v.id === "precedent_list_candidate"),
    detail = precedents.find((v) => v.id === "precedent_verified");
  if (!list || !detail) throw new Error("Missing synthetic fixture");
  const result = await f
    .service({
      transport: async (url) =>
        new URL(url).pathname.endsWith("lawSearch.do")
          ? response(JSON.parse(list.response.body))
          : new URL(url).hostname === "www.law.go.kr"
            ? response(syntheticPrecedentDetail(detail.response.body))
            : new Response(capturedGuide.body, { headers: { "content-type": "text/html" } }),
    })
    .retrieve(input([{ kind: "precedent", query: "합성 개념", limit: 3 }, guidePlan]), f.access);
  expect(result.outcomes.map((o) => o.availability)).toEqual(["verified", "limited"]);
  expect(result.outcomes[1]?.reason).toBe("update_pending");
  expect(result.legalSourceStatus).toBe("verified");
  expect(
    f.db.sqlite.query("SELECT source_type FROM v2_official_sources ORDER BY source_type").all(),
  ).toEqual([{ source_type: "official_guide" }, { source_type: "precedent" }]);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
    n: 1,
  });
});

test.each(["full", "summary", "tax", "joined"])(
  "%s precedent discovery preserves full-text and unsupported source boundaries",
  async (mode) => {
    const f = await fixture();
    const list = precedents.find((v) => v.id === "precedent_list_candidate");
    const detail = precedents.find((v) => v.id === "precedent_verified");
    if (!list || !detail) throw new Error("Missing synthetic precedent");
    const detailBody = syntheticPrecedentDetail(detail.response.body);
    if (mode === "summary") delete detailBody.PrecService.판례내용;
    const listBody = JSON.parse(list.response.body);
    if (mode === "joined") {
      listBody.PrecSearch.prec[0].사건번호 = "2026다100001";
      detailBody.PrecService.사건번호 = "2026다100001, 100002";
    }
    let calls = 0;
    const service = f.service({
      transport: async (url) => {
        calls++;
        return response(new URL(url).pathname.endsWith("lawSearch.do") ? listBody : detailBody);
      },
    });
    const plans = [{ kind: "precedent", query: "합성 개념", limit: 3 }];
    const first = await service.retrieve(input(plans), f.access);
    expect(first.chunks).toHaveLength(1);
    if (mode === "joined") expect(first.chunks[0]?.source.caseNumber).toBe("2026다100001");
    if (mode === "tax") {
      listBody.PrecSearch.prec[0].데이터출처명 = "국세법령정보시스템";
      listBody.PrecSearch.prec[0].법원명 = "";
      listBody.PrecSearch.prec[0].선고일자 = "2026.01.02";
    }
    calls = 0;
    const repeated = await service.retrieve(input(plans), f.access);
    if (mode === "tax") {
      expect(repeated.chunks).toEqual([]);
      expect(repeated.outcomes[0]?.reason).toBe("unsupported_format");
      expect(calls).toBe(1);
    } else {
      expect(repeated.chunks[0]?.source).toEqual(first.chunks[0]?.source);
      expect(repeated.chunks[0]?.citation.id).not.toBe(first.chunks[0]?.citation.id);
      expect(repeated.outcomes[0]?.availability).toBe(mode === "summary" ? "limited" : "verified");
      expect(calls).toBe(mode === "summary" ? 2 : 1);
    }
  },
);

test("joined decision matching rejects prefixes, later cases and unstructured suffixes", () => {
  expect(matchesPrecedentCaseNumber("2026다100001", "2026다100001, 100002")).toBe(true);
  for (const detail of [
    "2026다1000010, 100002",
    "2026다100002, 100001",
    "2026다100001 외",
    "2026다100001, 100002 text",
    "2026다100001, 100002, 100002",
    "2026다100001, 100001",
  ])
    expect(matchesPrecedentCaseNumber("2026다100001", detail)).toBe(false);
});

test.each(["court", "case_number", "source_date"])(
  "precedent discovered cache rejects %s mismatch against the current official candidate",
  async (column) => {
    const f = await fixture();
    const list = precedents.find((v) => v.id === "precedent_list_candidate");
    const detail = precedents.find((v) => v.id === "precedent_verified");
    if (!list || !detail) throw new Error("Missing synthetic precedent");
    let calls = 0;
    const service = f.service({
      transport: async (url) => {
        calls++;
        return response(
          new URL(url).pathname.endsWith("lawSearch.do")
            ? JSON.parse(list.response.body)
            : syntheticPrecedentDetail(detail.response.body),
        );
      },
    });
    const plans = [{ kind: "precedent", query: "합성 개념", limit: 3 }];
    const first = await service.retrieve(input(plans), f.access);
    const source = first.chunks[0]?.source;
    if (!source) throw new Error("Missing source");
    // Unsupported raw SQLite corruption verifies retrieval's type-specific metadata boundary.
    f.db.sqlite
      .query(`UPDATE v2_official_sources SET ${column}=? WHERE source_id=?`)
      .run(column === "source_date" ? "2026-01-03" : "다른 합성 값", source.sourceId);
    calls = 0;
    const repeated = await service.retrieve(input(plans), f.access);
    expect(repeated.chunks).toEqual([]);
    expect(repeated.outcomes[0]?.reason).toBe("cache_invalid");
    expect(calls).toBe(1);
    expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
      n: 1,
    });
  },
);

test("cached guide text never promotes pending-update coverage into verified availability", async () => {
  const f = await fixture();
  let calls = 0;
  const service = f.service({
    transport: async () => {
      calls++;
      return new Response(capturedGuide.body, { headers: { "content-type": "text/html" } });
    },
  });
  const first = await service.retrieve(input([guidePlan]), f.access);
  const repeated = await service.retrieve(input([guidePlan]), f.access);
  expect(calls).toBe(2);
  expect(repeated.chunks[0]?.source).toEqual(first.chunks[0]?.source);
  expect(repeated.chunks[0]?.citation.id).not.toBe(first.chunks[0]?.citation.id);
  expect(repeated.outcomes[0]?.availability).toBe("limited");
  expect(repeated.outcomes[0]?.reason).toBe("update_pending");
  expect(repeated.legalSourceStatus).toBe("unavailable");
});
test("cancel during fetch and retry backoff stops reservations; budget denial never sends request", async () => {
  let calls = 0;
  const controller = new AbortController();
  const pending = createBoundedTransport(
    async () => {
      calls++;
      controller.abort();
      return new Promise(() => {});
    },
    { timeoutMs: 10 },
  );
  await expect(
    pending(requestUrl, "moleg_eflaw_list", { ...syntheticAccess, signal: controller.signal }),
  ).rejects.toMatchObject({ reason: "cancelled" });
  expect(calls).toBe(1);
  const backoffController = new AbortController();
  calls = 0;
  const backoff = createBoundedTransport(
    async () => {
      calls++;
      return response({}, 429);
    },
    {
      sleep: async () => {
        backoffController.abort();
      },
    },
  );
  await expect(
    backoff(requestUrl, "moleg_eflaw_list", {
      ...syntheticAccess,
      signal: backoffController.signal,
    }),
  ).rejects.toMatchObject({ reason: "cancelled" });
  expect(calls).toBe(1);
  calls = 0;
  await expect(
    createBoundedTransport(async () => {
      calls++;
      return response({});
    })(requestUrl, "moleg_eflaw_list", { ...syntheticAccess, reserveRequest: async () => false }),
  ).rejects.toMatchObject({ reason: "budget_exhausted" });
  expect(calls).toBe(0);
});
test.each(["revoked", "guardThrows", "cancelled"])(
  "%s during cost reservation prevents any query disclosure without inventing an actual charge",
  async (mode) => {
    let authorized = true,
      calls = 0,
      reservations = 0;
    const controller = new AbortController();
    const request = createBoundedTransport(async () => {
      calls++;
      return response({});
    });
    await expect(
      request(requestUrl, "moleg_eflaw_list", {
        authorize: async () => {
          if (!authorized && mode === "guardThrows")
            throw new Error("synthetic authorization diagnostic");
          return authorized;
        },
        authorizeQuery: async () => true,
        signal: controller.signal,
        reserveRequest: async () => {
          reservations++;
          authorized = false;
          if (mode === "cancelled") controller.abort();
          return true;
        },
      }),
    ).rejects.toMatchObject({ reason: mode === "cancelled" ? "cancelled" : "not_authorized" });
    expect(reservations).toBe(1);
    expect(calls).toBe(0);
  },
);
test("real SQL consent withdrawal during reservation stops transport before disclosure", async () => {
  const f = await fixture();
  const result = await f.service().retrieve(input(), {
    ...f.access,
    reserveRequest: async () => {
      f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
      return true;
    },
  });
  expect(f.calls).toEqual([]);
  expect(result.outcomes[0]?.reason).toBe("not_authorized");
  expect(result.chunks).toEqual([]);
});
test("consent revoked during actual public cache put does not bind the retrieved citation", async () => {
  const f = await fixture();
  const repo = {
    ...f.repo,
    put: async (...args: Parameters<typeof f.repo.put>) => {
      const accepted = await f.repo.put(...args);
      f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
      return accepted;
    },
  };
  const service = createV2LegalRetrieval({ LAW_API_OC: "synthetic-private-test" }, repo, {
    transport: async (url) =>
      response(
        new URL(url).pathname.endsWith("lawSearch.do") ? syntheticCompleteList : officialDetail,
      ),
    bindCitation: (c) => f.repo.bindCitation(f.guard, c),
  });
  const result = await service.retrieve(input(), f.access);
  expect(result.outcomes[0]?.reason).toBe("not_authorized");
  expect(result.chunks).toEqual([]);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
    n: 0,
  });
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_official_sources").get()).toEqual({
    n: 1,
  });
});
test("body invalid UTF-8 and mismatched declared bytes fail without retry; supplementary Unicode may span chunks", async () => {
  let calls = 0;
  const utf8 = createBoundedTransport(async () => {
    calls++;
    return new Response(new Uint8Array([0xc3, 0x28]), {
      headers: { "content-type": "application/json" },
    });
  });
  await expect(utf8(requestUrl, "moleg_eflaw_list", syntheticAccess)).rejects.toMatchObject({
    reason: "schema_mismatch",
  });
  expect(calls).toBe(1);
  const deceptive = createBoundedTransport(
    async () =>
      new Response("{}", {
        headers: { "content-type": "application/json", "content-length": "5" },
      }),
  );
  await expect(deceptive(requestUrl, "moleg_eflaw_list", syntheticAccess)).rejects.toMatchObject({
    reason: "schema_mismatch",
  });
  const bytes = new TextEncoder().encode('"😀"');
  const split = createBoundedTransport(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (const b of bytes) c.enqueue(new Uint8Array([b]));
            c.close();
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  expect(await split(requestUrl, "moleg_eflaw_list", syntheticAccess)).toBe('"😀"');
});
test("active HTML cannot supply title/canonical/date/body and UI-only icons confer no missing-image coverage", async () => {
  const active = `<script>const html='<link rel="canonical" href="https://evil.test"><title>악성 제목</title><div id="ovDiv">무관한 원문</div>이 정보는 2099년 1월 1일 기준으로 작성된 것입니다';</script>`;
  const parsed = await parseGuide(active + capturedGuide.body, guidePlan, "2026-10-06", NOW);
  expect(parsed.chunk.source.title).not.toContain("악성");
  expect(parsed.chunk.source.body).toBe("법률상담");
  const current = capturedGuide.body.replace(/향후 업데이트 예정/g, "검토 완료");
  expect((await parseGuide(current, guidePlan, "2026-10-06", NOW)).reason).toBeNull();
  expect(
    (
      await parseGuide(
        current.replace("</div></div>", '<img src="/third-party-chart.png"></div></div>'),
        guidePlan,
        "2026-10-06",
        NOW,
      )
    ).reason,
  ).toBe("image_omitted");
  expect(
    (
      await parseGuide(
        current.replace("</div></div>", "<svg><text>합성 차트</text></svg></div></div>"),
        guidePlan,
        "2026-10-06",
        NOW,
      )
    ).reason,
  ).toBe("image_omitted");
  expect(
    (
      await parseGuide(
        current.replace("2026년 9월 15일", "날짜 정보 없음"),
        guidePlan,
        "2026-10-06",
        NOW,
      )
    ).reason,
  ).toBe("unknown_publication_date");
});
test.each([
  "https://www.law.go.kr/DRF/lawSearch.do?target=eflaw&type=JSON&redirect=https://evil.test",
  "https://www.law.go.kr/DRF/lawSearch.do?target=eflaw&target=prec&type=JSON",
  "https://www.law.go.kr/DRF/lawSearch.do?target=evil&type=JSON",
])("query identity spoof is rejected before network", (url) =>
  expect(() => assertOfficialUrl(url)).toThrow(),
);
test("future as-of dates, duplicate plans and invalid article numbers cannot trigger source requests", () => {
  expect(requestSchema.safeParse({ ...input(), asOfDate: "2026-10-07" }).success).toBe(false);
  expect(requestSchema.safeParse(input([statutePlan, statutePlan])).success).toBe(false);
  expect(
    requestSchema.safeParse(input([{ ...statutePlan, articles: [{ number: "0" }] }])).success,
  ).toBe(false);
});
test("captured structure body/hash provenance remains exact and credential-free", async () => {
  expect(await textHash(capturedGuide.body)).toBe(capturedGuide.bodySha256);
  expect(capturedGuide.origin).toBe("captured_public_structure_subset");
  expect(capturedPrecedent.origin).toBe("captured_public_example_structure");
  expect(capturedPrecedent.responseSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify([capturedGuide, capturedPrecedent])).not.toContain("OC=");
});
test("corrupted cached text is rejected and cannot refresh or bind a mismatched source", async () => {
  const f = await fixture();
  const first = await f.service().retrieve(input(), f.access),
    source = first.chunks[0]?.source;
  if (!source) throw new Error("Missing source");
  // Deliberate SQLite corruption, not a supported source-write API.
  f.db.sqlite
    .query("UPDATE v2_official_sources SET body=? WHERE source_id=?")
    .run("합성 캐시 변조", source.sourceId);
  const result = await f.service().retrieve(input(), f.access);
  expect(result.outcomes[0]?.reason).toBe("cache_invalid");
  expect(result.chunks).toEqual([]);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
    n: 1,
  });
});

test.each([false, true])(
  "future-only rows with malformed=%s never hide an actual list failure as empty",
  async (malformed) => {
    const f = await fixture();
    const rawList = JSON.parse(
      precedents.find((v) => v.id === "precedent_list_candidate")?.response.body ?? "{}",
    );
    const future = { ...rawList.PrecSearch.prec[0], 선고일자: "2099.01.01" };
    let calls = 0;
    const result = await f
      .service({
        transport: async () => {
          calls++;
          return response({
            PrecSearch: { totalCnt: malformed ? 2 : 1, prec: malformed ? [future, {}] : [future] },
          });
        },
      })
      .retrieve(input([{ kind: "precedent", query: "합성 개념", limit: 3 }]), f.access);
    expect(result.outcomes[0]?.reason).toBe(malformed ? "schema_mismatch" : "no_results");
    expect(result.chunks).toEqual([]);
    expect(calls).toBe(1);
  },
);

for (const position of ["first", "last"] as const) {
  test.each(["http", "identity", "summary", "malformed", "timeout"] as const)(
    `${position} failed precedent %s preserves only independently verified originals`,
    async (mode) => {
      const f = await fixture();
      const rawList = JSON.parse(
        precedents.find((v) => v.id === "precedent_list_candidate")?.response.body ?? "{}",
      );
      const rawDetail = syntheticPrecedentDetail(
        precedents.find((v) => v.id === "precedent_verified")?.response.body ?? "{}",
      );
      const good = rawList.PrecSearch.prec[0];
      const bad = { ...good, 판례일련번호: "999000569", 사건명: "합성 확인 불가 판례" };
      if (mode === "malformed") delete bad.법원명;
      const list = {
        PrecSearch: { totalCnt: 2, prec: position === "first" ? [bad, good] : [good, bad] },
      };
      const service = f.service({
        timeoutMs: 50,
        transport: async (url) => {
          const u = new URL(url);
          if (u.pathname.endsWith("lawSearch.do")) return response(list);
          if (u.searchParams.get("ID") !== bad.판례일련번호) return response(rawDetail);
          if (mode === "timeout") return new Promise<Response>(() => {});
          if (mode === "http") return response({}, 403);
          const detail = structuredClone(rawDetail);
          detail.PrecService.판례정보일련번호 =
            mode === "identity" ? "999000570" : bad.판례일련번호;
          detail.PrecService.사건명 = bad.사건명;
          if (mode === "summary") delete detail.PrecService.판례내용;
          return response(detail);
        },
      });
      const result = await service.retrieve(
        input([{ kind: "precedent", query: "합성 개념", limit: 3 }]),
        f.access,
      );
      expect(result.outcomes[0]?.availability).toBe("verified");
      expect(result.outcomes[0]?.reason).toBeNull();
      expect(result.chunks).toHaveLength(1);
      const surviving = result.chunks[0];
      if (surviving?.citation.kind !== "precedent") throw new Error("Missing verified precedent");
      expect(surviving.citation.officialId).toBe(String(good.판례일련번호));
      const quote = surviving.span.text.slice(0, 160);
      expect(
        (
          await validateV2Claims(
            [
              {
                id: "partial-original-claim",
                kind: "quotation",
                text: quote,
                citationId: surviving.citation.id,
                startUtf16: 0,
                endUtf16: quote.length,
              },
            ],
            [surviving.citation],
            result,
          )
        ).valid,
      ).toBe(true);
      expect(result.outcomes[0]?.sourceFailures).toEqual([
        (
          {
            http: "upstream_rejected",
            identity: "identity_mismatch",
            summary: "unsupported_format",
            malformed: "schema_mismatch",
            timeout: "timeout",
          } as const
        )[mode],
      ]);
      const projected = await projectWorkspaceSources(result);
      expect(projected.citations).toHaveLength(1);
      expect(projected.sourceCoverage.sourcesPartial).toBe(true);
      expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
        n: 1,
      });
    },
  );
}

test("revocation after a verified original clears every partial result", async () => {
  const f = await fixture();
  const list = JSON.parse(
    precedents.find((v) => v.id === "precedent_list_candidate")?.response.body ?? "{}",
  );
  const detail = syntheticPrecedentDetail(
    precedents.find((v) => v.id === "precedent_verified")?.response.body ?? "{}",
  );
  const good = list.PrecSearch.prec[0];
  list.PrecSearch.prec.push({ ...good, 판례일련번호: "999000569" });
  list.PrecSearch.totalCnt = 2;
  let allowed = true;
  const result = await f
    .service({
      transport: async (url) => {
        const u = new URL(url);
        if (u.pathname.endsWith("lawSearch.do")) return response(list);
        if (u.searchParams.get("ID") === "999000569") {
          allowed = false;
          return response({}, 403);
        }
        return response(detail);
      },
    })
    .retrieve(input([{ kind: "precedent", query: "합성 개념", limit: 3 }]), {
      ...f.access,
      authorize: async () => allowed,
    });
  expect(result.chunks).toEqual([]);
  expect(result.outcomes[0]?.reason).toBe("not_authorized");
});

test.each([false, true])(
  "one failed statute article preserves the other verified article, failureFirst=%s",
  async (failureFirst) => {
    const f = await fixture();
    const good = { number: "598", branch: "0" };
    const bad = { number: "600", branch: "0" };
    const result = await f
      .service({
        transport: async (url) => {
          const u = new URL(url);
          if (u.pathname.endsWith("lawSearch.do")) return response(syntheticCompleteList);
          return u.searchParams.get("JO") === "060000"
            ? response({}, 403)
            : response(officialDetail);
        },
      })
      .retrieve(
        input([{ ...statutePlan, articles: failureFirst ? [bad, good] : [good, bad] }]),
        f.access,
      );
    expect(result.chunks).toHaveLength(1);
    expect(result.outcomes[0]?.availability).toBe("verified");
    expect(result.outcomes[0]?.sourceFailures).toEqual(["upstream_rejected"]);
    expect((await projectWorkspaceSources(result)).sourceCoverage.sourcesPartial).toBe(true);
  },
);
