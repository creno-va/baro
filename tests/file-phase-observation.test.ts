import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { productBoundaryFindings } from "../scripts/product-boundaries";
import { createFilePhaseObservation } from "../src/server/modules/file-processing/phase-observation";
import type { PrivateBucket } from "../src/server/modules/files/service";

const logs: Record<string, unknown>[] = [];
let log: ReturnType<typeof spyOn<typeof console, "info">>;
beforeEach(() => {
  log = spyOn(console, "info").mockImplementation((value) => logs.push(JSON.parse(value)));
});
afterEach(() => {
  log.mockRestore();
  logs.length = 0;
});

function fixture(clock?: () => number) {
  let time = 1_800_000_000_000;
  const calls: string[] = [];
  const result = { results: [], success: true, meta: {} } as unknown as D1Result<
    Record<string, unknown>
  >;
  const statement = {
    bind: () => statement,
    first: async () => {
      calls.push("first");
      time += 3;
      return null;
    },
    all: async () => {
      calls.push("all");
      time += 5;
      return result;
    },
  } as unknown as D1PreparedStatement;
  const database = {
    prepare: () => statement,
    batch: async (statements: D1PreparedStatement[]) => {
      expect(statements).toEqual([statement, statement]);
      calls.push("batch");
      time += 7;
      return [result, result];
    },
  } as unknown as D1Database;
  const object = { body: new Response("synthetic private bytes").body } as R2ObjectBody;
  const bucketCalls: unknown[][] = [];
  const bucket = Object.fromEntries(
    ["get", "head", "put", "delete"].map((method) => [
      method,
      async (...args: unknown[]) => {
        calls.push(method);
        bucketCalls.push(args);
        time += 11;
        return object;
      },
    ]),
  ) as unknown as PrivateBucket;
  const observed = createFilePhaseObservation(database, bucket, "preview", clock ?? (() => time));
  if (!observed) throw new Error("Missing fixture observation");
  return { observed, database, statement, result, bucket, object, calls, bucketCalls };
}

test("epoch-clock timing counts existing native D1/R2 awaits once, preserving body and options", async () => {
  const f = fixture();
  const s = f.observed.database.prepare("private synthetic SQL").bind("private parameter");
  const options = { range: { offset: 1, length: 3 } };
  const value = {};
  expect(
    await f.observed.measure("prepare_publication", async () => {
      expect(await s.first()).toBeNull();
      expect(await s.all()).toBe(f.result);
      expect(await f.observed.database.batch([s, s])).toEqual([f.result, f.result]);
      expect(await f.observed.bucket.get("private key", options)).toBe(f.object);
      expect(await f.observed.bucket.head("private key")).toBe(f.object);
      const body = new Uint8Array([1]);
      expect(await f.observed.bucket.put("private key", body)).toBe(f.object);
      expect(f.bucketCalls[2]?.[1]).toBe(body);
      await f.observed.bucket.delete(["private key"]);
      expect(f.object.body?.locked).toBe(false);
      return value;
    }),
  ).toBe(value);
  expect(f.bucketCalls[0]?.[1]).toBe(options);
  expect(f.calls).toEqual(["first", "all", "batch", "get", "head", "put", "delete"]);
  expect(logs).toEqual([
    {
      event: "preview_file_phase_awaits",
      phase: "prepare_publication",
      outcome: "success",
      overallMs: 59,
      d1Calls: 3,
      d1Failed: 0,
      d1TimedCalls: 3,
      d1AwaitMs: 15,
      r2Calls: 4,
      r2Failed: 0,
      r2TimedCalls: 4,
      r2AwaitMs: 44,
    },
  ]);
  expect(JSON.stringify(logs)).not.toContain("private");
  await s.first(); // Work outside the two phases cannot enter their observations.
  expect(logs).toHaveLength(1);
});

for (const kind of ["d1", "r2"] as const)
  test(`${kind} synchronous throws preserve the exact error and failed await count`, async () => {
    const f = fixture();
    const failure = new Error("synthetic private failure");
    f.statement.first = () => {
      throw failure;
    };
    f.bucket.head = () => {
      throw failure;
    };
    await expect(
      f.observed.measure<unknown>("stage_result", () =>
        kind === "d1"
          ? f.observed.database.prepare("private").first()
          : f.observed.bucket.head("private"),
      ),
    ).rejects.toBe(failure);
    expect(logs[0]).toMatchObject({
      outcome: "failure",
      [`${kind}Calls`]: 1,
      [`${kind}Failed`]: 1,
    });
    expect(JSON.stringify(logs)).not.toMatch(/private|stack|Error/);
  });

test("throwing clocks and log failures do not alter success or the original failure", async () => {
  const f = fixture(() => {
    throw new Error("private clock failure");
  });
  await f.observed.measure("stage_result", () => f.observed.bucket.head("private"));
  expect(logs[0]).toMatchObject({ overallMs: null, r2AwaitMs: null, r2TimedCalls: 0, r2Calls: 1 });
  log.mockImplementation(() => {
    throw new Error("private log failure");
  });
  expect(await f.observed.measure("stage_result", async () => 123)).toBe(123);
  const failure = {};
  await expect(
    f.observed.measure("stage_result", async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
});

for (const samples of [
  [Infinity, 1],
  [10, 9],
  [0, 1_000_000_001],
  [Number.NaN, 1],
])
  test(`invalid/overlong clock intervals stay unknown: ${samples[0]}`, async () => {
    let index = 0;
    const f = fixture(() => samples[index++] ?? Number.NaN);
    await f.observed.measure("stage_result", async () => {});
    expect(logs[0]?.overallMs).toBeNull();
    expect(JSON.stringify(logs)).not.toMatch(/NaN|Infinity/);
  });

test("overlapping phase scopes and late completions cannot contaminate a subsequent phase", async () => {
  const f = fixture();
  let release: () => void = () => {};
  let late: Promise<unknown> | undefined;
  f.statement.first = () =>
    new Promise((resolve) => {
      release = () => resolve(null);
    });
  await f.observed.measure("prepare_publication", async () => {
    late = f.observed.database.prepare("private").first();
  });
  const ongoing = f.observed.measure("stage_result", async () => {
    await f.observed.bucket.head("private");
    release();
    await late;
    await f.observed.database.prepare("private").all();
  });
  await f.observed.measure("prepare_publication", async () => {
    await f.observed.bucket.head("private");
    await Promise.resolve();
    await f.observed.bucket.head("private");
  });
  await ongoing;
  expect(logs[0]).toMatchObject({ d1Calls: 1, d1TimedCalls: 0, d1AwaitMs: null, r2Calls: 0 });
  expect(logs.find((value) => value.phase === "stage_result")).toMatchObject({
    d1Calls: 1,
    d1TimedCalls: 1,
    r2Calls: 1,
  });
  expect(
    logs.find((value) => value.phase === "prepare_publication" && value.r2Calls === 2),
  ).toMatchObject({ d1Calls: 0, r2Calls: 2 });
});

test("production or unspecified environments do not inspect bindings or clocks", () => {
  const fail = () => {
    throw new Error("must not inspect");
  };
  for (const environment of ["production", "", "staging"])
    expect(
      createFilePhaseObservation(
        new Proxy({} as D1Database, { get: fail }),
        new Proxy({} as PrivateBucket, { get: fail }),
        environment,
        fail,
      ),
    ).toBeNull();
  expect(logs).toEqual([]);
});

test("only the reviewed exact numeric/enum phase log is permitted", async () => {
  const path = "src/server/modules/file-processing/phase-observation.ts";
  const source = await Bun.file(path).text();
  expect(productBoundaryFindings(path, source)).toEqual([]);
  expect(productBoundaryFindings("src/server/other.ts", source)).toContain(
    "unapproved_payload_log",
  );
  for (const added of ["error,", "raw,", "ownerId,", "sql,", "...extra,"])
    expect(
      productBoundaryFindings(path, source.replace("r2AwaitMs,", `r2AwaitMs,${added}`)),
    ).toContain("unapproved_payload_log");
});
