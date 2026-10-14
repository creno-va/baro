/** Native D1 measurements, including auth queries outside the domain core. */
export function measureD1Work(database: D1Database) {
  const work = { statements: 0, rowsRead: 0, rowsWritten: 0 };
  const sources = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const observe = <T>(value: D1Result<T>) => {
    if (
      !Number.isSafeInteger(value.meta.rows_read) ||
      !Number.isSafeInteger(value.meta.rows_written)
    )
      throw new Error("Native D1 measurement missing");
    work.statements++;
    work.rowsRead += value.meta.rows_read;
    work.rowsWritten += value.meta.rows_written;
    return value;
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const result = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      all: async <T>() => observe(await statement.all<T>()),
      run: async <T>() => observe(await statement.run<T>()),
      async first<T>(column?: string) {
        const row = observe(await statement.all<Record<string, unknown>>()).results[0];
        return (column ? (row?.[column] ?? null) : (row ?? null)) as T | null;
      },
      async raw<T>(options?: { columnNames?: boolean }) {
        const rows = observe(await statement.all<Record<string, unknown>>()).results;
        const values = rows.map((row) => Object.values(row));
        return (options?.columnNames ? [Object.keys(rows[0] ?? {}), ...values] : values) as T[];
      },
    } as D1PreparedStatement;
    sources.set(result, statement);
    return result;
  };
  return {
    work,
    reset: () => Object.assign(work, { statements: 0, rowsRead: 0, rowsWritten: 0 }),
    binding: {
      prepare: (sql: string) => wrap(database.prepare(sql)),
      async batch<T>(statements: D1PreparedStatement[]) {
        return (await database.batch<T>(statements.map((s) => sources.get(s) ?? s))).map(observe);
      },
    } as D1Database,
  };
}
