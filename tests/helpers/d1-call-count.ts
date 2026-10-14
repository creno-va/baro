/** Local D1 method counts; these are not native rows read or network timings. */
export function countD1Calls(database: D1Database) {
  const work = { calls: 0, statements: 0 };
  const sources = new WeakMap<
    D1PreparedStatement,
    { statement: D1PreparedStatement; sql: string }
  >();
  let after: (sql: string[]) => void = () => {};
  let before: (sql: string[]) => void = () => {};
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const result = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values), sql),
      async all<T>() {
        before([sql]);
        work.calls++;
        work.statements++;
        const result = await statement.all<T>();
        after([sql]);
        return result;
      },
      async first<T>(column?: string) {
        before([sql]);
        work.calls++;
        work.statements++;
        const result =
          column === undefined ? await statement.first<T>() : await statement.first<T>(column);
        after([sql]);
        return result;
      },
      async raw<T>(options?: { columnNames?: boolean }) {
        before([sql]);
        work.calls++;
        work.statements++;
        const result = options?.columnNames
          ? await statement.raw<T>({ columnNames: true })
          : await statement.raw<T>();
        after([sql]);
        return result;
      },
      async run<T>() {
        before([sql]);
        work.calls++;
        work.statements++;
        const result = await statement.run<T>();
        after([sql]);
        return result;
      },
    } as D1PreparedStatement;
    sources.set(result, { statement, sql });
    return result;
  };
  return {
    work,
    reset: () => Object.assign(work, { calls: 0, statements: 0 }),
    before: (hook: typeof before) => {
      before = hook;
    },
    after: (hook: typeof after) => {
      after = hook;
    },
    binding: {
      prepare: (sql: string) => wrap(database.prepare(sql), sql),
      async batch<T>(statements: D1PreparedStatement[]) {
        const inputs = statements.map((statement) => {
          const source = sources.get(statement);
          if (!source) throw Error("Synthetic statement missing");
          return source;
        });
        before(inputs.map((input) => input.sql));
        work.calls++;
        work.statements += inputs.length;
        const result = await database.batch<T>(inputs.map((input) => input.statement));
        after(inputs.map((input) => input.sql));
        return result;
      },
    } as D1Database,
  };
}
