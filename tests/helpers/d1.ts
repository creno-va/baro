import { Database, type SQLQueryBindings } from "bun:sqlite";
import { readdir } from "node:fs/promises";

// Test-only D1 surface backed by real SQLite. Worker/runtime behavior is checked separately.
export async function createTestDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of (await readdir("drizzle"))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    sqlite.exec(await Bun.file(`drizzle/${file}`).text());
  }
  const executions = new WeakMap<
    object,
    () => {
      results: unknown[];
      success: true;
      meta: { changes: number };
    }
  >();
  function prepare(sql: string, values: SQLQueryBindings[] = []) {
    const execute = () => {
      const before = (sqlite.query("SELECT total_changes() AS count").get() as { count: number })
        .count;
      const results = sqlite.query(sql).all(...values);
      const after = (sqlite.query("SELECT total_changes() AS count").get() as { count: number })
        .count;
      return { results, success: true as const, meta: { changes: after - before } };
    };
    const statement = {
      bind(...parameters: SQLQueryBindings[]) {
        return prepare(sql, parameters);
      },
      async raw() {
        return sqlite.query(sql).values(...values);
      },
      async all() {
        return execute();
      },
      async first(column?: string) {
        const row = sqlite.query(sql).get(...values) as Record<string, unknown> | null;
        return column ? (row?.[column] ?? null) : row;
      },
      async run() {
        const result = sqlite.query(sql).run(...values);
        return { results: [], success: true, meta: { changes: result.changes } };
      },
    };
    executions.set(statement, execute);
    return statement;
  }
  const binding = {
    prepare,
    async batch(statements: object[]) {
      return sqlite.transaction(() =>
        statements.map((statement) => {
          const execute = executions.get(statement);
          if (!execute) throw new Error("Statement belongs to another test database");
          return execute();
        }),
      )();
    },
  } as unknown as D1Database;
  return { sqlite, binding, close: () => sqlite.close() };
}

export function testEnvironment(database: D1Database): Env {
  return {
    APP_ENV: "local",
    PUBLIC_BETA_ENABLED: "false",
    DB: database,
    BETTER_AUTH_URL: "http://localhost:4321",
    BETTER_AUTH_SECRET: "synthetic-secret-at-least-thirty-two-characters",
    GOOGLE_CLIENT_ID: "synthetic-google",
    GOOGLE_CLIENT_SECRET: "synthetic-google-secret",
    NAVER_CLIENT_ID: "synthetic-naver",
    NAVER_CLIENT_SECRET: "synthetic-naver-secret",
    KAKAO_CLIENT_ID: "synthetic-kakao",
    KAKAO_CLIENT_SECRET: "synthetic-kakao-secret",
  } as Env;
}

export async function signedSessionCookie(token: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `better-auth.session_token=${encodeURIComponent(`${token}.${base64}`)}`;
}
