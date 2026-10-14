/** Explicit synthetic transport fault after a real SQLite statement commits. */
export function loseD1Response(database: D1Database, match: (sql: string) => boolean) {
  const prepare = database.prepare.bind(database),
    batch = database.batch.bind(database);
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  let lost = false;
  const wrap = (base: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const result = {
      bind: (...values: unknown[]) => wrap(base.bind(...values), sql),
      async all<T>() {
        const value = await base.all<T>();
        if (!lost && match(sql)) {
          lost = true;
          throw new Error("SYNTHETIC_D1_RESPONSE_LOST");
        }
        return value;
      },
      run: <T>() => base.run<T>(),
      first: <T>(column?: string) =>
        column === undefined ? base.first<T>() : base.first<T>(column),
      raw: <T>() => base.raw<T>(),
    } as D1PreparedStatement;
    originals.set(result, base);
    return result;
  };
  database.prepare = (sql) => wrap(prepare(sql), sql);
  database.batch = <T>(statements: D1PreparedStatement[]) =>
    batch<T>(statements.map((s) => originals.get(s) ?? s));
  return () => lost;
}
