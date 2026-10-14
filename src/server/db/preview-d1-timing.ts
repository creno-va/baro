const operations = ["workspace_read", "intake_read", "answers_save", "latest_job_read"] as const;
export type PreviewD1Operation = (typeof operations)[number];
const regions = ["ENAM", "WNAM", "WEUR", "EEUR", "APAC", "OC"] as const;
const maximum = 1_000_000_000;
const number = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum;
const integer = (value: unknown): value is number => number(value) && Number.isSafeInteger(value);

/** Optional, request-local observation. Never retain SQL, bindings, rows or errors.
 * first/raw deliberately keep their native methods: their metadata is unknown. */
export function createPreviewD1Timing(
  database: D1Database,
  environment: string,
  operation: PreviewD1Operation,
  clock: () => number = () => performance.now(),
) {
  if (environment !== "preview" || !operations.includes(operation)) return null;
  const ignoreFailure = (action: () => void) => {
    try {
      action();
    } catch {
      // Diagnostics cannot change the database result or its original exception.
    }
  };
  const now = () => {
    try {
      const value = clock();
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };
  const elapsed = (start: number | null, end: number | null) => {
    const value = start === null || end === null ? null : end - start;
    return number(value) ? value : null;
  };
  const started = now();
  const work = {
    calls: 0,
    statements: 0,
    failed: 0,
    wait: 0,
    timedCalls: 0,
    sql: 0,
    sqlStatements: 0,
    sampleWait: 0,
    sampleSql: 0,
    sampleCalls: 0,
    attemptsKnown: 0,
    attemptsMax: 0,
    regionsKnown: 0,
  };
  const observedRegions = new Set<string>();
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  let sealed = false;
  const observe = (results: readonly D1Result<unknown>[], statements: number) => {
    let sql = 0,
      known = 0;
    for (const result of results) {
      const meta = result.meta;
      const duration = meta?.timings?.sql_duration_ms;
      if (number(duration)) {
        sql += duration;
        known++;
      }
      const attempts = meta?.total_attempts;
      if (integer(attempts) && attempts > 0) {
        work.attemptsKnown++;
        work.attemptsMax = Math.max(work.attemptsMax, attempts);
      }
      const region = meta?.served_by_region;
      if (regions.some((allowed) => allowed === region)) {
        work.regionsKnown++;
        observedRegions.add(region as string);
      }
    }
    work.sql += sql;
    work.sqlStatements += known;
    return known === statements && results.length === statements && number(sql) ? sql : null;
  };
  const capture = async <T>(
    statements: number,
    action: () => Promise<T>,
    metadata?: (result: T) => readonly D1Result<unknown>[],
  ): Promise<T> => {
    const start = now();
    let sampleSql: number | null = null;
    if (!sealed) {
      work.calls++;
      work.statements += statements;
    }
    try {
      const result = await action();
      if (!sealed && metadata)
        ignoreFailure(() => {
          sampleSql = observe(metadata(result), statements);
        });
      return result;
    } catch (error) {
      if (!sealed) work.failed++;
      throw error;
    } finally {
      if (!sealed)
        ignoreFailure(() => {
          const duration = elapsed(start, now());
          if (duration === null) return;
          work.wait += duration;
          work.timedCalls++;
          if (sampleSql !== null) {
            work.sampleWait += duration;
            work.sampleSql += sampleSql;
            work.sampleCalls++;
          }
        });
    }
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      all: <T>() =>
        capture(
          1,
          () => statement.all<T>(),
          (result) => [result],
        ),
      run: <T>() =>
        capture(
          1,
          () => statement.run<T>(),
          (result) => [result],
        ),
      first: <T>(column?: string) =>
        capture(1, () =>
          column === undefined ? statement.first<T>() : statement.first<T>(column),
        ),
      raw: <T>(options?: { columnNames?: boolean }) =>
        capture<T[] | [string[], ...T[]]>(1, () =>
          options === undefined
            ? statement.raw<T>()
            : (
                statement.raw as (value: {
                  columnNames?: boolean;
                }) => Promise<T[] | [string[], ...T[]]>
              ).call(statement, options),
        ),
    } as D1PreparedStatement;
    originals.set(wrapped, statement);
    return wrapped;
  };
  const binding = {
    prepare: (sql: string) => wrap(database.prepare(sql)),
    batch: <T>(statements: D1PreparedStatement[]) =>
      capture(
        statements.length,
        () =>
          database.batch<T>(statements.map((statement) => originals.get(statement) ?? statement)),
        (results) => results,
      ),
    exec: (sql: string) => database.exec(sql),
    dump: () => database.dump(),
    withSession: (constraint?: D1SessionBookmark | D1SessionConstraint) =>
      database.withSession(constraint),
  } as D1Database;
  return {
    binding,
    finish(): string | null {
      if (sealed) return null;
      sealed = true;
      try {
        const count = (value: number) => (integer(value) ? String(value) : "unknown");
        const duration = (name: string, value: number | null, description?: string) => {
          const valid = number(value);
          const detail = valid
            ? (description ?? "observed")
            : description
              ? `unknown;${description}`
              : "unknown";
          return `${name}${valid ? `;dur=${Math.round(value * 1000) / 1000}` : ""};desc="${detail}"`;
        };
        const region =
          observedRegions.size === 1
            ? [...observedRegions][0]
            : observedRegions.size
              ? "mixed"
              : "unknown";
        const header = [
          `operation;desc="${operation}"`,
          'scope;desc="workspace_domain_auth_excluded"',
          duration("domain", elapsed(started, now())),
          `d1_calls;desc="${count(work.calls)}"`,
          `d1_statements;desc="${count(work.statements)}"`,
          `d1_failed;desc="${count(work.failed)}"`,
          duration(
            "d1_wait",
            work.timedCalls ? work.wait : null,
            `${count(work.timedCalls)}/${count(work.calls)} calls`,
          ),
          duration(
            "d1_sql",
            work.sqlStatements ? work.sql : null,
            `${count(work.sqlStatements)}/${count(work.statements)} statements`,
          ),
          duration(
            "d1_sample_wait",
            work.sampleCalls ? work.sampleWait : null,
            `${count(work.sampleCalls)} calls`,
          ),
          duration(
            "d1_sample_sql",
            work.sampleCalls ? work.sampleSql : null,
            `${count(work.sampleCalls)} calls`,
          ),
          `d1_attempts;desc="${work.attemptsKnown ? count(work.attemptsMax) : "unknown"} max;${count(work.attemptsKnown)} known"`,
          `d1_region;desc="${region};${count(work.regionsKnown)} known"`,
        ].join(", ");
        return header.length <= 1024 ? header : null;
      } catch {
        return null;
      }
    },
  };
}
