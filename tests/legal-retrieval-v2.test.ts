import { afterEach, expect, test } from "bun:test";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2OfficialSourceRepository } from "../src/server/db/v2-official-sources";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { textHash } from "../src/server/modules/legal-retrieval/service";
import { createWorkspaceSourceAuthorization } from "../src/server/modules/legal-retrieval/v2/authorization";
import {
  type Access,
  MAX_RESPONSE_BYTES,
  requestSchema,
} from "../src/server/modules/legal-retrieval/v2/contracts";
import { parseGuide } from "../src/server/modules/legal-retrieval/v2/guides";
import {
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
} from "../src/server/modules/legal-retrieval/v2/statutes";
import { createBoundedTransport } from "../src/server/modules/legal-retrieval/v2/transport";
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

test("actual SQL cache and citation bind preserve private-query exclusion and immutable public source versions", async () => {
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
  expect(
    (await f.service({ knownSourceKeys: [key] }).retrieve(input(), f.access)).chunks,
  ).toHaveLength(1);
  expect(f.calls).toHaveLength(1);
  expect(await f.repo.find(key, "2026-10-07T00:00:00.000Z")).toBeNull();
});

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

test.each(["wrongid", "wrongdate", "missingarticle", "incompletehistory", "malformedUnicode"])(
  "official %s counterexample is unavailable without invented source",
  async (mode) => {
    const f = await fixture();
    const detail = structuredClone(officialDetail);
    const list = structuredClone(syntheticCompleteList);
    if (mode === "wrongid") detail.법령.기본정보.법령ID = "99999";
    if (mode === "wrongdate") detail.법령.기본정보.시행일자 = "20270101";
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
  },
);

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
    n: 2,
  });
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
  const result = await f.service({ knownSourceKeys: [source] }).retrieve(input(), f.access);
  expect(result.outcomes[0]?.reason).toBe("cache_invalid");
  expect(result.chunks).toEqual([]);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
    n: 1,
  });
});
