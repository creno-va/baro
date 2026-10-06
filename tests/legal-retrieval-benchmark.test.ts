import { expect, test } from "bun:test";
import { loadFactory, variants } from "../scripts/benchmarks/retrieval/candidates";
import {
  AS_OF,
  fingerprint,
  fixture,
  plan,
  runSample,
  syntheticList,
  verify,
} from "../scripts/benchmarks/retrieval/harness";

for (const variant of variants) {
  test(`${variant}: actual SQLite/hash/date output equals unmodified retrieval`, async () => {
    const baseline = await loadFactory("baseline"),
      factory = await loadFactory(variant);
    for (const scenario of [
      "cold-multi",
      "warm-multi",
      "cold-overlap",
      "warm-overlap",
      "expired-cache",
      "retry-429",
      "timeout-recover",
      "timeout-terminal",
      "duplicate-rejected",
    ] as const) {
      const before = await runSample(baseline, scenario, 0, "article");
      const after = await runSample(factory, scenario, 0, "article");
      expect(after.signature).toBe(before.signature);
      expect(after.upstreamResponseBytes).toBeLessThanOrEqual(before.upstreamResponseBytes);
      expect(after.peakInFlight).toBeLessThanOrEqual(variant === "concurrency-2" ? 2 : 1);
    }
  });
  test.each(["identity", "future-date", "schema"])(
    `${variant}: %s mutation cannot issue sources`,
    async (mode) => {
      const f = await fixture(await loadFactory(variant), {
        mutate: (value, list) => {
          if (list) return value;
          const detail = value as {
            법령: { 기본정보: { 법령ID: string }; 조문: { 조문단위: { 조문시행일자: string }[] } };
          };
          if (mode === "identity") detail.법령.기본정보.법령ID = "9999";
          else if (mode === "future-date")
            for (const row of detail.법령.조문.조문단위) row.조문시행일자 = "20990101";
          else return {};
          return detail;
        },
      });
      try {
        f.start();
        const output = await f.service.retrieve(f.input(), f.access);
        expect(output.chunks).toEqual([]);
        expect(output.outcomes[0]?.reason).toBe(
          mode === "identity"
            ? "identity_mismatch"
            : mode === "future-date"
              ? "date_invalid"
              : "schema_mismatch",
        );
        expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
          n: 0,
        });
      } finally {
        f.db.close();
      }
    },
  );
}
test.each(["body", "canonical_url", "source_date"])(
  "recommended patch rejects cached %s corruption",
  async (column) => {
    const f = await fixture(await loadFactory("list-dedup"));
    try {
      const first = await f.service.retrieve(f.input([plan(["598"])]), f.access);
      const source = first.chunks[0]?.source;
      expect(source).toBeDefined();
      f.db.sqlite
        .query(`UPDATE v2_official_sources SET ${column}=? WHERE source_id=?`)
        .run(
          column === "body"
            ? "합성 변조"
            : column === "source_date"
              ? "2099-01-01"
              : "https://evil.test/",
          source?.sourceId ?? "",
        );
      const second = await f.service.retrieve(f.input([plan(["598"])]), f.access);
      expect(second.chunks).toEqual([]);
      expect(second.outcomes[0]?.reason).toBe("cache_invalid");
      expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
        n: 1,
      });
    } finally {
      f.db.close();
    }
  },
);
test("memo is request-local; different query ID has its own list; fresh citation IDs still bind", async () => {
  const f = await fixture(await loadFactory("list-dedup"));
  try {
    f.start();
    const plans = [plan(["598", "600"]), plan(["600", "603"])];
    const one = await f.service.retrieve(f.input(plans), f.access);
    const two = await f.service.retrieve(f.input(plans), f.access);
    expect(f.metrics().listCalls).toBe(2);
    expect(JSON.parse(fingerprint(one))).toEqual(JSON.parse(fingerprint(two)));
    expect(
      new Set([...one.outcomes, ...two.outcomes].flatMap((o) => o.chunks.map((c) => c.citation.id)))
        .size,
    ).toBe(8);
    const distinct = await f.service.retrieve(
      f.input([plan(["598"]), { ...plan(["603"]), lawId: "1706" }]),
      f.access,
    );
    await verify(distinct);
    expect(f.metrics().listCalls).toBe(4);
    const oldDate = await f.service.retrieve({ ...f.input(), asOfDate: "2020-01-01" }, f.access);
    expect(oldDate.chunks).toEqual([]);
    expect(f.metrics().listCalls).toBe(5);
  } finally {
    f.db.close();
  }
});
test("failed history validation is not memoized for a later overlapping plan", async () => {
  let lists = 0;
  const f = await fixture(await loadFactory("list-dedup"), {
    mutate: (value, list) =>
      list && ++lists === 1 ? { LawSearch: { ...syntheticList.LawSearch, totalCnt: 101 } } : value,
  });
  try {
    f.start();
    const output = await f.service.retrieve(
      f.input([plan(["598", "600"]), plan(["600", "603"])]),
      f.access,
    );
    expect(output.outcomes[0]?.reason).toBe("history_incomplete");
    expect(output.outcomes[1]?.availability).toBe("verified");
    expect(f.metrics().listCalls).toBe(2);
  } finally {
    f.db.close();
  }
});
test.each(["revoke", "cancel"])(
  "memo hit repeats guard after query authorization: %s",
  async (mode) => {
    const f = await fixture(await loadFactory("list-dedup"));
    try {
      let queries = 0;
      const controller = new AbortController();
      f.access.signal = controller.signal;
      f.access.authorizeQuery = async () => {
        if (++queries === 2) {
          if (mode === "cancel") controller.abort();
          else f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
        }
        return true;
      };
      f.start();
      const output = await f.service.retrieve(
        f.input([plan(["598", "600"]), plan(["600", "603"])]),
        f.access,
      );
      expect(output.chunks).toEqual([]);
      expect(
        output.outcomes.every(
          (o) => o.reason === (mode === "cancel" ? "cancelled" : "not_authorized"),
        ),
      ).toBe(true);
      expect(f.metrics().listCalls).toBe(1);
      expect(f.metrics().detailCalls).toBe(2);
      expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
        n: 2,
      });
    } finally {
      f.db.close();
    }
  },
);
test("original three-attempt retry reservation sequence is retained", async () => {
  const factory = await loadFactory("list-dedup");
  const f = await fixture(factory, { scenario: "retry-429" });
  try {
    const seen: Parameters<typeof f.access.reserveRequest>[0][] = [];
    f.access.reserveRequest = async (attempt) => {
      seen.push(attempt);
      return true;
    };
    const output = await f.service.retrieve(f.input(), f.access);
    expect(output.asOfDate).toBe(AS_OF);
    expect(output.legalSourceStatus).toBe("verified");
    const groups = Map.groupBy(seen, (a) => a.invocationId);
    expect([...groups.values()].map((a) => a.map((r) => r.attempt))).toEqual([
      [1],
      [1],
      [1, 2, 3],
      [1],
    ]);
    expect(seen.length).toBe(6);
  } finally {
    f.db.close();
  }
});

test("expired source plus terminal upstream failure cannot return stale original", async () => {
  const config: { scenario?: "timeout-terminal" } = {};
  const f = await fixture(await loadFactory("list-dedup"), config);
  try {
    const prime = await f.service.retrieve(f.input(), f.access);
    expect(prime.chunks.length).toBe(3);
    f.guard.now = "2026-10-07T00:00:00.001Z";
    config.scenario = "timeout-terminal";
    f.start();
    const failed = await f.service.retrieve(f.input(), f.access);
    expect(failed.chunks).toEqual([]);
    expect(failed.outcomes[0]?.reason).toBe("timeout");
    expect(f.metrics().calls).toBe(5);
    expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
      n: 3,
    });
  } finally {
    f.db.close();
  }
});
test("request reservation denial preserves budget failure without another transport call", async () => {
  const f = await fixture(await loadFactory("list-dedup"));
  try {
    let attempts = 0;
    f.access.reserveRequest = async () => ++attempts <= 2;
    f.start();
    const failed = await f.service.retrieve(f.input(), f.access);
    expect(failed.chunks).toEqual([]);
    expect(failed.outcomes[0]?.reason).toBe("budget_exhausted");
    expect(f.metrics().calls).toBe(2);
    expect(attempts).toBe(3);
    expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
      n: 0,
    });
  } finally {
    f.db.close();
  }
});
