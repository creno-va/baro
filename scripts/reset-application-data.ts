import { mkdir, readdir } from "node:fs/promises";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { emptySelfProfile, selfProfileSchema } from "../src/contracts/v2/self-profile";
import { createCaseDataCipher, type EnvelopeCipher } from "../src/server/crypto";
import { createV2Core, snapshotStatements } from "../src/server/db/v2-core";
import {
  directoryProjectionStatements,
  selfDirectoryProjection,
} from "../src/server/db/v2-directory-projection";
import knownTables from "./reset-schema-tables.json";

export const RESET_CONFIRMATION = "reset-both-databases-and-seed-ten-synthetic-lawyers";
export const SYNTHETIC_PROFILE_COUNT = 10;
export const RESET_SCHEMA = "0018_external_lookup_admission";
export type ResetEnvironment = "preview" | "production";
type Table = { name: string; sql: string; type?: string };
export type Seed = { sql: string; profiles: { id: string; ownerId: string; name: string }[] };
const quote = (v: unknown) =>
  v === null
    ? "NULL"
    : typeof v === "number" && Number.isFinite(v)
      ? String(v)
      : `'${String(v).replaceAll("'", "''")}'`;
const identifier = (name: string) => {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error("RESET_SCHEMA_INVALID");
  return `"${name}"`;
};
export async function resetMigrations() {
  const files = (await readdir("drizzle")).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  return (await Promise.all(files.map((name) => Bun.file(`drizzle/${name}`).text()))).join("\n");
}

/** Only new, explicitly synthetic records are encrypted; no customer row is read. */
export async function prepareSyntheticLawyers(cipher: EnvelopeCipher, now: string): Promise<Seed> {
  const statements = new WeakMap<object, { sql: string; values: unknown[] }>();
  const prepare = (sql: string, values: unknown[] = []): D1PreparedStatement => {
    const statement = { bind: (...args: unknown[]) => prepare(sql, args) } as D1PreparedStatement;
    statements.set(statement, { sql, values });
    return statement;
  };
  const core = createV2Core({ prepare } as unknown as D1Database, cipher);
  const render = (statement: D1PreparedStatement) => {
    const value = statements.get(statement);
    if (!value) throw new Error("RESET_SEED_STATEMENT_INVALID");
    let i = 0;
    const sql = value.sql.replace(/\?/g, () => quote(value.values[i++]));
    if (i !== value.values.length) throw new Error("RESET_SEED_PARAMETERS_INVALID");
    return `${sql};`;
  };
  const suffix = crypto.randomUUID();
  const fixtures = [
    {
      city: "seoul",
      name: "김예시",
      introduction:
        "민사와 부동산 사건의 사실관계를 차근차근 정리합니다. API 시연용 합성 프로필입니다.",
      officeName: "예시 법률사무소",
      address: "서울특별시 서초구 서초대로 1",
      region: "seoul",
      practiceAreas: ["civil", "real_estate"],
      email: "seoul@example.invalid",
      website: "https://example.com",
    },
    {
      city: "busan",
      name: "박합성",
      introduction: "노동과 기업 분야를 다룹니다. API 시연용 합성 프로필입니다.",
      officeName: "합성 법률사무소",
      address: "부산광역시 연제구 법원로 1",
      region: "busan",
      practiceAreas: ["labor", "company"],
      email: "busan@example.invalid",
      website: "",
    },
  ];
  const extra = [
    ["daegu", "이합성", "대구광역시", "criminal"],
    ["incheon", "최예시", "인천광역시", "family"],
    ["gwangju", "정합성", "광주광역시", "administrative"],
    ["daejeon", "강예시", "대전광역시", "tax"],
    ["ulsan", "조합성", "울산광역시", "labor"],
    ["sejong", "윤예시", "세종특별자치시", "company"],
    ["gyeonggi", "장합성", "경기도", "intellectual_property"],
    ["gangwon", "임예시", "강원특별자치도", "real_estate"],
  ];
  for (const [city, name, regionName, field] of extra) {
    if (!city || !name || !regionName || !field) throw new Error("RESET_FIXTURE_INVALID");
    fixtures.push({
      city,
      name,
      introduction: `${regionName}의 사건 정리 화면을 확인하기 위한 API 시연용 합성 프로필입니다. 실제 변호사나 사무소 정보가 아닙니다.`,
      officeName: `${name} 합성 법률사무소`,
      address: `${regionName} 합성 주소 1`,
      region: city,
      practiceAreas: [field, "civil"],
      email: `${city}@example.invalid`,
      website: "",
    });
  }
  const sql: string[] = [];
  const profiles: Seed["profiles"] = [];
  for (const { city, ...fields } of fixtures) {
    const ownerId = `synthetic-owner-${city}-${suffix}`,
      id = `synthetic-lawyer-${city}-${suffix}`;
    const snapshotId = crypto.randomUUID(),
      claim = crypto.randomUUID();
    const profile = selfProfileSchema.parse({
      ...emptySelfProfile(id),
      ...fields,
      revision: 2,
      published: true,
      verificationStatus: "self_declared",
    });
    sql.push(
      render(
        core.statement(
          "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,0,?,?)",
          [ownerId, fields.name, `${ownerId}@example.invalid`, Date.parse(now), Date.parse(now)],
        ),
      ),
    );
    sql.push(
      render(
        core.statement("INSERT INTO user_consents VALUES(?,?,?,?,1,?)", [
          ownerId,
          CURRENT_POLICY_VERSIONS.termsVersion,
          CURRENT_POLICY_VERSIONS.privacyVersion,
          CURRENT_POLICY_VERSIONS.aiNoticeVersion,
          now,
        ]),
      ),
    );
    for (const [key, value] of [
      [`account-type:${ownerId}`, "lawyer"],
      [`synthetic-seed:${ownerId}`, "operator-authorized-synthetic-fixture"],
    ])
      sql.push(
        render(
          core.statement("INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?)", [
            key,
            value,
            now,
          ]),
        ),
      );
    sql.push(
      render(
        core.statement(
          "INSERT INTO v2_profiles(id,owner_id,created_at,updated_at) VALUES(?,?,?,?)",
          [id, ownerId, now, now],
        ),
      ),
    );
    sql.push(
      render(
        core.statement(
          "INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) VALUES(?,?,?,2)",
          [claim, ownerId, id],
        ),
      ),
    );
    sql.push(
      ...(
        await snapshotStatements(
          core,
          {
            id: snapshotId,
            ownerId,
            workspaceId: null,
            purpose: "profile_revision",
            targetId: id,
            revision: 2,
            now,
          },
          profile,
          claim,
        )
      ).map(render),
    );
    const consent = await core.encrypt("v2_consents", snapshotId, ownerId, 2, {
      profileId: id,
      published: true,
      scope: "photo/introduction/practice/office/contact/portfolio",
      acceptedAt: now,
    });
    sql.push(
      render(
        core.statement(
          "INSERT INTO v2_consents(id,owner_id,kind,version,revision,encrypted_payload,created_at) VALUES(?,?,'profile_publication','mvp-self-profile-public-v1',2,?,?)",
          [snapshotId, ownerId, consent, now],
        ),
      ),
    );
    const projection = await selfDirectoryProjection(core, ownerId, snapshotId, profile, now);
    sql.push(
      ...directoryProjectionStatements(core, projection, claim).map(render),
      render(core.finish(claim)),
    );
    profiles.push({ id, ownerId, name: fields.name });
  }
  return { sql: sql.join("\n"), profiles };
}

/** Explicit full-data reset: retain only D1 infrastructure/migration history. */
export function applicationResetSql(
  tables: Table[],
  seed: Seed,
  migrations: string,
  capacity: { environment: ResetEnvironment; bytes: number },
) {
  const actual = tables.filter(
    (t) =>
      (t.type === "table" || t.sql.startsWith("CREATE TABLE")) &&
      t.name !== "_cf_KV" &&
      !t.name.startsWith("sqlite_"),
  );
  if (
    actual.length !== knownTables.length ||
    actual.some((t) => !knownTables.includes(t.name)) ||
    !migrations.includes(RESET_SCHEMA)
  )
    throw new Error("RESET_SCHEMA_DRIFT");
  if (!Number.isSafeInteger(capacity.bytes) || capacity.bytes < 1 || capacity.bytes > 100000000000)
    throw new Error("RESET_CAPACITY_INVALID");
  const remaining = actual.filter((t) => t.name !== "d1_migrations");
  const refs = (t: Table) =>
    [...t.sql.matchAll(/REFERENCES\s+[`"[]?([a-z0-9_]+)/gi)].map((m) => m[1]);
  const ordered: string[] = [];
  while (remaining.length) {
    const index = remaining.findIndex(
      (t) => !remaining.some((other) => other !== t && refs(other).includes(t.name)),
    );
    if (index < 0) throw new Error("RESET_FOREIGN_KEY_CYCLE");
    const table = remaining.splice(index, 1)[0];
    if (!table) throw new Error("RESET_SCHEMA_INVALID");
    ordered.push(table.name);
  }
  const ids = seed.profiles.map((p) => quote(p.id)).join(",");
  return [
    "INSERT INTO v2_directory_epoch(id,revision) SELECT 0,1 WHERE EXISTS(SELECT 1 FROM v2_jobs WHERE status IN ('running','validating'));",
    "PRAGMA defer_foreign_keys=ON;",
    ...tables
      .filter(
        (t) =>
          (t.type === "trigger" || t.sql.startsWith("CREATE TRIGGER")) &&
          !t.name.startsWith("_cf_"),
      )
      .map((t) => `DROP TRIGGER ${identifier(t.name)};`),
    ...tables
      .filter(
        (t) => (t.type === "view" || t.sql.startsWith("CREATE VIEW")) && !t.name.startsWith("_cf_"),
      )
      .map((t) => `DROP VIEW ${identifier(t.name)};`),
    ...ordered.map((name) => `DROP TABLE ${identifier(name)};`),
    migrations,
    `INSERT INTO v2_cost_execution_policy(environment,limits_enabled) VALUES(${quote(capacity.environment)},0) ON CONFLICT(environment) DO UPDATE SET limits_enabled=0;`,
    `INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES(${quote(capacity.environment)},${capacity.bytes}) ON CONFLICT(environment) DO UPDATE SET capacity_bytes=excluded.capacity_bytes;`,
    `UPDATE v2_directory_epoch SET revision=${Date.now()} WHERE id=1;`,
    seed.sql,
    `INSERT INTO v2_directory_epoch(id,revision) SELECT 0,1 WHERE (SELECT count(*) FROM user)!=${SYNTHETIC_PROFILE_COUNT} OR (SELECT count(*) FROM v2_directory_entries WHERE profile_id IN (${ids}))!=${SYNTHETIC_PROFILE_COUNT};`,
  ].join("\n");
}

async function wrangler(environment: ResetEnvironment, args: string[]) {
  const child = Bun.spawn(
    [
      "node",
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      ...args,
      "--env",
      environment,
      "--json",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (await child.exited) throw new Error("RESET_DATABASE_OPERATION_FAILED");
  const begin = out.indexOf("[\n");
  if (begin < 0) throw new Error("RESET_DATABASE_RECEIPT_INVALID");
  const result = JSON.parse(out.slice(begin)) as {
    success?: boolean;
    results?: Record<string, unknown>[];
  }[];
  if (!Array.isArray(result) || result.some((r) => r.success !== true))
    throw new Error("RESET_DATABASE_RECEIPT_INVALID");
  return result.flatMap((r) => r.results ?? []);
}
async function verifySeed(environment: ResetEnvironment, seed: Seed, exact: boolean) {
  const origin = environment === "preview" ? "https://preview.baro.site" : "https://baro.site";
  for (const profile of seed.profiles) {
    const response = await fetch(`${origin}/api/v2/lawyers/self-service/${profile.id}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("RESET_SYNTHETIC_PROFILE_NOT_READABLE");
    const actual = selfProfileSchema.parse(await response.json());
    if (
      actual.id !== profile.id ||
      actual.name !== profile.name ||
      actual.verificationStatus !== "self_declared" ||
      !actual.published ||
      !actual.introduction.includes("합성 프로필")
    )
      throw new Error("RESET_SYNTHETIC_PROFILE_MISMATCH");
  }
  if (exact) {
    const response = await fetch(`${origin}/api/v2/lawyers/directory`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const body = (await response.json()) as { items?: { id: string }[] };
    if (
      !response.ok ||
      body.items?.length !== SYNTHETIC_PROFILE_COUNT ||
      body.items.some((p) => !seed.profiles.some((s) => s.id === p.id))
    )
      throw new Error("RESET_DIRECTORY_MISMATCH");
    const health = await fetch(`${origin}/api/health/ready`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const ready = (await health.json()) as { status: string; schemaVersion: string };
    if (!health.ok || ready.status !== "ready" || ready.schemaVersion !== RESET_SCHEMA)
      throw new Error("RESET_READINESS_FAILED");
  }
}

if (import.meta.main) {
  let phase = "preparation";
  const environment = process.env.RESET_ENVIRONMENT;
  const directory = ".wrangler/reset";
  let seed: Seed | undefined;
  let restoreBookmark: string | undefined;
  try {
    if (
      (environment !== "preview" && environment !== "production") ||
      process.env.RESET_CONFIRMATION !== RESET_CONFIRMATION ||
      !process.env.CASE_DATA_KEY_V1 ||
      !process.env.CLOUDFLARE_API_TOKEN
    )
      throw new Error("RESET_AUTHORIZATION_REQUIRED");
    await mkdir(directory, { recursive: true });
    const database = environment === "preview" ? "baro-preview" : "baro-production";
    const query = (sql: string) =>
      wrangler(environment, ["execute", database, "--remote", "--command", sql]);
    const schema = (await query(
      "SELECT name,sql,type FROM sqlite_master WHERE type IN ('table','trigger','view') AND name NOT LIKE 'sqlite_%'",
    )) as Table[];
    const metadata = await query("SELECT value FROM app_metadata WHERE key='schema_version'");
    if (metadata[0]?.value !== RESET_SCHEMA) throw new Error("RESET_SCHEMA_DRIFT");
    const active = await query(
      "SELECT count(*) AS n FROM v2_jobs WHERE status IN ('running','validating')",
    );
    if (Number(active[0]?.n) !== 0) throw new Error("RESET_ACTIVE_EXECUTION");
    const cipher = await createCaseDataCipher({ CASE_DATA_KEY_V1: process.env.CASE_DATA_KEY_V1 });
    seed = await prepareSyntheticLawyers(cipher, new Date().toISOString());
    const capacityRows = await query(
      `SELECT capacity_bytes FROM v2_physical_storage_capacity WHERE environment=${quote(environment)}`,
    );
    const reset = applicationResetSql(schema, seed, await resetMigrations(), {
      environment,
      bytes: Number(capacityRows[0]?.capacity_bytes),
    });
    const bookmarkChild = Bun.spawn(
      [
        "node",
        "node_modules/wrangler/bin/wrangler.js",
        "d1",
        "time-travel",
        "info",
        database,
        "--env",
        environment,
        "--json",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [bookmarkText] = await Promise.all([
      new Response(bookmarkChild.stdout).text(),
      new Response(bookmarkChild.stderr).text(),
    ]);
    if (await bookmarkChild.exited) throw new Error("RESET_RESTORE_POINT_REQUIRED");
    const bookmarkBody = JSON.parse(bookmarkText.slice(bookmarkText.indexOf("{"))) as {
      bookmark?: string;
    };
    if (!bookmarkBody.bookmark) throw new Error("RESET_RESTORE_POINT_REQUIRED");
    restoreBookmark = bookmarkBody.bookmark;
    await Bun.write(
      `${directory}/receipt-${environment}.json`,
      JSON.stringify({ environment, phase: "restore_point_recorded", restoreBookmark }, null, 2),
    );
    const seedFile = `${directory}/seed-${environment}.sql`,
      resetFile = `${directory}/reset-${environment}.sql`;
    await Bun.write(seedFile, seed.sql);
    await Bun.write(resetFile, reset);
    phase = "synthetic_probe";
    await wrangler(environment, ["execute", database, "--remote", "--file", seedFile, "--yes"]);
    // Verify only the just-created synthetic data with the deployed key before clearing anything.
    await verifySeed(environment, seed, false);
    phase = "application_reset";
    await wrangler(environment, ["execute", database, "--remote", "--file", resetFile, "--yes"]);
    phase = "verification";
    await verifySeed(environment, seed, true);
    const state = await query(
      "SELECT (SELECT count(*) FROM user) AS users,(SELECT count(*) FROM account) AS accounts,(SELECT count(*) FROM session) AS sessions,(SELECT count(*) FROM cases) AS legacyCases,(SELECT count(*) FROM v2_workspaces) AS workspaces,(SELECT count(*) FROM v2_files) AS files,(SELECT count(*) FROM v2_reports) AS reports,(SELECT count(*) FROM v2_profiles) AS profiles,(SELECT count(*) FROM v2_cost_attempts) AS oldCostAttempts,(SELECT count(*) FROM v2_paid_holds) AS oldPaidHolds,(SELECT count(*) FROM legacy_ai_attempts) AS oldLegacyAttempts",
    );
    const actual = state[0];
    if (
      actual?.users !== SYNTHETIC_PROFILE_COUNT ||
      actual.profiles !== SYNTHETIC_PROFILE_COUNT ||
      Object.entries(actual).some(([k, v]) => !["users", "profiles"].includes(k) && v !== 0)
    )
      throw new Error("RESET_APPLICATION_ROWS_REMAIN");
    if ((await query("PRAGMA foreign_key_check")).length)
      throw new Error("RESET_FOREIGN_KEY_FAILED");
    phase = "complete";
    const receipt = {
      environment,
      phase,
      operator: process.env.GITHUB_ACTOR ?? "local",
      sha: process.env.GITHUB_SHA,
      at: new Date().toISOString(),
      state: actual,
      profiles: seed.profiles,
      restoreBookmark,
      fullDatabaseDataReset: true,
      existingCustomerPayloadsRead: 0,
    };
    await Bun.write(`${directory}/receipt-${environment}.json`, JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt));
  } catch (error) {
    // A failed key probe removes only the newly created synthetic accounts.
    // An ambiguous reset response never triggers another destructive mutation.
    if (
      phase === "synthetic_probe" &&
      seed &&
      (environment === "preview" || environment === "production")
    ) {
      const owners = seed.profiles.map((p) => quote(p.ownerId)).join(",");
      const keys = seed.profiles
        .flatMap((p) => [`account-type:${p.ownerId}`, `synthetic-seed:${p.ownerId}`])
        .map(quote)
        .join(",");
      try {
        await wrangler(environment, [
          "execute",
          environment === "preview" ? "baro-preview" : "baro-production",
          "--remote",
          "--command",
          `DELETE FROM user WHERE id IN (${owners}); DELETE FROM app_metadata WHERE key IN (${keys});`,
        ]);
      } catch {
        phase = "synthetic_probe_cleanup_required";
      }
    }
    await mkdir(directory, { recursive: true });
    const receipt = {
      environment,
      phase,
      error:
        error instanceof Error && /^RESET_[A-Z_]+$/.test(error.message)
          ? error.message
          : "RESET_FAILED",
      seedProfiles: seed?.profiles,
      restoreBookmark,
    };
    await Bun.write(
      `${directory}/receipt-${environment ?? "unknown"}.json`,
      JSON.stringify(receipt, null, 2),
    );
    console.error(JSON.stringify(receipt));
    process.exitCode = 1;
  }
}
