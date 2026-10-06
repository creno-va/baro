import assert from "node:assert/strict";
import { createCaseDataCipher } from "../../../src/server/crypto";
import { createV2Core } from "../../../src/server/db/v2-core";
import { createV2OfficialSourceRepository } from "../../../src/server/db/v2-official-sources";
import { createV2WorkspaceRepository } from "../../../src/server/db/v2-workspace";
import { textHash } from "../../../src/server/modules/legal-retrieval/service";
import { createWorkspaceSourceAuthorization } from "../../../src/server/modules/legal-retrieval/v2/authorization";
import type {
  Access,
  RetrievalOutput,
} from "../../../src/server/modules/legal-retrieval/v2/contracts";
import { createTestDatabase } from "../../../tests/helpers/d1";
import { seedTestSession } from "../../../tests/helpers/session";
import type { Factory, ParseCounters } from "./candidates";

export const NOW = "2026-10-06T00:00:00.000Z";
export const AS_OF = "2026-10-06";
export const syntheticList = {
  LawSearch: {
    totalCnt: 1,
    law: [
      {
        법령ID: "1706",
        법령일련번호: "284415",
        법령명한글: "합성 성능 법령",
        시행일자: "20260317",
        공포일자: "20260317",
        공포번호: "21454",
      },
    ],
  },
};
export const syntheticDetail = {
  법령: {
    기본정보: {
      법령ID: "1706",
      법령명_한글: "합성 성능 법령",
      시행일자: "20260317",
      공포일자: "20260317",
      공포번호: "21454",
    },
    조문: {
      조문단위: ["598", "600", "603"].map((number) => ({
        조문번호: number,
        조문가지번호: "0",
        조문여부: "조문",
        조문시행일자: "20260317",
        조문내용: `제${number}조 합성 benchmark 전용 본문입니다. 법률 적용의 근거가 아닙니다.`,
      })),
    },
  },
};
export const plan = (numbers: string[]) => ({
  kind: "statute",
  lawTitle: "합성 성능 법령",
  articles: numbers.map((number) => ({ number, branch: "0" })),
});
export const scenarios = [
  "cold-single",
  "cold-multi",
  "warm-multi",
  "cold-overlap",
  "warm-overlap",
  "expired-cache",
  "retry-429",
  "timeout-recover",
  "timeout-terminal",
  "duplicate-rejected",
] as const;
export type Scenario = (typeof scenarios)[number];
export type Shape = "article" | "full";
type Interval = [number, number];
function unionMs(intervals: Interval[]) {
  let total = 0,
    end = -Infinity;
  for (const [a, b] of [...intervals].sort((x, y) => x[0] - y[0])) {
    total += Math.max(0, b - Math.max(a, end));
    end = Math.max(end, b);
  }
  return total;
}
export function fingerprint(output: RetrievalOutput) {
  return JSON.stringify({
    asOfDate: output.asOfDate,
    status: output.legalSourceStatus,
    hash: output.retrievalHash,
    outcomes: output.outcomes.map((o) => ({
      ...o,
      chunks: o.chunks.map(({ citation, source, ...rest }) => ({
        ...rest,
        source,
        citation: { ...citation, id: "independent-citation" },
      })),
    })),
  });
}
export async function verify(output: RetrievalOutput) {
  assert.equal(output.asOfDate, AS_OF);
  assert.equal(
    output.retrievalHash,
    await textHash(JSON.stringify(output.chunks.map((c) => c.citation.sourceId))),
  );
  for (const { source, citation, span } of output.chunks) {
    assert.equal(source.officialId, "1706");
    assert.equal(source.version, "284415");
    assert.equal(source.sourceDate, "2026-03-17");
    assert.equal(source.contentHash, await textHash(source.body));
    assert.equal(source.contentHash, citation.contentHash);
    assert.equal(source.sourceId, citation.sourceId);
    assert.equal(
      source.sourceId,
      `source_${await textHash(JSON.stringify([source.sourceType, source.officialId, source.version, source.section, source.contentHash, source.extractorVersion]))}`,
    );
    assert.equal(source.canonicalUrl, "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=284415");
    assert.equal(citation.url, source.canonicalUrl);
    assert.equal(source.sourceDate <= AS_OF, true);
    assert.equal(Date.parse(source.expiresAt) - Date.parse(source.verifiedAt), 86400000);
    assert.equal(span.text, source.body);
    assert.equal(span.endUtf16, source.body.length);
  }
}
export async function fixture(
  factory: Factory,
  config: {
    delayMs?: number;
    shape?: Shape;
    scenario?: Scenario;
    mutate?: (value: unknown, list: boolean) => unknown;
  } = {},
) {
  const db = await createTestDatabase();
  let measuring = false,
    reads = 0,
    writes = 0;
  const originals = new WeakMap<object, D1PreparedStatement>();
  function record(sql: string) {
    if (measuring) {
      if (/^SELECT\b/i.test(sql.trim())) reads++;
      else writes++;
    }
  }
  function wrap(original: D1PreparedStatement, sql: string): D1PreparedStatement {
    const proxy = new Proxy(original, {
      get(target, key) {
        if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values), sql);
        if (["first", "all", "raw", "run"].includes(String(key)))
          return (...args: unknown[]) => {
            record(sql);
            const fn = Reflect.get(target, key) as (...args: unknown[]) => unknown;
            return fn.apply(target, args);
          };
        return Reflect.get(target, key);
      },
    });
    originals.set(proxy, original);
    return proxy;
  }
  const batchSql = new WeakMap<object, string>();
  const binding = {
    prepare(sql: string) {
      const statement = wrap(db.binding.prepare(sql), sql);
      // Bound proxies are used in batches; recover SQL using an outer proxy.
      function tagged(s: D1PreparedStatement): D1PreparedStatement {
        const proxy = new Proxy(s, {
          get(target, key) {
            if (key === "bind") return (...args: unknown[]) => tagged(target.bind(...args));
            return Reflect.get(target, key);
          },
        });
        originals.set(proxy, originals.get(s) ?? s);
        batchSql.set(proxy, sql);
        return proxy;
      }
      return tagged(statement);
    },
    batch(statements: D1PreparedStatement[]) {
      for (const s of statements) record(batchSql.get(s) ?? "BATCH_WRITE");
      return db.binding.batch(statements.map((s) => originals.get(s) ?? s));
    },
  } as unknown as D1Database;
  const owner = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("b".repeat(32)).replace(/=+$/, ""),
  });
  const core = createV2Core(binding, cipher),
    ws = createV2WorkspaceRepository(binding, cipher);
  const workspaceId = crypto.randomUUID();
  assert.equal(
    (
      await ws.create(
        { ownerId: owner.userId, now: NOW },
        workspaceId,
        {
          narrative: "합성 성능 시험 입력입니다. 실제 사건과 개인정보는 없습니다.",
          subjectContext: "individual",
          jurisdiction: "KR",
          turnstileToken: "synthetic",
        },
        { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: "a".repeat(64) },
      )
    ).kind,
    "created",
  );
  const guard = { ownerId: owner.userId, now: NOW, workspaceId, expectedRevision: 1 };
  const repo = createV2OfficialSourceRepository(core);
  const counters: ParseCounters = { jsonParses: 0, jsonReuseHits: 0, articleParses: 0 };
  let calls = 0,
    listCalls = 0,
    detailCalls = 0,
    bytes = 0,
    active = 0,
    peak = 0,
    backoffConfiguredMs = 0;
  const attempts: Parameters<Access["reserveRequest"]>[0][] = [],
    upstreamIntervals: Interval[] = [],
    deadlineIntervals: Interval[] = [];
  const invocationCounts = new Map<string, number>();
  const access: Access = {
    authorize: createWorkspaceSourceAuthorization(binding, guard),
    authorizeQuery: async () => true,
    reserveRequest: async (attempt) => {
      if (measuring) attempts.push(attempt);
      return true;
    },
  };
  const transport = async (url: string, init: RequestInit) => {
    const u = new URL(url),
      list = u.pathname.endsWith("lawSearch.do"),
      key = list ? "list" : (u.searchParams.get("JO") ?? "");
    const nth = (invocationCounts.get(key) ?? 0) + 1;
    invocationCounts.set(key, nth);
    if (measuring) {
      calls++;
      if (list) listCalls++;
      else detailCalls++;
      active++;
      peak = Math.max(peak, active);
    }
    try {
      if (
        !list &&
        key === "060000" &&
        ((config.scenario === "timeout-recover" && nth === 1) ||
          config.scenario === "timeout-terminal")
      ) {
        const start = performance.now();
        try {
          await new Promise<void>((_, reject) => {
            const cancel = () => reject(new Error("synthetic timeout"));
            if (init.signal?.aborted) cancel();
            else init.signal?.addEventListener("abort", cancel, { once: true });
          });
        } finally {
          if (measuring) deadlineIntervals.push([start, performance.now()]);
        }
      }
      if ((config.delayMs ?? 0) > 0) {
        const start = performance.now();
        await new Promise<void>((resolve) => setTimeout(resolve, config.delayMs));
        if (measuring) upstreamIntervals.push([start, performance.now()]);
      }
      const throttled = !list && key === "060000" && config.scenario === "retry-429" && nth < 3;
      const value = list
        ? syntheticList
        : throttled
          ? {}
          : config.shape === "full"
            ? syntheticDetail
            : {
                법령: {
                  ...syntheticDetail.법령,
                  조문: {
                    조문단위: syntheticDetail.법령.조문.조문단위.filter(
                      (r) => r.조문번호 === String(Number(key.slice(0, 4))),
                    ),
                  },
                },
              };
      const raw = JSON.stringify(
        config.mutate ? config.mutate(structuredClone(value), list) : value,
      );
      if (measuring) bytes += new TextEncoder().encode(raw).byteLength;
      return new Response(raw, {
        status: throttled ? 429 : 200,
        headers: { "content-type": "application/json" },
      });
    } finally {
      if (measuring) active--;
    }
  };
  const service = factory({ LAW_API_OC: "synthetic-benchmark-only" }, repo, {
    transport,
    timeoutMs: 20,
    sleep: async (ms) => {
      // Backoff is virtual: record configured delay, no artificial sleep here.
      if (measuring) {
        backoffConfiguredMs += ms;
      }
    },
    bindCitation: (c) => repo.bindCitation(guard, c),
    benchmarkCounters: counters,
  });
  const input = (plans: unknown[] = [plan(["598", "600", "603"])]) => ({
    asOfDate: AS_OF,
    now: guard.now,
    plans,
  });
  return {
    db,
    binding,
    guard,
    repo,
    access,
    service,
    input,
    owner,
    start() {
      measuring = true;
      counters.jsonParses = counters.jsonReuseHits = counters.articleParses = 0;
      invocationCounts.clear();
    },
    metrics() {
      return {
        calls,
        listCalls,
        detailCalls,
        dbReads: reads,
        dbWrites: writes,
        upstreamResponseBytes: bytes,
        peakInFlight: peak,
        reservations: attempts.length,
        backoffConfiguredMs,
        injectedLatencyWaitSumMs: upstreamIntervals.reduce((s, [a, b]) => s + b - a, 0),
        timeoutWaitSumMs: deadlineIntervals.reduce((s, [a, b]) => s + b - a, 0),
        upstreamWaitSumMs: [...upstreamIntervals, ...deadlineIntervals].reduce(
          (s, [a, b]) => s + b - a,
          0,
        ),
        waitWallMs: unionMs([...upstreamIntervals, ...deadlineIntervals]),
        ...counters,
      };
    },
  };
}
export async function runSample(
  factory: Factory,
  scenario: Scenario,
  delayMs: number,
  shape: Shape,
) {
  const f = await fixture(factory, { scenario, delayMs, shape });
  try {
    const overlap = scenario.includes("overlap"),
      plans =
        scenario === "cold-single"
          ? [plan(["598"])]
          : overlap
            ? [plan(["598", "600"]), plan(["600", "603"])]
            : [plan(["598", "600", "603"])];
    if (scenario.startsWith("warm") || scenario === "expired-cache") {
      const prime = await f.service.retrieve(f.input(plans), f.access);
      await verify(prime);
      assert.equal(prime.legalSourceStatus, "verified");
      if (scenario === "expired-cache") f.guard.now = "2026-10-07T00:00:00.001Z";
    }
    f.start();
    const queryStart = f.db.queryCount,
      start = performance.now();
    let output: RetrievalOutput | null = null,
      rejected = false;
    try {
      output = await f.service.retrieve(
        f.input(scenario === "duplicate-rejected" ? [plan(["598"]), plan(["598"])] : plans),
        f.access,
      );
    } catch {
      rejected = true;
    }
    const wallMs = performance.now() - start,
      dbQueries = f.db.queryCount - queryStart,
      metrics = f.metrics();
    assert.equal(dbQueries, metrics.dbReads + metrics.dbWrites);
    assert.equal(metrics.calls, metrics.reservations);
    if (scenario === "duplicate-rejected") {
      assert.equal(rejected, true);
      assert.equal(metrics.calls, 0);
    } else {
      assert.ok(output);
      await verify(output);
      if (scenario === "timeout-terminal") {
        assert.equal(output.legalSourceStatus, "unavailable");
        assert.equal(output.outcomes[0]?.reason, "timeout");
        assert.equal(output.chunks.length, 0);
      } else assert.equal(output.legalSourceStatus, "verified");
    }
    return {
      scenario,
      delayMs,
      shape,
      wallMs,
      dbQueries,
      ...metrics,
      nonWaitingWallMs: Math.max(0, wallMs - metrics.waitWallMs),
      outputBytes: output ? new TextEncoder().encode(JSON.stringify(output)).byteLength : 0,
      rejection: rejected,
      signature: output ? fingerprint(output) : "rejected",
      integrity: "pass",
    };
  } finally {
    f.db.close();
  }
}
