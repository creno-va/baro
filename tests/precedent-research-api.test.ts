import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  v2PrecedentReadResponseSchema,
  v2PrecedentResearchContextSchema,
  v2PrecedentSearchResponseSchema,
} from "../src/contracts/v2/precedent-research";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createPrecedentsApi } from "../src/server/api/v2/precedents";
import { createPrecedentResearchService } from "../src/server/modules/legal-retrieval/research/service";
import {
  type ResearchClaims,
  signResearchToken,
  verifyResearchToken,
} from "../src/server/modules/legal-retrieval/research/tokens";
import {
  recommendPrecedentTopics,
  researchExcerpt,
} from "../src/server/modules/legal-retrieval/research/topics";
import type { Transport } from "../src/server/modules/legal-retrieval/v2/transport";
import { summary } from "./fixtures/contracts/v2";
import precedents from "./fixtures/legal/v2/precedents.json";
import {
  confirmCustomerSummary,
  customerWorkspaceFixture,
  runCustomerJob,
} from "./helpers/customer-workspace";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof customerWorkspaceFixture>>["db"][] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const list = JSON.parse(
  precedents.find((f) => f.id === "precedent_list_candidate")?.response.body ?? "{}",
);
const detail = {
  PrecService: JSON.parse(
    precedents.find((f) => f.id === "precedent_verified")?.response.body ?? "{}",
  ).판례정보,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const searchBody = async (response: Response) =>
  v2PrecedentSearchResponseSchema.parse(await response.json());
async function fixture(confirmed = true) {
  const f = await customerWorkspaceFixture(new Date().toISOString());
  databases.push(f.db);
  await runCustomerJob(f, "intake_questions");
  const intake = await f.service.intake(f.owner.userId, f.workspace.id);
  if (!intake) throw new Error("Missing synthetic intake");
  await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: intake.revision,
    answers: intake.batches[0]?.questions.map((q) => ({ questionId: q.id, status: "unknown" })),
  });
  await runCustomerJob(f, "intake_summary");
  if (confirmed) await confirmCustomerSummary(f);
  const calls: { path: string; query: string | null; corpus: string | null }[] = [];
  let upstream: Transport = async (url) =>
    json(new URL(url).pathname.endsWith("lawSearch.do") ? list : detail);
  let clock = f.now;
  const env = {
    ...f.owner.env,
    APPLICATION_COST_LIMITS_ENABLED: "false",
    LAW_API_OC: "synthetic-private-test",
    CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, ""),
    ANALYSIS_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
  } as Env;
  const app = new Hono<ApiEnvironment>().route(
    "/api/v2/cases",
    createPrecedentsApi({
      service: (core, env) =>
        createPrecedentResearchService(core, env, {
          clock: () => clock,
          transport: async (url, init) => {
            const u = new URL(url);
            calls.push({
              path: u.pathname,
              query: u.searchParams.get("query"),
              corpus: u.searchParams.get("datSrcNm"),
            });
            return upstream(url, init);
          },
        }),
    }),
  );
  const path = `/api/v2/cases/${f.workspace.id}/precedents`;
  const request = (
    suffix = "",
    body?: unknown,
    cookie = f.owner.cookie,
    origin = env.BETTER_AUTH_URL,
  ) =>
    app.request(
      path + suffix,
      {
        method: body === undefined ? "GET" : "POST",
        headers: { cookie, origin, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
    );
  const searchInput = async () => {
    const r = await request();
    expect(r.status).toBe(200);
    const c = v2PrecedentResearchContextSchema.parse(await r.json());
    return {
      expectedRevision: c.workspaceRevision,
      summaryRevision: c.summaryRevision,
      topics: ["contract"],
    };
  };
  return {
    ...f,
    env,
    path,
    app,
    request,
    searchInput,
    calls,
    upstream: (next: Transport) => {
      upstream = next;
    },
    clock: (next: string) => {
      clock = next;
    },
  };
}

test("confirmed case searches only public concepts, deduplicates verified originals, reads cached text without private bindings", async () => {
  const f = await fixture();
  const input = { ...(await f.searchInput()), topics: ["contract", "loan"] };
  const response = await f.request("/search", input);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const result = v2PrecedentSearchResponseSchema.parse(await response.json());
  expect(result.status).toBe("complete");
  expect(result.items).toHaveLength(1);
  expect(result.items[0]?.matchedTopics).toEqual(["contract", "loan"]);
  expect(f.calls.filter((c) => c.query).map((c) => [c.query, c.corpus])).toEqual([
    ["계약", "대법원"],
    ["대여금", "대법원"],
  ]);
  expect(f.calls.filter((c) => c.path.endsWith("lawService.do"))).toHaveLength(1);
  const before = f.calls.length;
  const first = result.items[0];
  if (!first) throw new Error("Missing verified synthetic precedent");
  const read = await f.request("/read", {
    expectedRevision: input.expectedRevision,
    readToken: first.readToken,
  });
  expect(read.status).toBe(200);
  const document = v2PrecedentReadResponseSchema.parse(await read.json());
  expect(document.citation).toEqual(first.citation);
  expect(document.excerpt.text).toContain("합성 전문");
  expect(f.calls).toHaveLength(before);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
    n: 0,
  });
  expect((await f.service.find(f.owner.userId, f.workspace.id)).workspaceRevision).toBe(
    input.expectedRevision,
  );
});

test("origin, session, owner, revision, confirmed summary and strict inputs deny before official requests", async () => {
  const f = await fixture();
  const input = await f.searchInput();
  const stranger = await seedTestSession(f.db, { consent: true });
  for (const [body, cookie, origin, status] of [
    [input, "", f.env.BETTER_AUTH_URL, 401],
    [input, stranger.cookie, f.env.BETTER_AUTH_URL, 404],
    [input, f.owner.cookie, "https://untrusted.example", 403],
    [
      { ...input, expectedRevision: input.expectedRevision + 1 },
      f.owner.cookie,
      f.env.BETTER_AUTH_URL,
      409,
    ],
    [
      { ...input, summaryRevision: input.summaryRevision + 1 },
      f.owner.cookie,
      f.env.BETTER_AUTH_URL,
      409,
    ],
    [{ ...input, narrative: "비공개 합성 진술" }, f.owner.cookie, f.env.BETTER_AUTH_URL, 400],
    [{ ...input, topics: ["arbitrary"] }, f.owner.cookie, f.env.BETTER_AUTH_URL, 400],
  ] as const)
    expect((await f.request("/search", body, cookie, origin)).status).toBe(status);
  expect(f.calls).toHaveLength(0);
  f.env.ANALYSIS_ACCOUNT_LIMIT = { limit: async () => ({ success: false }) };
  expect((await f.request("/search", input)).status).toBe(429);
  expect(f.calls).toHaveLength(0);
  const pending = await fixture(false);
  expect((await pending.request()).status).toBe(409);
  expect(pending.calls).toHaveLength(0);
});

test("empty, unavailable, partial and top-N coverage retain distinct meanings", async () => {
  const f = await fixture();
  const input = await f.searchInput();
  f.upstream(async () => json({ PrecSearch: { totalCnt: "0", page: "1", prec: [] } }));
  expect((await searchBody(await f.request("/search", input))).status).toBe("empty");
  f.upstream(async () => json({}, 403));
  expect((await searchBody(await f.request("/search", input))).status).toBe("unavailable");
  f.upstream(async (url) => {
    const u = new URL(url);
    return u.searchParams.get("query") === "대여금"
      ? json({}, 403)
      : json(
          u.pathname.endsWith("lawSearch.do")
            ? { PrecSearch: { ...list.PrecSearch, totalCnt: "200" } }
            : detail,
        );
  });
  const result = v2PrecedentSearchResponseSchema.parse(
    await (await f.request("/search", { ...input, topics: ["contract", "loan"] })).json(),
  );
  expect(result.status).toBe("partial");
  expect(result.unavailableTopics).toEqual(["loan"]);
  expect(result.searchTruncated).toBe(true);
  expect(result.items).toHaveLength(1);
});

test("signed reads reject altered, expired, foreign, stale and corrupt originals", async () => {
  const f = await fixture();
  const input = await f.searchInput();
  const result = await searchBody(await f.request("/search", input));
  const item = result.items[0];
  if (!item) throw new Error("Missing verified synthetic precedent");
  const read = (readToken = item.readToken) =>
    f.request("/read", { expectedRevision: input.expectedRevision, readToken });
  const [payload, signature] = item.readToken.split(".");
  if (!payload || !signature) throw new Error("Missing synthetic read proof");
  expect(
    (await read(`${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`)).status,
  ).toBe(404);
  const stranger = await seedTestSession(f.db, { consent: true });
  expect(
    (
      await f.request(
        "/read",
        { expectedRevision: input.expectedRevision, readToken: item.readToken },
        stranger.cookie,
      )
    ).status,
  ).toBe(404);
  f.clock(new Date(Date.parse(f.now) + 600000).toISOString());
  expect((await read()).status).toBe(404);
  f.clock(f.now);
  f.db.sqlite
    .query("UPDATE v2_official_sources SET body=? WHERE source_id=?")
    .run("변조된 합성 본문", item.citation.sourceId);
  expect((await read()).status).toBe(404);
  f.db.sqlite.query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?").run(f.workspace.id);
  expect((await read()).status).toBe(409);
});

test("missing credentials, cancellation and later limited observations cannot produce authoritative reads", async () => {
  const f = await fixture();
  const input = await f.searchInput();
  f.env.LAW_API_OC = "";
  expect((await searchBody(await f.request("/search", input))).status).toBe("unavailable");
  expect(f.calls).toHaveLength(0);
  f.env.LAW_API_OC = "synthetic-private-test";
  const result = await searchBody(await f.request("/search", input));
  const item = result.items[0];
  if (!item) throw new Error("Missing verified synthetic precedent");
  f.db.sqlite
    .query(
      "INSERT INTO v2_citation_bindings(id,workspace_id,source_id,snapshot_revision,citation_json) VALUES(?,?,?,?,?)",
    )
    .run(
      "synthetic-limited-binding",
      f.workspace.id,
      item.citation.sourceId,
      input.expectedRevision,
      JSON.stringify({ ...item.citation, _availability: "limited", _limitedAt: f.now }),
    );
  expect(
    (
      await f.request("/read", {
        expectedRevision: input.expectedRevision,
        readToken: item.readToken,
      })
    ).status,
  ).toBe(404);
  expect((await searchBody(await f.request("/search", input))).status).toBe("unavailable");
  const aborted = new AbortController();
  aborted.abort();
  const service = createPrecedentResearchService(f.core, f.env, {
    clock: () => f.now,
    transport: async () => {
      throw new Error("must not call after cancellation");
    },
  });
  await expect(
    service.search(f.owner.userId, f.workspace.id, input, aborted.signal),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
});

test("retries share the total twelve-request ceiling and preserve verified partial results", async () => {
  const f = await fixture();
  const input = await f.searchInput();
  const attempts = new Map<string, number>();
  f.upstream(async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("lawSearch.do")) {
      const offset = u.searchParams.get("query") === "대여금" ? 10 : 0;
      return json({
        PrecSearch: {
          ...list.PrecSearch,
          totalCnt: "3",
          prec: [0, 1, 2].map((n) => ({
            ...list.PrecSearch.prec[0],
            판례일련번호: String(90000000201 + n + offset),
          })),
        },
      });
    }
    const id = u.searchParams.get("ID") ?? "";
    const count = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, count);
    return count < 3
      ? json({}, 503)
      : json({ PrecService: { ...detail.PrecService, 판례정보일련번호: id } });
  });
  const result = await searchBody(
    await f.request("/search", { ...input, topics: ["contract", "loan"] }),
  );
  expect(f.calls).toHaveLength(12);
  expect(result.status).toBe("partial");
  expect(result.items).toHaveLength(3);
  expect(result.unavailableTopics).toEqual(["loan"]);
});

for (const race of ["revision", "consent", "role", "deletion"] as const)
  test(`in-flight ${race} changes suppress result and further external requests`, async () => {
    const f = await fixture();
    const input = await f.searchInput();
    f.upstream(async () => {
      if (race === "revision")
        f.db.sqlite
          .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
          .run(f.workspace.id);
      if (race === "consent")
        f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
      if (race === "role")
        f.db.sqlite
          .query("INSERT INTO app_metadata(key,value,updated_at) VALUES(?, 'lawyer',?)")
          .run(`account-type:${f.owner.userId}`, f.now);
      if (race === "deletion")
        f.db.sqlite
          .query(
            "INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('workspace',?,?)",
          )
          .run(f.workspace.id, f.now);
      return json(list);
    });
    const response = await f.request("/search", input);
    expect(response.status).toBe(race === "revision" ? 409 : race === "consent" ? 403 : 404);
    expect(f.calls).toHaveLength(1);
    const body = await response.text();
    expect(body).not.toContain("合成");
    expect(body).not.toContain("readToken");
  });

test("research proofs have purpose-separated integrity, exact TTL and no future acceptance", async () => {
  const secret = "synthetic-research-secret-at-least-32-characters";
  const claims: ResearchClaims = {
    ownerId: "synthetic-owner",
    workspaceId: "synthetic-case",
    revision: 1,
    sourceId: "synthetic-source",
    citationId: "synthetic-citation",
    citationHash: "a".repeat(64),
    verifiedAt: "2026-10-21T00:00:00.000Z",
    issuedAt: 1000,
    expiresAt: 601000,
  };
  const token = await signResearchToken(secret, claims);
  expect(await verifyResearchToken(secret, token, 1000)).toEqual(claims);
  expect(await verifyResearchToken(secret, token, 999)).toBeNull();
  expect(await verifyResearchToken(secret, token, 601000)).toBeNull();
  expect(await verifyResearchToken(`${secret}different`, token, 1000)).toBeNull();
  expect(await verifyResearchToken(secret, "a".repeat(4097), 1000)).toBeNull();
  expect(
    await verifyResearchToken(
      secret,
      await signResearchToken(secret, { ...claims, expiresAt: 601001 }),
      1000,
    ),
  ).toBeNull();
});

test("topic suggestions exclude cited law text and excerpts preserve exact Unicode spans", () => {
  expect(
    recommendPrecedentTopics({
      ...summary,
      overview: "보증금과 월급, 계약에 관한 사용자 진술",
      facts: [],
    }),
  ).toEqual(["lease", "wages", "contract"]);
  const body = `  ${"가".repeat(499)}😀 임대차 ${"나".repeat(500)}  `;
  const excerpt = researchExcerpt(body, ["임대차"]);
  expect(excerpt.text).toBe(body.slice(excerpt.startUtf16, excerpt.endUtf16));
  expect(excerpt.text).toContain("임대차");
  expect(excerpt.text).not.toMatch(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/,
  );
});
