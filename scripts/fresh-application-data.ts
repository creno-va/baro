import { mkdir } from "node:fs/promises";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createSelfProfileService } from "../src/server/modules/lawyers/self-profile";
import { transitionFreshBinding } from "./fresh-database-binding";
import { remoteBudgetD1 } from "./remote-budget-d1";
import {
  prepareSyntheticLawyers,
  type Seed,
  SYNTHETIC_PROFILE_COUNT,
} from "./synthetic-lawyer-seed";

export const FRESH_CONFIRMATION = "prepare-fresh-databases-with-ten-synthetic-lawyers";
export const FRESH_DATABASES = {
  preview: {
    id: "c1612b14-6ab1-4d2e-82dc-33e596b31337",
    name: "baro-preview-fresh-20261029-e6a9c119",
    original: "e8cdcf75-5bd8-469e-848e-f31816df4327",
  },
  production: {
    id: "fa914862-848d-4eb1-bc69-e82a020df11a",
    name: "baro-production-fresh-20261029-e6a9c119",
    original: "d315e93f-2fac-4cc2-bf99-e9d6eb31523f",
  },
} as const;
const account = "9e844969d0c44b2449f3951d1f301654";
export function assertFreshTarget(environment: keyof typeof FRESH_DATABASES, id: string) {
  if (id !== FRESH_DATABASES[environment].id) throw new Error("FRESH_TARGET_REQUIRED");
}
export async function assertEmpty(db: D1Database) {
  const rows = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV','d1_migrations')",
    )
    .all();
  if (rows.results.length) throw new Error("FRESH_DATABASE_NOT_EMPTY");
}
async function wrangler(config: string, args: string[]) {
  const child = Bun.spawn(
    ["node", "node_modules/wrangler/bin/wrangler.js", "d1", ...args, "--config", config],
    { stdout: "pipe", stderr: "pipe" },
  );
  await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (await child.exited) throw new Error("FRESH_DATABASE_OPERATION_FAILED");
}
export async function verifyFreshState(db: D1Database) {
  const state = await db
    .prepare(
      "SELECT (SELECT count(*) FROM user) AS users,(SELECT count(*) FROM v2_profiles) AS profiles,(SELECT count(*) FROM v2_directory_entries) AS directory,(SELECT count(*) FROM account) AS accounts,(SELECT count(*) FROM session) AS sessions,(SELECT count(*) FROM cases) AS legacyCases,(SELECT count(*) FROM v2_workspaces) AS workspaces,(SELECT count(*) FROM v2_files) AS files,(SELECT count(*) FROM v2_reports) AS reports,(SELECT count(*) FROM v2_jobs) AS jobs,(SELECT count(*) FROM v2_cost_attempts) AS attempts,(SELECT count(*) FROM v2_paid_holds) AS holds",
    )
    .first<Record<string, number>>();
  if (
    !state ||
    Object.entries(state).some(
      ([key, value]) =>
        value !== (["users", "profiles", "directory"].includes(key) ? SYNTHETIC_PROFILE_COUNT : 0),
    )
  )
    throw new Error("FRESH_STATE_INVALID");
  if ((await db.prepare("PRAGMA foreign_key_check").all()).results.length)
    throw new Error("FRESH_FOREIGN_KEYS_INVALID");
  if (
    (await db
      .prepare("SELECT value FROM app_metadata WHERE key='schema_version'")
      .first("value")) !== "0018_external_lookup_admission"
  )
    throw new Error("FRESH_SCHEMA_INVALID");
  return state;
}

/** Resume only the ten authorized synthetic records in an explicitly allowlisted fresh target. */
export async function existingSyntheticSeed(db: D1Database): Promise<Seed | null> {
  const schema = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user'")
    .first();
  if (!schema) return null;
  await verifyFreshState(db);
  const profiles = (
    await db
      .prepare(
        "SELECT p.id,p.owner_id AS ownerId,u.name FROM v2_profiles p JOIN user u ON u.id=p.owner_id WHERE p.id LIKE 'synthetic-lawyer-%' AND u.id LIKE 'synthetic-owner-%' AND u.email LIKE '%@example.invalid' AND EXISTS(SELECT 1 FROM app_metadata m WHERE m.key='synthetic-seed:'||u.id AND m.value='operator-authorized-synthetic-fixture')",
      )
      .all<{ id: string; ownerId: string; name: string }>()
  ).results;
  if (profiles.length !== SYNTHETIC_PROFILE_COUNT) throw new Error("FRESH_RESUME_NOT_SYNTHETIC");
  return { sql: "", profiles };
}

if (import.meta.main) {
  let phase = "preparation";
  const environment = process.env.FRESH_ENVIRONMENT;
  const directory = ".wrangler/fresh";
  try {
    if (
      (environment !== "preview" && environment !== "production") ||
      process.env.FRESH_CONFIRMATION !== FRESH_CONFIRMATION ||
      !process.env.CLOUDFLARE_API_TOKEN ||
      !process.env.CASE_DATA_KEY_V1
    )
      throw new Error("FRESH_AUTHORIZATION_REQUIRED");
    const target = FRESH_DATABASES[environment];
    assertFreshTarget(environment, target.id);
    const db = remoteBudgetD1(process.env.CLOUDFLARE_API_TOKEN, account, target.id);
    const cipher = await createCaseDataCipher({ CASE_DATA_KEY_V1: process.env.CASE_DATA_KEY_V1 });
    let seed = await existingSyntheticSeed(db);
    if (!seed) {
      await assertEmpty(db);
      // Read only the original technical capacity, never original customer rows or payloads.
      const original = remoteBudgetD1(process.env.CLOUDFLARE_API_TOKEN, account, target.original);
      const capacity = await original
        .prepare("SELECT capacity_bytes FROM v2_physical_storage_capacity WHERE environment=?")
        .bind(environment)
        .first<number>("capacity_bytes");
      if (!Number.isSafeInteger(capacity) || !capacity || capacity < 1)
        throw new Error("FRESH_CAPACITY_INVALID");
      seed = await prepareSyntheticLawyers(cipher, new Date().toISOString());
      await mkdir(directory, { recursive: true });
      const config = `${directory}/config-${environment}.json`;
      await Bun.write(
        config,
        JSON.stringify({
          name: `baro-fresh-${environment}`,
          account_id: account,
          d1_databases: [
            {
              binding: "DB",
              database_name: target.name,
              database_id: target.id,
              migrations_dir: "../../drizzle",
            },
          ],
        }),
      );
      phase = "migrations";
      await wrangler(config, ["migrations", "apply", target.name, "--remote"]);
      phase = "synthetic_seed";
      const file = `${directory}/seed-${environment}.sql`;
      await Bun.write(
        file,
        `${seed.sql}\nINSERT INTO v2_cost_execution_policy(environment,limits_enabled) VALUES('${environment}',0) ON CONFLICT(environment) DO UPDATE SET limits_enabled=0;\nINSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('${environment}',${capacity}) ON CONFLICT(environment) DO UPDATE SET capacity_bytes=excluded.capacity_bytes;\nUPDATE v2_directory_epoch SET revision=${Date.now()} WHERE id=1;`,
      );
      await wrangler(config, ["execute", target.name, "--remote", "--file", file, "--yes"]);
    }
    phase = "verification";
    const state = await verifyFreshState(db);
    const profiles = createSelfProfileService(createV2Core(db, cipher));
    for (const item of seed.profiles) {
      const actual = await profiles.get(item.id);
      if (
        actual.name !== item.name ||
        actual.verificationStatus !== "self_declared" ||
        !actual.published ||
        !actual.introduction.includes("합성 프로필")
      )
        throw new Error("FRESH_SYNTHETIC_PROFILE_INVALID");
    }
    phase = "binding_transition";
    const transition = await transitionFreshBinding(environment, process.env.CLOUDFLARE_API_TOKEN);
    const receipt = {
      transition,
      environment,
      phase: "complete",
      databaseId: target.id,
      originalDatabasePreserved: true,
      bindingChanged: true,
      state,
      profiles: seed.profiles,
      sha: process.env.GITHUB_SHA,
      at: new Date().toISOString(),
    };
    await Bun.write(`${directory}/receipt-${environment}.json`, JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt));
  } catch (error) {
    await mkdir(directory, { recursive: true });
    const receipt = {
      environment,
      phase,
      originalDatabasePreserved: true,
      bindingState:
        phase === "binding_transition"
          ? error instanceof Error && error.message === "FRESH_BINDING_ROLLBACK_REQUIRED"
            ? "manual_check_required"
            : "original_restored"
          : "unchanged",
      error:
        error instanceof Error && /^FRESH_[A-Z_0-9]+$/.test(error.message)
          ? error.message
          : "FRESH_FAILED",
    };
    await Bun.write(
      `${directory}/receipt-${environment ?? "unknown"}.json`,
      JSON.stringify(receipt),
    );
    console.error(JSON.stringify(receipt));
    process.exitCode = 1;
  }
}
