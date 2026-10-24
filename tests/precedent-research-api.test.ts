import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { modelBounds, observationSchema, provisionAiRuntime } from "../scripts/provision-ai-budget";
import { v2AcceptedOperationSchema } from "../src/contracts/v2";
import {
  PRECEDENT_COMPARISON_CRITERIA,
  v2PrecedentComparisonStateSchema,
} from "../src/contracts/v2/precedent-comparison";
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
import type { WorkspaceParams } from "../src/server/modules/workspace/execution";
import { createWorkspaceDependencies, runWorkspaceRuntime } from "../src/server/runtime/workspace";
import { summary } from "./fixtures/contracts/v2";
import precedents from "./fixtures/legal/v2/precedents.json";
import {
  confirmCustomerSummary,
  customerWorkspaceFixture,
  runCustomerJob,
} from "./helpers/customer-workspace";
import { createTestDatabase } from "./helpers/d1";
import { syntheticGatewayInput } from "./helpers/gateway-input";
import observation from "./helpers/gemini-observation";
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
      workspaceDependencies: async (env, core) => createWorkspaceDependencies(core, env),
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

async function comparisonFixture() {
  const f = await fixture();
  const other = await createTestDatabase();
  databases.push(other);
  const now = new Date().toISOString();
  const o = observationSchema.parse({
    ...observation,
    checkedAt: now,
    validUntil: new Date(Date.now() + 86400000).toISOString(),
  });
  const proofs = await provisionAiRuntime({ preview: f.db.binding, production: other.binding }, o);
  let dispatch: { id: string; params: WorkspaceParams } | null = null;
  const phases: string[] = [];
  let auditPass = true;
  let beforeAudit: (() => void) | undefined;
  Object.assign(f.env, {
    AI_GATEWAY_ID: "baro-preview",
    AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(modelBounds(o, proofs.evidenceHash)),
    WORKSPACE_PROCESSING: {
      get: async () => {
        throw new Error("Synthetic absent workflow");
      },
      create: async (input: { id: string; params: WorkspaceParams }) => {
        dispatch = input;
        return { id: input.id, status: async () => ({ status: "queued" }) };
      },
    },
    AI: {
      run: async (model: string, input: Record<string, unknown>) => {
        expect(model).toBe("google/gemini-3.8-flash");
        const wire = syntheticGatewayInput(input);
        phases.push(wire.phase);
        expect(JSON.stringify(input)).not.toContain('"readToken"');
        expect(JSON.stringify(input)).not.toContain("synthetic_research_receipt");
        expect(input).toMatchObject({
          generationConfig: {
            thinkingConfig: { thinkingLevel: wire.phase === "workspace_audit" ? "MEDIUM" : "LOW" },
          },
        });
        if (wire.phase === "workspace_audit") beforeAudit?.();
        const output =
          wire.phase === "workspace_audit"
            ? {
                pass: auditPass,
                findings: [],
                unsupportedFactIds: [],
                legalClaimsSupported: true,
                strategyDetected: false,
              }
            : {
                metrics: Object.keys(PRECEDENT_COMPARISON_CRITERIA).map((criterion) => ({
                  criterion,
                  verdict: "unknown",
                  explanation: "현재 제공된 자료만으로는 이 항목의 일치 여부를 확인할 수 없어요.",
                  caseEvidence: [],
                  precedentEvidence: [],
                })),
              };
        return {
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ output }) } }],
          usage: { prompt_tokens: 20, completion_tokens: 30 },
        };
      },
    },
  });
  const source = await searchBody(await f.request("/search", await f.searchInput()));
  const first = source.items[0];
  if (!first) throw new Error("Missing synthetic comparison source");
  const body = {
    expectedRevision: source.workspaceRevision,
    summaryRevision: source.summaryRevision,
    readToken: first.readToken,
  };
  const submit = (key = crypto.randomUUID(), input = body, cookie = f.owner.cookie) =>
    f.app.request(
      `${f.path}/compare`,
      {
        method: "POST",
        headers: {
          cookie,
          origin: f.env.BETTER_AUTH_URL,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body: JSON.stringify(input),
      },
      f.env,
    );
  return {
    ...f,
    body,
    submit,
    phases,
    rejectAudit: () => {
      auditPass = false;
    },
    beforeAudit: (callback: () => void) => {
      beforeAudit = callback;
    },
    async execute() {
      if (!dispatch) throw new Error("No comparison dispatched");
      const current = dispatch as { id: string; params: WorkspaceParams };
      const pending: Promise<void>[] = [];
      const result = await runWorkspaceRuntime(f.env, current.params, current.id, (task) =>
        pending.push(task),
      );
      await Promise.all(pending);
      return result;
    },
  };
}

test("comparison uses normal paid chat admission, native generation plus audit, private result and idempotent recovery", async () => {
  const f = await comparisonFixture();
  const key = crypto.randomUUID();
  const accepted = await f.submit(key);
  expect(accepted.status).toBe(202);
  const job = v2AcceptedOperationSchema.parse(await accepted.json());
  expect(f.phases).toEqual([]);
  const pending = await f.request(`/comparisons/${job.jobId}`);
  expect(v2PrecedentComparisonStateSchema.parse(await pending.json()).comparison).toBeNull();
  const result = await f.execute();
  expect(result.status).toBe("completed");
  expect(f.phases).toEqual(["workspace_precedent_compare", "workspace_audit"]);
  const response = await f.request(`/comparisons/${job.jobId}`);
  expect(response.status).toBe(200);
  const value = v2PrecedentComparisonStateSchema.parse(await response.json());
  expect(value.stale).toBe(false);
  expect(value.comparison).toMatchObject({
    matchedCount: 0,
    knownCount: 0,
    percentage: 0,
    basedOnWorkspaceRevision: f.body.expectedRevision,
  });
  expect(value.comparison?.metrics).toHaveLength(8);
  const messages = await f.service.messages(f.owner.userId, f.workspace.id);
  expect(JSON.stringify(messages)).not.toContain("readToken");
  expect(JSON.stringify(messages)).not.toContain("precedentComparison");
  const replay = await f.submit(key);
  expect(replay.status).toBe(202);
  expect(v2AcceptedOperationSchema.parse(await replay.json()).jobId).toBe(job.jobId);
  expect(f.phases).toHaveLength(2);
});

test("forged source, stale summary and foreign jobs are refused before model dispatch", async () => {
  const f = await comparisonFixture();
  expect(
    (await f.submit(undefined, { ...f.body, summaryRevision: f.body.summaryRevision + 1 })).status,
  ).toBe(409);
  expect((await f.submit(undefined, { ...f.body, readToken: `${f.body.readToken}x` })).status).toBe(
    404,
  );
  expect(f.phases).toEqual([]);
  expect((await f.submit()).status).toBe(202);
  expect((await f.request("/comparisons/synthetic-foreign-job")).status).toBe(404);
});

test("failed independent comparison audit never publishes a result or exposes a generic replay button", async () => {
  const f = await comparisonFixture();
  f.rejectAudit();
  const accepted = v2AcceptedOperationSchema.parse(await (await f.submit()).json());
  expect((await f.execute()).status).toBe("failed");
  const response = await f.request(`/comparisons/${accepted.jobId}`);
  const state = v2PrecedentComparisonStateSchema.parse(await response.json());
  expect(state.comparison).toBeNull();
  expect(state.job.retryable).toBe(false);
  const messages = await f.service.messages(f.owner.userId, f.workspace.id);
  expect(messages.filter((m) => m.role === "assistant")).toHaveLength(0);
});

test("an official source revoked after audit cannot cross the existing atomic publication fence", async () => {
  const f = await comparisonFixture();
  f.beforeAudit(() => {
    f.db.sqlite
      .query(
        "UPDATE v2_citation_bindings SET citation_json=json_set(citation_json,'$._availability','limited','$._limitedAt',?)",
      )
      .run(new Date().toISOString());
  });
  const accepted = v2AcceptedOperationSchema.parse(await (await f.submit()).json());
  const result = await f.execute();
  expect(result).toMatchObject({
    status: "failed",
    publicationFailure: { reason: "reference_unauthorized" },
  });
  const state = v2PrecedentComparisonStateSchema.parse(
    await (await f.request(`/comparisons/${accepted.jobId}`)).json(),
  );
  expect(state.comparison).toBeNull();
  expect(f.phases).toEqual(["workspace_precedent_compare", "workspace_audit"]);
  expect(
    f.db.sqlite
      .query(
        "SELECT transport FROM v2_execution_admissions WHERE service='model' ORDER BY created_at",
      )
      .all(),
  ).toEqual([{ transport: "response" }, { transport: "response" }]);
});

test("a completed comparison becomes historical after case changes and remains owner-only", async () => {
  const f = await comparisonFixture();
  const accepted = v2AcceptedOperationSchema.parse(await (await f.submit()).json());
  expect((await f.execute()).status).toBe("completed");
  const stranger = await seedTestSession(f.db, { consent: true });
  expect(
    (await f.request(`/comparisons/${accepted.jobId}`, undefined, stranger.cookie)).status,
  ).toBe(404);
  f.db.sqlite.query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?").run(f.workspace.id);
  const value = v2PrecedentComparisonStateSchema.parse(
    await (await f.request(`/comparisons/${accepted.jobId}`)).json(),
  );
  expect(value.stale).toBe(true);
  expect(value.comparison?.basedOnWorkspaceRevision).toBe(f.body.expectedRevision);
  expect(f.phases).toHaveLength(2);
});

test("source corruption between admission and execution never dispatches a model", async () => {
  const f = await comparisonFixture();
  const accepted = v2AcceptedOperationSchema.parse(await (await f.submit()).json());
  f.db.sqlite
    .query("UPDATE v2_official_sources SET body=? WHERE source_type='precedent'")
    .run("변조된 합성 본문");
  expect((await f.execute()).status).toBe("failed");
  expect(f.phases).toHaveLength(0);
  const value = v2PrecedentComparisonStateSchema.parse(
    await (await f.request(`/comparisons/${accepted.jobId}`)).json(),
  );
  expect(value.comparison).toBeNull();
});
