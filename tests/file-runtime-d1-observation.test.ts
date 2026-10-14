import { expect, spyOn, test } from "bun:test";
import { productBoundaryFindings } from "../scripts/product-boundaries";
import { readRuntimeAdmission } from "../src/server/modules/file-processing/runtime-admission-observation";

const path = "src/server/modules/file-processing/runtime-admission-observation.ts";
const log =
  'console.info(JSON.stringify({event:"preview_file_runtime_d1",phase:"runtime_admission",outcome,wallMs,sqlMs,region,colo,primary,attempts,}),)';

function fixture(value: string | null = "synthetic-private-attempt") {
  const calls: string[] = [];
  const result = {
    results: value === null ? [] : [{ attempt_id: value, secret: "synthetic-private-row" }],
    success: true,
    meta: {
      timings: { sql_duration_ms: 0.125 },
      served_by_region: "APAC",
      served_by_colo: "SIN",
      served_by_primary: true,
      total_attempts: 1,
      other: "synthetic-private-meta",
    },
  } as unknown as D1Result<{ attempt_id: string }>;
  const statement = {
    all: async () => {
      calls.push("all");
      return result;
    },
    first: async (column: string) => {
      calls.push(`first:${column}`);
      return value;
    },
  } as unknown as D1PreparedStatement;
  let time = 0;
  return { calls, result, statement, clock: () => (time += 100) };
}

const observation = {
  event: "preview_file_runtime_d1",
  phase: "runtime_admission",
  outcome: "success",
  wallMs: 100,
  sqlMs: 0.125,
  region: "APAC",
  colo: "SIN",
  primary: true,
  attempts: 1,
};

for (const value of ["synthetic-private-attempt", null])
  test(`preview runtime admission preserves ${value === null ? "absent" : "present"} LIMIT 1 result in one query`, async () => {
    const f = fixture(value),
      output = spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(await readRuntimeAdmission(f.statement, "preview", f.clock)).toBe(value);
      expect(f.calls).toEqual(["all"]);
      expect(output.mock.calls).toEqual([[JSON.stringify(observation)]]);
      expect(JSON.stringify(output.mock.calls)).not.toContain("synthetic-private");
    } finally {
      output.mockRestore();
    }
  });

for (const environment of ["production", "local", "preview-invalid"])
  test(`${environment} keeps native first and never reads diagnostics or clock`, async () => {
    const f = fixture(),
      output = spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(
        await readRuntimeAdmission(f.statement, environment, () => {
          throw Error("Synthetic unused clock");
        }),
      ).toBe("synthetic-private-attempt");
      expect(f.calls).toEqual(["first:attempt_id"]);
      expect(output).not.toHaveBeenCalled();
    } finally {
      output.mockRestore();
    }
  });

for (const environment of ["preview", "production"])
  test(`${environment} preserves the original database exception without logging it`, async () => {
    const f = fixture(),
      failure = new Error("synthetic-private SQL/id/stack");
    f.statement.all = () => {
      f.calls.push("all");
      return Promise.reject(failure);
    };
    f.statement.first = () => {
      f.calls.push("first");
      return Promise.reject(failure);
    };
    const output = spyOn(console, "info").mockImplementation(() => {});
    try {
      await expect(readRuntimeAdmission(f.statement, environment, f.clock)).rejects.toBe(failure);
      expect(f.calls).toEqual([environment === "preview" ? "all" : "first"]);
      expect(output.mock.calls).toEqual(
        environment === "preview"
          ? [
              [
                JSON.stringify({
                  ...observation,
                  outcome: "failure",
                  sqlMs: null,
                  region: null,
                  colo: null,
                  primary: null,
                  attempts: null,
                }),
              ],
            ]
          : [],
      );
      expect(JSON.stringify(output.mock.calls)).not.toContain("synthetic-private");
    } finally {
      output.mockRestore();
    }
  });

for (const clock of [
  () => NaN,
  () => Infinity,
  () => -1,
  () => {
    throw Error("Synthetic clock failure");
  },
])
  test("unavailable clock records null wall time while preserving actual SQL metadata", async () => {
    const f = fixture(),
      output = spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(await readRuntimeAdmission(f.statement, "preview", clock)).toBe(
        "synthetic-private-attempt",
      );
      expect(output.mock.calls).toEqual([[JSON.stringify({ ...observation, wallMs: null })]]);
      expect(f.calls).toEqual(["all"]);
    } finally {
      output.mockRestore();
    }
  });

test("a backwards clock is unknown and a measured zero duration remains zero", async () => {
  const f = fixture(),
    output = spyOn(console, "info").mockImplementation(() => {});
  let time = 100;
  try {
    await readRuntimeAdmission(f.statement, "preview", () => time--);
    await readRuntimeAdmission(f.statement, "preview", () => 0);
    expect(output.mock.calls).toEqual([
      [JSON.stringify({ ...observation, wallMs: null })],
      [JSON.stringify({ ...observation, wallMs: 0 })],
    ]);
  } finally {
    output.mockRestore();
  }
});

test("clock samples may be epoch milliseconds while only the elapsed duration is bounded", async () => {
  const output = spyOn(console, "info").mockImplementation(() => {});
  try {
    for (const start of [1_000_000_001, 1_792_009_000_000, Number.MAX_SAFE_INTEGER - 1000]) {
      const f = fixture();
      let reads = 0;
      expect(await readRuntimeAdmission(f.statement, "preview", () => start + 100 * reads++)).toBe(
        "synthetic-private-attempt",
      );
      expect(f.calls).toEqual(["all"]);
      expect(output.mock.calls.at(-1)).toEqual([JSON.stringify(observation)]);
    }
  } finally {
    output.mockRestore();
  }
});

test("invalid epoch samples and excessive elapsed durations stay unknown", async () => {
  const output = spyOn(console, "info").mockImplementation(() => {});
  try {
    for (const [start, end] of [
      [1_792_009_000_000, 1_792_008_999_999],
      [1_792_009_000_000, 1_793_009_000_001],
      [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1],
      [1_792_009_000_000, NaN],
      [Infinity, 1_792_009_000_100],
    ] as const) {
      const f = fixture();
      let reads = 0;
      await readRuntimeAdmission(f.statement, "preview", () => (reads++ === 0 ? start : end));
      expect(output.mock.calls.at(-1)).toEqual([JSON.stringify({ ...observation, wallMs: null })]);
      expect(f.calls).toEqual(["all"]);
    }
  } finally {
    output.mockRestore();
  }
});

test("missing or malformed metadata stays null without inventing a geographic location", async () => {
  for (const meta of [
    undefined,
    null,
    {},
    {
      timings: { sql_duration_ms: -1 },
      served_by_region: "apac",
      served_by_colo: "SIN-private",
      served_by_primary: "true",
      total_attempts: 0,
    },
    {
      timings: { sql_duration_ms: Infinity },
      served_by_region: "synthetic-private",
      served_by_colo: "sin",
      served_by_primary: 1,
      total_attempts: 1.5,
    },
  ]) {
    const f = fixture(),
      output = spyOn(console, "info").mockImplementation(() => {});
    Object.defineProperty(f.result, "meta", { value: meta });
    try {
      expect(await readRuntimeAdmission(f.statement, "preview", f.clock)).toBe(
        "synthetic-private-attempt",
      );
      expect(output.mock.calls).toEqual([
        [
          JSON.stringify({
            ...observation,
            sqlMs: null,
            region: null,
            colo: null,
            primary: null,
            attempts: null,
          }),
        ],
      ]);
    } finally {
      output.mockRestore();
    }
  }
});

test("metadata access and log transport failures cannot replace success or database failure", async () => {
  const f = fixture(),
    output = spyOn(console, "info").mockImplementation(() => {});
  Object.defineProperty(f.result, "meta", {
    get: () => {
      throw Error("Synthetic private metadata");
    },
  });
  try {
    expect(await readRuntimeAdmission(f.statement, "preview", f.clock)).toBe(
      "synthetic-private-attempt",
    );
    expect(output.mock.calls).toEqual([
      [
        JSON.stringify({
          ...observation,
          sqlMs: null,
          region: null,
          colo: null,
          primary: null,
          attempts: null,
        }),
      ],
    ]);
    output.mockImplementation(() => {
      throw Error("Synthetic logger failure");
    });
    expect(await readRuntimeAdmission(f.statement, "preview", f.clock)).toBe(
      "synthetic-private-attempt",
    );
    const failure = new Error("Synthetic original DB error");
    f.statement.all = () => Promise.reject(failure);
    await expect(readRuntimeAdmission(f.statement, "preview", f.clock)).rejects.toBe(failure);
  } finally {
    output.mockRestore();
  }
});

test("only the exact reviewed runtime admission primitive log is allowed", async () => {
  expect(productBoundaryFindings(path, log)).toEqual([]);
  expect(productBoundaryFindings(path, await Bun.file(path).text())).toEqual([]);
  expect(productBoundaryFindings("src/server/other.ts", log)).toContain("unapproved_payload_log");
  for (const unsafe of [
    log.replace("attempts,", "attempts,sql,"),
    log.replace("attempts,", "attempts,result,"),
    log.replace("attempts,", "attempts,error,"),
    log.replace("attempts,", "attempts,...meta,"),
    log.replace("colo,", "colo:request.url,"),
    log.replace("outcome,", "outcome:error.message,"),
    log.replace("console.info", 'console["info"]'),
  ])
    expect(productBoundaryFindings(path, unsafe)).toContain("unapproved_payload_log");
});
