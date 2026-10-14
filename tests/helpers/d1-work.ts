/** Native D1 measurements, including auth queries outside the domain core. */
export function measureD1Work(database: D1Database, onFailure?: (error: unknown) => void) {
  const trace = {
    operation: "none" as "none" | "prepare" | "bind" | "all" | "run" | "first" | "raw" | "batch",
    state: "idle" as "idle" | "pending" | "completed" | "failed",
    measurementMetadataPresent: null as boolean | null,
    maximumBoundParameters: 0,
    maximumBatchStatements: 0,
  };
  const capture = async <T>(operation: typeof trace.operation, action: () => Promise<T>) => {
    trace.operation = operation;
    trace.state = "pending";
    trace.measurementMetadataPresent = null;
    try {
      const result = await action();
      trace.state = "completed";
      return result;
    } catch (error) {
      trace.operation = operation;
      trace.state = "failed";
      onFailure?.(error);
      throw error;
    }
  };
  const work = { statements: 0, rowsRead: 0, rowsWritten: 0 };
  const sources = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const observe = <T>(value: D1Result<T>) => {
    trace.measurementMetadataPresent =
      !!value.meta &&
      Number.isSafeInteger(value.meta.rows_read) &&
      Number.isSafeInteger(value.meta.rows_written);
    if (!trace.measurementMetadataPresent) throw new Error("Native D1 measurement missing");
    work.statements++;
    work.rowsRead += value.meta.rows_read;
    work.rowsWritten += value.meta.rows_written;
    return value;
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const result = {
      bind: (...values: unknown[]) => {
        trace.maximumBoundParameters = Math.max(trace.maximumBoundParameters, values.length);
        trace.operation = "bind";
        trace.state = "pending";
        try {
          const bound = wrap(statement.bind(...values));
          trace.state = "completed";
          return bound;
        } catch (error) {
          trace.state = "failed";
          onFailure?.(error);
          throw error;
        }
      },
      all: async <T>() => capture("all", async () => observe(await statement.all<T>())),
      run: async <T>() => capture("run", async () => observe(await statement.run<T>())),
      async first<T>(column?: string) {
        const row = (
          await capture("first", async () =>
            observe(await statement.all<Record<string, unknown>>()),
          )
        ).results[0];
        return (column ? (row?.[column] ?? null) : (row ?? null)) as T | null;
      },
      async raw<T>(options?: { columnNames?: boolean }) {
        const rows = (
          await capture("raw", async () => observe(await statement.all<Record<string, unknown>>()))
        ).results;
        const values = rows.map((row) => Object.values(row));
        return (options?.columnNames ? [Object.keys(rows[0] ?? {}), ...values] : values) as T[];
      },
    } as D1PreparedStatement;
    sources.set(result, statement);
    return result;
  };
  return {
    work,
    trace,
    resetTrace: () =>
      Object.assign(trace, {
        operation: "none",
        state: "idle",
        measurementMetadataPresent: null,
        maximumBoundParameters: 0,
        maximumBatchStatements: 0,
      }),
    reset: () => Object.assign(work, { statements: 0, rowsRead: 0, rowsWritten: 0 }),
    binding: {
      prepare: (sql: string) => {
        trace.operation = "prepare";
        trace.state = "pending";
        try {
          const prepared = wrap(database.prepare(sql));
          trace.state = "completed";
          return prepared;
        } catch (error) {
          trace.state = "failed";
          onFailure?.(error);
          throw error;
        }
      },
      async batch<T>(statements: D1PreparedStatement[]) {
        trace.maximumBatchStatements = Math.max(trace.maximumBatchStatements, statements.length);
        return capture("batch", async () =>
          (await database.batch<T>(statements.map((s) => sources.get(s) ?? s))).map(observe),
        );
      },
    } as D1Database,
  };
}
