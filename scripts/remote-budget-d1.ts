import { z } from "zod";

const resultsSchema = z.object({
  success: z.literal(true),
  result: z.array(
    z.object({
      success: z.literal(true),
      results: z.array(z.record(z.string(), z.unknown())),
      meta: z.object({ changes: z.number() }).passthrough(),
    }),
  ),
});

/** Deployment-only authenticated D1 adapter. Never prints tokens, SQL or row contents. */
export function remoteBudgetD1(token: string, account: string, database: string, fetcher = fetch) {
  type Query = { sql: string; params: unknown[] };
  const queries = new WeakMap<D1PreparedStatement, Query>();
  async function execute(batch: Query[]) {
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ batch }),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok) throw new Error("AI_RUNTIME_D1_UNAVAILABLE");
    const body = resultsSchema.safeParse(await response.json());
    if (!body.success || body.data.result.length !== batch.length)
      throw new Error("AI_RUNTIME_D1_INVALID_RESPONSE");
    return body.data.result;
  }
  function statement(sql: string, params: unknown[] = []): D1PreparedStatement {
    const result = {
      bind: (...values: unknown[]) => statement(sql, values),
      async first<T>(column?: string): Promise<T | null> {
        const row = (await execute([{ sql, params }]))[0]?.results[0];
        return (row ? (column ? row[column] : row) : null) as T | null;
      },
      async all<T>() {
        return (await execute([{ sql, params }]))[0] as unknown as D1Result<T>;
      },
      async run<T>() {
        return (await execute([{ sql, params }]))[0] as unknown as D1Result<T>;
      },
    } as D1PreparedStatement;
    queries.set(result, { sql, params });
    return result;
  }
  return {
    prepare: statement,
    async batch<T>(statements: D1PreparedStatement[]) {
      return (await execute(
        statements.map((s) => {
          const query = queries.get(s);
          if (!query) throw new Error("AI_RUNTIME_FOREIGN_STATEMENT");
          return query;
        }),
      )) as unknown as D1Result<T>[];
    },
  } as D1Database;
}
