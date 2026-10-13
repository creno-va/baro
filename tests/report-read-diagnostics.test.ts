import { expect, spyOn, test } from "bun:test";
import { productBoundaryFindings } from "../scripts/product-boundaries";
import { V2RepositoryError } from "../src/server/db/v2-core";
import { reportReadFailure, reportReadStep } from "../src/server/modules/reports/diagnostics";
import { REPORT_SOURCE_SQL } from "../src/server/modules/reports/source";
import { reportHttpFixture } from "./helpers/report-http-fixture";

for (const [stage, matches, code] of [
  ["latest", (sql: string) => sql.startsWith("SELECT id,revision FROM v2_reports"), "unknown"],
  ["source", (sql: string) => sql === REPORT_SOURCE_SQL, "unknown"],
  [
    "create",
    (sql: string) => sql.startsWith("INSERT INTO v2_private_snapshots"),
    "DB_OPERATION_FAILED",
  ],
  ["view", (sql: string) => sql.startsWith("SELECT r.* FROM v2_reports"), "unknown"],
] as const) {
  test(`signed first report GET retains only ${stage} failure classification`, async () => {
    const f = await reportHttpFixture();
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      let failures = 0;
      const binding = f.env.DB;
      const db = {
        prepare(sql: string) {
          if (matches(sql)) {
            failures++;
            throw new Error("D1_ERROR: no such column: private-sql private-owner private-token");
          }
          return binding.prepare(sql);
        },
        batch: binding.batch.bind(binding),
      } as D1Database;
      const response = await f.app.request(
        `/api/v2/cases/${f.workspaceId}/reports`,
        { headers: { cookie: f.cookie } },
        { ...f.env, DB: db },
      );
      expect(failures).toBe(1);
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toMatchObject({ error: { code: "DEPENDENCY_UNAVAILABLE" } });
      expect(log.mock.calls).toEqual([
        [
          JSON.stringify({
            event: "report_dependency_failure",
            stage,
            category: "database_query",
            code,
          }),
        ],
      ]);
      expect(JSON.stringify({ body, logs: log.mock.calls })).not.toContain("private-");
      expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_reports").get()).toEqual({
        n: stage === "view" ? 1 : 0,
      });
    } finally {
      log.mockRestore();
      f.db.close();
    }
  });
}

test("first report GET creates a readable immutable report without performing exports", async () => {
  const f = await reportHttpFixture();
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    const originalCalls = { ...f.bucket.calls };
    const unauthorized = await f.app.request(`/api/v2/cases/${f.workspaceId}/reports`, {}, f.env);
    expect(unauthorized.status).toBe(401);
    const response = await f.app.request(
      `/api/v2/cases/${f.workspaceId}/reports`,
      { headers: { cookie: f.cookie } },
      f.env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ caseId: f.workspaceId, revision: 1 });
    expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_reports").get()).toEqual({ n: 1 });
    expect(f.bucket.calls).toEqual(originalCalls);
    expect(log).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
    f.db.close();
  }
});

test("snapshot safe codes remain distinguishable without logging error contents", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const code of ["SNAPSHOT_INVALID", "SNAPSHOT_STREAM_REQUIRED"] as const) {
      const failure = new V2RepositoryError(code);
      failure.message = "private-message";
      failure.stack = "private-stack";
      try {
        await reportReadStep("source", async () => {
          throw failure;
        });
      } catch (error) {
        expect(error).toBe(failure);
        reportReadFailure(error);
      }
      expect(log.mock.calls.at(-1)).toEqual([
        JSON.stringify({
          event: "report_dependency_failure",
          stage: "source",
          category: "unknown",
          code,
        }),
      ]);
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-");
  } finally {
    log.mockRestore();
  }
});

test("unrecognized stage, code, message, cause and primitive failures cannot enter diagnostic logs", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    const failure = Object.assign(new Error("private-message"), {
      code: "private-code",
      cause: "private-cause",
      url: "https://private-source.example",
    });
    try {
      await reportReadStep("private-stage" as Parameters<typeof reportReadStep>[0], async () => {
        throw failure;
      });
    } catch (error) {
      reportReadFailure(error);
    }
    reportReadFailure("private-primitive");
    const expected = JSON.stringify({
      event: "report_dependency_failure",
      stage: "unclassified",
      category: "unknown",
      code: "unknown",
    });
    expect(log.mock.calls).toEqual([[expected], [expected]]);
  } finally {
    log.mockRestore();
  }
});

test("payload log exception is restricted to the exact report diagnostic shape and module", async () => {
  const path = "src/server/modules/reports/diagnostics.ts";
  const source = await Bun.file(path).text();
  expect(productBoundaryFindings(path, source)).toEqual([]);
  expect(productBoundaryFindings("src/server/modules/reports/source.ts", source)).toContain(
    "unapproved_payload_log",
  );
  for (const code of [
    "console.error(error)",
    'console.error(JSON.stringify({event:"report_dependency_failure",stage,category,code,message:error.message}))',
  ]) {
    expect(productBoundaryFindings(path, code)).toContain("unapproved_payload_log");
  }
});
