import { expect, test } from "bun:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import {
  installDrillSchema,
  loadDrillMigrations,
  seedDrillFixture,
} from "../scripts/isolated-recovery-drill-fixture";
import { remoteBudgetD1 } from "../scripts/remote-budget-d1";

test("drill schema and fixture execute through the remote adapter on native local D1", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("local drill regression"); } }',
      compatibilityDate: "2026-10-01",
      d1Databases: ["DRILL"],
      cf: false,
      unsafeRegisterWorker: false,
    }),
  );
  try {
    const native = (await mf.getD1Database("DRILL")) as unknown as D1Database;
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      const { batch } = JSON.parse(String(init.body)) as {
        batch: { sql: string; params: unknown[] }[];
      };
      return Response.json({
        success: true,
        result: await native.batch(
          batch.map(({ sql, params }) => native.prepare(sql).bind(...params)),
        ),
      });
    }) as typeof fetch;
    const db = remoteBudgetD1("synthetic-test-token", "local-account", "local-database", fetcher);
    await installDrillSchema(db, await loadDrillMigrations());
    const fixture = await seedDrillFixture(db, Date.now());
    const observed = await fixture.observe(false);
    expect(observed.target).toEqual([1, 2, 1, 1, 1]);
    expect(observed.control).toEqual([1, 1, 1, 1, 1]);
  } finally {
    await mf.dispose();
  }
}, 30_000);
