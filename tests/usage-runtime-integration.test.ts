import { expect, test } from "bun:test";
import { Hono } from "hono";
import { v2UsageSchema } from "../src/contracts/v2";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createUsageApi } from "../src/server/api/v2/usage";
import { seedTestSession } from "./helpers/session";
import { fixture, NOW } from "./helpers/storage-capacity";

// Actual SQL/auth/composition; the stored funding/pricing evidence is synthetic.
// No provider call, reservation, deployment or billing observation occurs here.
test("usage route discovers current durable proofs without activating or charging budget", async () => {
  const f = await fixture();
  const owner = await seedTestSession(f.db, { consent: true });
  let now = NOW;
  const app = new Hono<ApiEnvironment>().route(
    "/v2/me",
    createUsageApi({ environment: "preview", clock: () => now }),
  );
  const read = async (env = owner.env) => {
    const response = await app.request("/v2/me/usage", { headers: { cookie: owner.cookie } }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    return v2UsageSchema.parse(await response.json());
  };
  const before = f.db.sqlite.query("SELECT * FROM v2_monthly_budget").all();
  expect((await read()).waitReasons).not.toContain("monthly_budget");
  expect(f.db.sqlite.query("SELECT * FROM v2_monthly_budget").all()).toEqual(before);
  expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_cost_attempts").get()).toEqual({
    count: 0,
  });

  // A preview proof is never usable as production evidence.
  expect(
    (await read({ ...owner.env, APP_ENV: "production", PUBLIC_BETA_ENABLED: "true" })).waitReasons,
  ).toContain("monthly_budget");
  // The KST month changes at UTC 15:00, even while proof dates remain fresh.
  now = "2026-10-31T15:00:00.000Z";
  expect((await read()).waitReasons).toContain("monthly_budget");
  now = NOW;
  f.db.sqlite.query("UPDATE v2_runtime_controls SET phase='frozen'").run();
  expect((await read()).waitReasons).toContain("monthly_budget");
});

test("usage discovery respects expiry, immutable evidence and exhausted funding", async () => {
  const f = await fixture();
  const owner = await seedTestSession(f.db, { consent: true });
  let now = NOW;
  const app = new Hono<ApiEnvironment>().route(
    "/v2/me",
    createUsageApi({ environment: "preview", clock: () => now }),
  );
  const waits = async () =>
    v2UsageSchema.parse(
      await (
        await app.request("/v2/me/usage", { headers: { cookie: owner.cookie } }, owner.env)
      ).json(),
    ).waitReasons;
  expect(await waits()).not.toContain("monthly_budget");
  now = f.fp.validUntil;
  expect(await waits()).toContain("monthly_budget");
  now = NOW;
  expect(() =>
    f.db.sqlite
      .query("UPDATE v2_runtime_proofs SET digest=? WHERE id=?")
      .run("b".repeat(64), f.pp.id),
  ).toThrow("IMMUTABLE_RUNTIME_EVIDENCE");
  expect(await waits()).not.toContain("monthly_budget");
  f.db.sqlite.query("UPDATE v2_monthly_budget SET settled_krw=limit_krw").run();
  expect(await waits()).toContain("monthly_budget");
});
