/** Preserve native methods, arguments, bound statement identities and results.
 * The observer owns only the existing asynchronous method await. */
export type D1AwaitObserver = <T>(
  statements: number,
  action: () => Promise<T>,
  metadata?: (result: T) => readonly D1Result<unknown>[],
) => Promise<T>;

export function observeD1Awaits(database: D1Database, capture: D1AwaitObserver): D1Database {
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
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
  return {
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
}
