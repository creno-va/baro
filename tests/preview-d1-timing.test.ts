import { expect, test } from "bun:test";
import { createPreviewD1Timing } from "../src/server/db/preview-d1-timing";

function fixture() {
  const row = { value: "synthetic-private-row" };
  const raw = [["synthetic-private-row"]];
  const result = {
    results: [row],
    success: true,
    meta: {
      timings: { sql_duration_ms: 0.125 },
      total_attempts: 2,
      served_by_region: "APAC",
    },
  } as unknown as D1Result<typeof row>;
  const calls: { method: string; args: unknown[] }[] = [];
  const source = (name: string): D1PreparedStatement =>
    ({
      bind(...args: unknown[]) {
        calls.push({ method: `${name}.bind`, args });
        return bound;
      },
      async all() {
        calls.push({ method: `${name}.all`, args: [] });
        return result;
      },
      async run() {
        calls.push({ method: `${name}.run`, args: [] });
        return result;
      },
      async first(...args: unknown[]) {
        calls.push({ method: `${name}.first`, args });
        return row;
      },
      async raw(...args: unknown[]) {
        calls.push({ method: `${name}.raw`, args });
        return raw;
      },
    }) as D1PreparedStatement;
  const bound = source("bound"),
    prepared = source("prepared");
  const batchResult = [result, result];
  const database = {
    prepare(sql: string) {
      calls.push({ method: "prepare", args: [sql] });
      return prepared;
    },
    async batch(statements: D1PreparedStatement[]) {
      calls.push({ method: "batch", args: statements });
      return batchResult;
    },
  } as D1Database;
  let time = 0;
  const timing = createPreviewD1Timing(database, "preview", "answers_save", () => time++);
  if (!timing) throw Error("Missing synthetic timing");
  return { row, raw, result, calls, bound, prepared, batchResult, database, timing };
}

test("observation preserves native first/raw methods, arguments and result identities", async () => {
  const f = fixture();
  const parameter = { private: "synthetic-bound-value" };
  const statement = f.timing.binding.prepare("synthetic SQL sentinel").bind(parameter, null);
  expect(Object.is(await statement.first(), f.row)).toBe(true);
  expect(Object.is(await statement.first("value"), f.row)).toBe(true);
  expect(await statement.raw()).toBe(f.raw);
  const options = { columnNames: true } as const;
  expect(Object.is(await statement.raw(options), f.raw)).toBe(true);
  expect(await statement.all()).toBe(f.result);
  expect(await statement.run()).toBe(f.result);
  expect(f.calls).toEqual([
    { method: "prepare", args: ["synthetic SQL sentinel"] },
    { method: "prepared.bind", args: [parameter, null] },
    { method: "bound.first", args: [] },
    { method: "bound.first", args: ["value"] },
    { method: "bound.raw", args: [] },
    { method: "bound.raw", args: [options] },
    { method: "bound.all", args: [] },
    { method: "bound.run", args: [] },
  ]);
  expect(f.calls[1]?.args[0]).toBe(parameter);
  expect(f.calls[5]?.args[0]).toBe(options);
  const header = f.timing.finish();
  expect(header).toContain('d1_calls;desc="6"');
  expect(header).toContain('d1_sql;dur=0.25;desc="2/6 statements"');
  expect(header).toContain('d1_wait;dur=6;desc="6/6 calls"');
  expect(header).toContain('d1_sample_wait;dur=2;desc="2 calls"');
  expect(header).toContain('d1_region;desc="APAC;2 known"');
  expect(header).not.toContain("synthetic");
  expect(f.timing.finish()).toBeNull();
});

test("a batch uses the exact native bound statements once and keeps the original result array", async () => {
  const f = fixture();
  const statement = f.timing.binding.prepare("private SQL").bind("private parameter");
  expect(await f.timing.binding.batch([statement, f.prepared])).toBe(f.batchResult);
  expect(f.calls.at(-1)).toEqual({ method: "batch", args: [f.bound, f.prepared] });
  expect(f.calls.at(-1)?.args[0]).toBe(f.bound);
  expect(f.calls.at(-1)?.args[1]).toBe(f.prepared);
  const header = f.timing.finish();
  expect(header).toContain('d1_calls;desc="1"');
  expect(header).toContain('d1_statements;desc="2"');
  expect(header).toContain('d1_sql;dur=0.25;desc="2/2 statements"');
  // Attempts are result metadata, not a sum of physical batch retries.
  expect(header).toContain('d1_attempts;desc="2 max;2 known"');
});

test("database errors and synchronous prepare/bind errors retain their original identity", async () => {
  const f = fixture();
  const failure = new Error("synthetic private error");
  f.bound.first = () => Promise.reject(failure);
  const statement = f.timing.binding.prepare("private SQL").bind("private value");
  await expect(statement.first()).rejects.toBe(failure);
  f.bound.run = () => {
    throw failure;
  };
  await expect(statement.run()).rejects.toBe(failure);
  f.prepared.bind = () => {
    throw failure;
  };
  try {
    f.timing.binding.prepare("private SQL").bind();
    throw Error("Expected native bind failure");
  } catch (error) {
    expect(error).toBe(failure);
  }
  f.database.prepare = () => {
    throw failure;
  };
  try {
    f.timing.binding.prepare("private SQL");
    throw Error("Expected native prepare failure");
  } catch (error) {
    expect(error).toBe(failure);
  }
  f.database.batch = () => Promise.reject(failure);
  await expect(f.timing.binding.batch([statement])).rejects.toBe(failure);
  const header = f.timing.finish();
  expect(header).toContain('d1_failed;desc="3"');
  expect(header).not.toContain("private");
});

test("throwing clocks and metadata getters never change successful results", async () => {
  const f = fixture();
  const timing = createPreviewD1Timing(f.database, "preview", "intake_read", () => {
    throw Error("private clock failure");
  });
  Object.defineProperty(f.result, "meta", {
    get() {
      throw Error("private metadata failure");
    },
  });
  expect(await timing?.binding.prepare("private SQL").all()).toBe(f.result);
  const header = timing?.finish();
  expect(header).toContain('domain;desc="unknown"');
  expect(header).toContain('d1_wait;desc="unknown;0/1 calls"');
  expect(header).toContain('d1_sql;desc="unknown;0/1 statements"');
  expect(header).not.toContain("private");
});

test("missing or invalid metadata stays unknown and arbitrary region text cannot enter headers", async () => {
  const f = fixture();
  Object.assign(f.result.meta, {
    timings: { sql_duration_ms: Number.NaN },
    total_attempts: 0,
    served_by_region: "secret\r\nx-private: payload",
  });
  expect(await f.timing.binding.prepare("private SQL").all()).toBe(f.result);
  const header = f.timing.finish() ?? "";
  expect(header).toContain('d1_sql;desc="unknown;0/1 statements"');
  expect(header).toContain('d1_attempts;desc="unknown max;0 known"');
  expect(header).toContain('d1_region;desc="unknown;0 known"');
  expect(header.length).toBeLessThanOrEqual(1024);
  expect(header).not.toMatch(/secret|payload|NaN|Infinity|\r|\n/);
});

test("numeric overflow and backwards clocks do not emit invalid durations", async () => {
  const f = fixture();
  let time = 100;
  const timing = createPreviewD1Timing(f.database, "preview", "workspace_read", () => time--);
  Object.assign(f.result.meta, {
    timings: { sql_duration_ms: Infinity },
    total_attempts: 1e30,
  });
  expect(await timing?.binding.prepare("private SQL").all()).toBe(f.result);
  const header = timing?.finish() ?? "";
  expect(header).not.toContain(";dur=");
  expect(header).not.toMatch(/NaN|Infinity|1e\+/);
  expect(header.length).toBeLessThanOrEqual(1024);
});

test("concurrent request wrappers and sealed responses keep independent observations", async () => {
  const f = fixture();
  const other = createPreviewD1Timing(f.database, "preview", "latest_job_read", () => 0);
  let release: () => void = () => {};
  f.bound.first = async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return f.row;
  };
  const pending = f.timing.binding.prepare("private SQL").bind().first();
  expect(await other?.binding.prepare("private SQL").all()).toBe(f.result);
  const completed = other?.finish();
  release();
  expect(await pending).toBe(f.row);
  expect(f.timing.finish()).toContain('d1_sql;desc="unknown;0/1 statements"');
  expect(completed).toContain('d1_sql;dur=0.125;desc="1/1 statements"');
  expect(completed).toContain('operation;desc="latest_job_read"');
  expect(await other?.binding.prepare("private SQL").all()).toBe(f.result);
  expect(other?.finish()).toBeNull();
});

for (const environment of ["production", "local", "unknown"])
  test(`${environment} does not create an observation wrapper or read the clock`, () => {
    const database = new Proxy({} as D1Database, {
      get() {
        throw Error("binding accessed");
      },
    });
    expect(
      createPreviewD1Timing(database, environment, "answers_save", () => {
        throw Error("clock accessed");
      }),
    ).toBeNull();
  });
