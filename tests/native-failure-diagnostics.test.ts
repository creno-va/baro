import { expect, test } from "bun:test";
import { Hono } from "hono";
import { measureD1Work } from "./helpers/d1-work";
import {
  createNativeFailureHistory,
  nativeFailure,
  nativeFailureHistorySchema,
} from "./helpers/native-failure";
import { createNativeProgress } from "./helpers/native-progress";

function database() {
  const state = { missing: false, reject: false, prepareReject: false };
  const result = () => {
    if (state.reject) throw new TypeError("private SQL and input");
    return {
      results: [{ value: 7 }],
      meta: state.missing ? {} : { rows_read: 2, rows_written: 1 },
    };
  };
  const statement = {
    bind: () => statement,
    all: async () => result(),
    run: async () => result(),
  };
  const binding = {
    prepare: () => {
      if (state.prepareReject) throw new TypeError("private SQL and input");
      return statement;
    },
    batch: async (statements: unknown[]) => statements.map(result),
  } as unknown as D1Database;
  return { binding, state };
}

test("native failure evidence retains only fixed names, codes and bounded cause categories", () => {
  const cause = Object.assign(new Error("D1_ERROR: private SQL and input"), { code: "private-id" });
  const error = Object.assign(new Error("private prompt and token", { cause }), {
    name: "DrizzleQueryError",
    code: "DB_OPERATION_FAILED",
  });
  expect(nativeFailure(error)).toEqual([
    {
      name: "DrizzleQueryError",
      code: "DB_OPERATION_FAILED",
      category: "unknown",
      knownFailure: null,
    },
    { name: "Error", code: null, category: "database_unavailable", knownFailure: null },
  ]);
  expect(JSON.stringify(nativeFailure(error))).not.toMatch(/private|prompt|token|SQL|stack/);
  expect(nativeFailure(new Error("RUNTIME_HOLD_ACTOR_MISMATCH"))[0]?.knownFailure).toBe(
    "RUNTIME_HOLD_ACTOR_MISMATCH",
  );
  expect(
    nativeFailure({
      get message() {
        throw new Error("private");
      },
    }),
  ).toEqual([]);
  expect(nativeFailure(Object.assign(new Error(), { cause: error }))).toHaveLength(3);
});

test("pinned RPC assertions retain only fixed failure sites and boolean assertion values", () => {
  for (const [line, field] of [
    [110451, "asyncClientStatus"],
    [110459, "asyncResultType"],
  ] as const) {
    // Reproduced with the actual pinned bridge: an offline D1 response replaced
    // by HTTP 409 or by a missing Promise header. This is not the CI root cause.
    const error = Object.assign(new Error("private transport message"), {
      name: "AssertionError",
      code: "ERR_ASSERTION",
      generatedMessage: true,
      operator: "==",
      actual: false,
      expected: true,
      stack: `AssertionError: private message\n at #parseAsyncResponse (/private/path/node_modules/miniflare/dist/src/index.js:${line}:1)`,
    });
    const failure = nativeFailure(error);
    expect(failure[0]).toMatchObject({
      name: "AssertionError",
      code: "ERR_ASSERTION",
      assertion: {
        generatedMessage: true,
        operator: "==",
        actual: "false",
        expected: "true",
        sites: { [field]: true },
      },
    });
    expect(JSON.stringify(failure)).not.toMatch(/private|message|path|stack|11045/);
    const history = createNativeFailureHistory();
    history.capture(error, "first");
    expect(history.snapshot().first[0]?.details).toEqual(failure);
  }
});

test("RPC diagnostics preserve disposed classification without serializing assertion operands", () => {
  const disposed = Object.assign(new Error("private disposed instance"), {
    name: "MiniflareCoreError [ERR_DISPOSED]",
    code: "ERR_DISPOSED",
  });
  expect(nativeFailure(disposed)[0]).toMatchObject({
    name: "MiniflareCoreError [ERR_DISPOSED]",
    code: "ERR_DISPOSED",
  });
  const error = Object.assign(new Error("private"), {
    name: "AssertionError",
    code: "ERR_ASSERTION",
    generatedMessage: "private",
    operator: "private",
    actual: 123456,
    expected: "private header",
    stack: "at #parseAsyncResponse (/private/index.js:110451:1)",
  });
  const failure = nativeFailure(error);
  expect(failure[0]).toMatchObject({
    assertion: {
      generatedMessage: null,
      operator: null,
      actual: "other",
      expected: "other",
      sites: { asyncClientStatus: false, asyncResultType: false },
    },
  });
  expect(JSON.stringify(failure)).not.toMatch(/private|123456|110451|stack/);
});

test("pinned RPC assertion locations match the installed bridge source", async () => {
  const pkg = await Bun.file(
    new URL("../node_modules/miniflare/package.json", import.meta.url),
  ).json();
  expect(pkg.version).toBe("5.20261001.0-alpha");
  const source = (
    await Bun.file(new URL("../node_modules/miniflare/dist/src/index.js", import.meta.url)).text()
  ).split("\n");
  for (const [line, expression, method, field] of [
    [110451, "!isClientError(res.status)", "#parseAsyncResponse", "asyncClientStatus"],
    [110459, 'typeHeader === "Promise"', "#parseAsyncResponse", "asyncResultType"],
    [110483, "!isClientError(syncRes.status)", "#parseSyncResponse", "syncClientStatus"],
    [110445, "res.status === 200", "#maybeThrow", "responseStatus"],
    [110076, "message?.id === id", "receiveReply", "syncReplyIdentity"],
  ] as const) {
    expect(source[line - 1]).toContain(expression);
    const error = Object.assign(new Error(), {
      name: "AssertionError",
      code: "ERR_ASSERTION",
      stack: `at ${method} (/private/node_modules/miniflare/dist/src/index.js:${line}:1)`,
    });
    expect(nativeFailure(error)[0]?.assertion?.sites[field]).toBe(true);
    error.stack = `at ${method} (/private/other.js:1:1)\nat other (/private/node_modules/miniflare/dist/src/index.js:${line}:1)`;
    expect(nativeFailure(error)[0]?.assertion?.sites[field]).toBe(false);
  }
});

test("assertion diagnostics are bounded and cannot lose the original class on hostile optional properties", () => {
  const error = Object.assign(new Error(), {
    name: "AssertionError",
    code: "ERR_ASSERTION",
    actual: null,
    expected: undefined,
  });
  expect(nativeFailure(error)[0]?.assertion).toMatchObject({
    actual: "null",
    expected: "undefined",
  });
  for (const key of ["generatedMessage", "operator", "actual", "expected", "stack"]) {
    Object.defineProperty(error, key, {
      configurable: true,
      get() {
        throw new Error("private getter");
      },
    });
  }
  const history = createNativeFailureHistory();
  history.capture(error, "first");
  expect(history.snapshot().first[0]?.details[0]).toMatchObject({
    name: "AssertionError",
    code: "ERR_ASSERTION",
    assertion: {
      generatedMessage: null,
      operator: null,
      actual: "other",
      expected: "other",
      sites: { asyncClientStatus: false },
    },
  });
  const snapshot = history.snapshot();
  expect(JSON.stringify(snapshot)).not.toContain("private");
  const detail = snapshot.first[0]?.details[0];
  expect(detail?.assertion).toBeDefined();
  for (const field of [
    { stack: "private" },
    { assertion: { ...detail?.assertion, actual: 123456 } },
    { assertion: { ...detail?.assertion, operator: "private" } },
    {
      assertion: { ...detail?.assertion, sites: { ...detail?.assertion?.sites, arbitrary: true } },
    },
  ]) {
    expect(
      nativeFailureHistorySchema.safeParse({
        first: [{ operation: "first", details: [{ ...detail, ...field }] }],
        omitted: 0,
      }).success,
    ).toBe(false);
  }
  const longStack = Object.assign(new Error(), {
    name: "AssertionError",
    code: "ERR_ASSERTION",
    stack: `${"x".repeat(16384)}\nat #parseAsyncResponse (/miniflare/dist/src/index.js:110451:1)`,
  });
  expect(nativeFailure(longStack)[0]?.assertion?.sites.asyncClientStatus).toBe(false);
  longStack.name = "private class";
  expect(nativeFailure(longStack)[0]?.assertion).toBeUndefined();
});

test("outer Hono middleware sees the caught original failure without changing API response", async () => {
  let evidence: ReturnType<typeof nativeFailure> = [];
  const api = new Hono().onError((_error, c) => c.json({ code: "DEPENDENCY_UNAVAILABLE" }, 503));
  api.get("/admit", () => {
    throw Object.assign(new Error("private"), { code: "SNAPSHOT_STREAM_REQUIRED" });
  });
  const app = new Hono()
    .use("*", async (c, next) => {
      await next();
      if (c.error) evidence = nativeFailure(c.error);
    })
    .route("/api", api);
  const response = await app.request("/api/admit");
  expect(response.status).toBe(503);
  expect((await response.json()) as { code: string }).toEqual({ code: "DEPENDENCY_UNAVAILABLE" });
  expect(evidence[0]?.code).toBe("SNAPSHOT_STREAM_REQUIRED");
});

test("D1 query and metadata failures are captured once at their actual operation", async () => {
  for (const kind of ["query", "metadata"] as const) {
    const f = database(),
      failures: ReturnType<typeof nativeFailure>[] = [];
    f.state.reject = kind === "query";
    f.state.missing = kind === "metadata";
    const measured = measureD1Work(f.binding, (error) => failures.push(nativeFailure(error)));
    await expect(measured.binding.prepare("synthetic").bind("private").first()).rejects.toThrow();
    expect(failures).toHaveLength(1);
    expect(measured.trace).toMatchObject({
      operation: "first",
      state: "failed",
      maximumBoundParameters: 1,
      measurementMetadataPresent: kind === "metadata" ? false : null,
    });
    expect(failures[0]?.[0]?.knownFailure).toBe(
      kind === "metadata" ? "Native D1 measurement missing" : null,
    );
    expect(JSON.stringify(failures)).not.toContain("private");
    expect(measured.work.statements).toBe(0);
  }
});

test("D1 sync prepare and batch observation retain failure type while valid rows keep measurements", async () => {
  const f = database(),
    failures: ReturnType<typeof nativeFailure>[] = [];
  const measured = measureD1Work(f.binding, (error) => failures.push(nativeFailure(error)));
  f.state.prepareReject = true;
  expect(() => measured.binding.prepare("private SQL")).toThrow();
  expect(measured.trace).toMatchObject({ operation: "prepare", state: "failed" });
  expect(failures).toHaveLength(1);
  f.state.prepareReject = false;
  measured.resetTrace();
  const query = measured.binding.prepare("synthetic").bind(1, 2);
  expect(await query.first<number>("value")).toBe(7);
  expect(await query.raw()).toEqual([[7]]);
  await query.all();
  await query.run();
  await measured.binding.batch([query, query]);
  expect(measured.work).toEqual({ statements: 6, rowsRead: 12, rowsWritten: 6 });
  expect(measured.trace).toMatchObject({
    operation: "batch",
    state: "completed",
    maximumBatchStatements: 2,
    maximumBoundParameters: 2,
  });
  f.state.missing = true;
  await expect(measured.binding.batch([query])).rejects.toThrow();
  expect(failures).toHaveLength(2);
  expect(measured.trace).toMatchObject({
    operation: "batch",
    state: "failed",
    measurementMetadataPresent: false,
  });
});

test("a runtime failure survives the next successful request reset in the failure snapshot", async () => {
  const f = database(),
    requestFailures: unknown[] = [],
    history = createNativeFailureHistory(),
    emitted: unknown[] = [];
  const measured = measureD1Work(f.binding, (error) => {
    requestFailures.push(nativeFailure(error));
    history.capture(error, measured.trace.operation);
  });
  f.state.missing = true;
  await expect(measured.binding.prepare("synthetic").first()).rejects.toThrow();
  // The canonical outage runtime is followed by latest-job GET before assertion.
  requestFailures.length = 0;
  measured.resetTrace();
  f.state.missing = false;
  expect(await measured.binding.prepare("synthetic").first<number>("value")).toBe(7);
  const progress = createNativeProgress(true, {
    emit: (snapshot) => emitted.push(snapshot),
    schedule: () => 1,
    cancel: () => {},
  });
  progress.observe(() => ({
    databaseTrace: measured.trace,
    databaseFailureHistory: history.snapshot(),
  }));
  progress.report("failure");
  progress.finish(false);
  expect(requestFailures).toEqual([]);
  expect(emitted).toHaveLength(1);
  expect(emitted[0]).toMatchObject({
    lastMeasuredPreviewTrace: { operation: "first", state: "completed" },
    databaseFailureHistory: {
      first: [{ operation: "first", details: [{ knownFailure: "Native D1 measurement missing" }] }],
      omitted: 0,
    },
  });
});

test("failure history is bounded, immutable to observers and cannot change the original error", async () => {
  const history = createNativeFailureHistory();
  const failure = new TypeError("private SQL input and token");
  const statement = {
    all: async () => {
      throw failure;
    },
  };
  const db = { prepare: () => statement } as unknown as D1Database;
  const measured = measureD1Work(db, (error) => history.capture(error, measured.trace.operation));
  for (let n = 0; n < 11; n++) {
    try {
      await measured.binding.prepare("private").first();
      throw new Error("Expected synthetic failure");
    } catch (error) {
      expect(error).toBe(failure);
    }
  }
  const snapshot = history.snapshot();
  expect(snapshot.first).toHaveLength(8);
  expect(snapshot.omitted).toBe(3);
  snapshot.first.length = 0;
  expect(history.snapshot().first).toHaveLength(8);
  expect(JSON.stringify(history.snapshot())).not.toMatch(/private|SQL|input|token|stack/);
});
