import { z } from "zod";
import { timestampSchema } from "../src/contracts";
import { createCaseDataCipher, type EnvelopeCipher } from "../src/server/crypto";
import { usageDateKst } from "../src/server/db/repository";
import { quotaPredicate } from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import { runtimeDigest } from "../src/server/db/v2-paid-runtime";
import {
  createV2WorkspaceRepository,
  workspaceCreateDataSchema,
} from "../src/server/db/v2-workspace";
import {
  PREVIEW_FIXTURE_PROFILE_ID as PROFILE_ID,
  readPreviewFixtureSource,
} from "./preview-fixture-source";
import { remoteBudgetD1 } from "./remote-budget-d1";
import { verifyRelease } from "./verify-release";

// One reviewed fixture, not a generic data loader. These identifiers are never receipt fields.
const FIXTURE_KEY = "baro-preview-customer-intake-20261015-v1";
const INTENT_KEY = "baro-test-fixture:customer-intake-v1:attempt";
const INTENT_VALUE = "single-reviewed-synthetic-intake-attempt-v1";
const PROBE_KEY = "baro-test-fixture:customer-intake-v1:atomicity-probe";
const PROBE_VALUE = "rollback-probe-only-v1";
const EXPECTED_SCHEMA = "0018_external_lookup_admission";
const ACCOUNT = "9e844969d0c44b2449f3951d1f301654";
const DATABASE = "c1612b14-6ab1-4d2e-82dc-33e596b31337";
const ORIGIN = "https://preview.baro.site";
const DATA = workspaceCreateDataSchema.parse({
  narrative:
    "합성 검증 사건입니다. 테스트 임차인은 2026년 9월 30일 계약 종료 후 가상주택을 인도했으나 임대인으로부터 보증금 500만 원을 아직 돌려받지 못했습니다. 계약서와 이체내역이 있다고 가정합니다. 실제 인물이나 계약은 없으며 사실 정리와 확인할 자료만 시험합니다.",
  subjectContext: "individual",
  jurisdiction: "KR",
});

const codes = [
  "OK",
  "ABSENT",
  "CONFIGURATION_INVALID",
  "RELEASE_NOT_VERIFIED",
  "SCHEMA_MISMATCH",
  "SOURCE_UNAVAILABLE",
  "SOURCE_MARKER_MISMATCH",
  "ACCESS_OR_QUOTA_REJECTED",
  "FIXTURE_TOMBSTONED",
  "FIXTURE_INCOMPLETE",
  "ATTEMPT_UNRESOLVED",
  "ATOMICITY_NOT_PROVEN",
  "CLAIM_REJECTED",
  "DEPENDENCY_UNAVAILABLE",
] as const;
type Code = (typeof codes)[number];
type Status = "created" | "already_present" | "absent" | "blocked" | "unknown";
type Phase = "preflight" | "atomicity_probe" | "intent" | "domain_create" | "readback";
type Outcome = {
  status: Status;
  code: Code;
  restAtomicity: "verified_this_run" | "not_checked";
  phase: Phase;
  domainCreateInvoked: boolean;
};
const outcome = (
  status: Status,
  code: Code,
  verified = false,
  phase: Phase = "preflight",
  domainCreateInvoked = false,
): Outcome => ({
  status,
  code,
  restAtomicity: verified ? "verified_this_run" : "not_checked",
  phase,
  domainCreateInvoked,
});
class FixtureFailure extends Error {
  constructor(readonly code: Code) {
    super(code);
  }
}

export function fixtureReceipt(candidateSha: string, result: Outcome) {
  return {
    receiptVersion: 1,
    environment: "preview",
    candidateSha: /^[a-f0-9]{40}$/.test(candidateSha) ? candidateSha : null,
    status: result.status,
    code: result.code,
    restAtomicity: result.restAtomicity,
    phase: result.phase,
    domainCreateInvoked: result.domainCreateInvoked,
    uiCreationVerified: false,
    turnstileVerified: false,
    externalIntegrationVerified: false,
  };
}

async function ids() {
  const digest = await runtimeDigest({ fixture: FIXTURE_KEY, source: PROFILE_ID });
  return { workspaceId: `fixture-w-${digest}`, operationId: `fixture-o-${digest}` };
}

/** Query failure text is classified in memory, never printed or included in a receipt. */
function isExpectedProbeFailure(value: unknown) {
  const parsed = z
    .object({ success: z.literal(false), errors: z.array(z.object({ message: z.string() })) })
    .safeParse(value);
  return (
    parsed.success &&
    parsed.data.errors.some(({ message }) =>
      /\bUNIQUE constraint failed: app_metadata\.key\b/.test(message),
    )
  );
}

/** A failed probe leaves any residue intact. Neither absence alone nor a mock result proves rollback. */
export async function verifyFixtureRestAtomicity(
  db: D1Database,
  post: (batch: { sql: string; params: string[] }[]) => Promise<Response>,
) {
  if (await db.prepare("SELECT value FROM app_metadata WHERE key=?").bind(PROBE_KEY).first())
    return false;
  const insert = {
    sql: "INSERT INTO app_metadata(key,value) VALUES(?,?)",
    params: [PROBE_KEY, PROBE_VALUE],
  };
  let rejected = false;
  try {
    const response = await post([insert, insert]);
    if (response.status === 400 || response.ok)
      rejected = isExpectedProbeFailure(await response.json());
  } catch {
    /* An unknown transport outcome is never evidence of rollback. */
  }
  const absent = !(await db
    .prepare("SELECT value FROM app_metadata WHERE key=?")
    .bind(PROBE_KEY)
    .first());
  return rejected && absent;
}

export async function preparePreviewCustomerFixture(input: {
  db: D1Database;
  cipher: EnvelopeCipher;
  mode: "status" | "create";
  now: string;
  verifyAtomicity: () => Promise<boolean>;
}): Promise<Outcome> {
  const { db, cipher, mode } = input;
  const now = timestampSchema.parse(input.now);
  const core = createV2Core(db, cipher, { applicationCostLimitsEnabled: false });
  const { workspaceId, operationId } = await ids();
  if (
    (await db
      .prepare("SELECT value FROM app_metadata WHERE key='schema_version'")
      .first("value")) !== EXPECTED_SCHEMA
  )
    return outcome("blocked", "SCHEMA_MISMATCH");

  const reviewed = await readPreviewFixtureSource(core, now);
  if (!reviewed.ok) return outcome("blocked", reviewed.code);
  const { ownerId, source, fence } = reviewed;

  const inspect = async (): Promise<Outcome | null> => {
    if (
      await db
        .prepare(
          "SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=?) OR (target_kind='workspace' AND target_id=?)",
        )
        .bind(ownerId, workspaceId)
        .first()
    )
      return outcome("blocked", "FIXTURE_TOMBSTONED");
    const intent = await db
      .prepare("SELECT value FROM app_metadata WHERE key=?")
      .bind(INTENT_KEY)
      .first<string>("value");
    const workspace = await db
      .prepare("SELECT owner_id FROM v2_workspaces WHERE id=?")
      .bind(workspaceId)
      .first<{ owner_id: string }>();
    const operation = await db
      .prepare("SELECT owner_id,workspace_id,kind FROM v2_operations WHERE id=?")
      .bind(operationId)
      .first<{ owner_id: string; workspace_id: string | null; kind: string }>();
    const quotas = (
      await db
        .prepare(
          "SELECT owner_id,kind,units,state FROM v2_quota_reservations WHERE operation_id=? LIMIT 2",
        )
        .bind(operationId)
        .all<{ owner_id: string; kind: string; units: number; state: string }>()
    ).results;
    if (!intent && !workspace && !operation && !quotas.length) return null;
    if (intent !== INTENT_VALUE || !workspace || !operation || quotas.length !== 1)
      return outcome(
        "unknown",
        intent === INTENT_VALUE && !workspace && !operation && !quotas.length
          ? "ATTEMPT_UNRESOLVED"
          : "FIXTURE_INCOMPLETE",
      );
    const quota = quotas[0];
    if (
      workspace.owner_id !== ownerId ||
      operation.owner_id !== ownerId ||
      operation.workspace_id !== workspaceId ||
      operation.kind !== "new_case" ||
      quota?.owner_id !== ownerId ||
      quota.kind !== "new_case" ||
      quota.units !== 1 ||
      quota.state !== "consumed"
    )
      return outcome("unknown", "FIXTURE_INCOMPLETE");
    if (
      !(await db
        .prepare(
          "SELECT 1 FROM v2_intakes i JOIN v2_case_original_usage u ON u.workspace_id=i.id WHERE i.id=?",
        )
        .bind(workspaceId)
        .first())
    )
      return outcome("unknown", "FIXTURE_INCOMPLETE");
    // Downstream edits/leases are preserved; a later check never resets revision or state.
    return outcome("already_present", "OK", false, "readback");
  };
  const existing = await inspect();
  if (existing) return existing;
  if (mode === "status") return outcome("absent", "ABSENT", false, "readback");
  const quota = quotaPredicate({ kind: "new_case", units: 1 }, ownerId, usageDateKst(now));
  if (
    !(await db
      .prepare(`SELECT 1 FROM user WHERE id=? AND (${quota.sql})`)
      .bind(ownerId, ...quota.values)
      .first())
  )
    return outcome("blocked", "ACCESS_OR_QUOTA_REJECTED");
  try {
    if (!(await input.verifyAtomicity()))
      return outcome("blocked", "ATOMICITY_NOT_PROVEN", false, "atomicity_probe");
  } catch {
    return outcome("unknown", "ATOMICITY_NOT_PROVEN", false, "atomicity_probe");
  }

  // Durable one-attempt latch precedes the domain batch. A lost response to either
  // write is read-only on every later invocation, even after API idempotency expiry.
  try {
    const latch = await db
      .prepare(
        `INSERT INTO app_metadata(key,value,updated_at) SELECT ?,?,? FROM user WHERE id=? AND (${fence.sql}) AND (${quota.sql}) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=?) OR (target_kind='workspace' AND target_id=?)) AND NOT EXISTS(SELECT 1 FROM app_metadata WHERE key=?) AND NOT EXISTS(SELECT 1 FROM v2_workspaces WHERE id=?) AND NOT EXISTS(SELECT 1 FROM v2_operations WHERE id=?)`,
      )
      .bind(
        INTENT_KEY,
        INTENT_VALUE,
        now,
        ownerId,
        ...fence.values,
        ...quota.values,
        ownerId,
        workspaceId,
        INTENT_KEY,
        workspaceId,
        operationId,
      )
      .run();
    if (latch.meta.changes !== 1)
      return (await inspect()) ?? outcome("blocked", "CLAIM_REJECTED", true, "intent");
  } catch {
    return outcome("unknown", "ATTEMPT_UNRESOLVED", true, "intent");
  }

  try {
    const result = await createV2WorkspaceRepository(db, cipher).create(
      { ownerId, now },
      workspaceId,
      DATA,
      { operationId, key: FIXTURE_KEY, requestHash: await runtimeDigest(DATA) },
      source,
    );
    if (result.kind !== "created")
      return outcome("blocked", "CLAIM_REJECTED", true, "domain_create", true);
    const stored = await inspect();
    if (stored?.status !== "already_present")
      return outcome("unknown", "FIXTURE_INCOMPLETE", true, "readback", true);
    const intake = await createV2WorkspaceRepository(db, cipher).readIntake(
      { ownerId, now },
      workspaceId,
    );
    if (!intake || intake.narrative !== DATA.narrative)
      return outcome("unknown", "FIXTURE_INCOMPLETE", true, "readback", true);
    return outcome("created", "OK", true, "readback", true);
  } catch {
    return outcome("unknown", "ATTEMPT_UNRESOLVED", true, "domain_create", true);
  }
}

/** Independent dispatch history closes the gap when the very first DB write is unknown.
 * Missing/inconsistent pagination is read-only. Deleted GitHub history is not immutable proof. */
export async function fixtureExecutionMode(input: {
  requested: "status" | "create";
  runId: string | undefined;
  runNumber: string | undefined;
  runAttempt: string | undefined;
  github: (path: string) => Promise<unknown>;
}): Promise<"status" | "create"> {
  if (input.requested === "status") return "status";
  if (
    ![input.runId, input.runNumber, input.runAttempt].every(
      (value) => value && /^[1-9][0-9]*$/.test(value),
    )
  )
    return "status";
  if (input.runAttempt !== "1") return "status";
  const currentId = Number(input.runId),
    currentNumber = Number(input.runNumber);
  if (!Number.isSafeInteger(currentId) || !Number.isSafeInteger(currentNumber)) return "status";
  const pageSchema = z.object({
    total_count: z.number().int().nonnegative().max(1000),
    workflow_runs: z
      .array(
        z.object({
          id: z.number().int().positive(),
          run_number: z.number().int().positive(),
          display_title: z.string(),
        }),
      )
      .max(100),
  });
  const seen = new Set<number>();
  let expected: number | undefined;
  let currentFound = false;
  for (let page = 1; page <= 10; page++) {
    const result = pageSchema.safeParse(
      await input.github(
        `actions/workflows/preview-customer-fixture.yml/runs?event=workflow_dispatch&per_page=100&page=${page}`,
      ),
    );
    if (!result.success) return "status";
    if (expected !== undefined && expected !== result.data.total_count) return "status";
    expected = result.data.total_count;
    for (const run of result.data.workflow_runs) {
      if (seen.has(run.id)) return "status";
      seen.add(run.id);
      if (run.id === currentId) {
        if (
          run.run_number !== currentNumber ||
          run.display_title !== "Preview customer fixture create"
        )
          return "status";
        currentFound = true;
      } else if (
        run.run_number < currentNumber &&
        run.display_title !== "Preview customer fixture status"
      )
        return "status";
    }
    if (seen.size === expected) return currentFound ? "create" : "status";
    if (seen.size > expected || result.data.workflow_runs.length < 100) return "status";
  }
  return "status";
}

export async function verifyFixtureRelease(input: {
  sha: string;
  actor: string | undefined;
  triggeringActor: string | undefined;
  ref: string | undefined;
  event: string | undefined;
  repository: string | undefined;
  checkoutSha: string | undefined;
  github: (path: string) => Promise<unknown>;
  fetcher?: typeof fetch;
}) {
  if (
    !/^[a-f0-9]{40}$/.test(input.sha) ||
    input.checkoutSha !== input.sha ||
    !["hyunhomon", "hwangeunchan"].includes(input.actor ?? "") ||
    !["hyunhomon", "hwangeunchan"].includes(input.triggeringActor ?? "") ||
    input.ref !== "refs/heads/main" ||
    input.event !== "workflow_dispatch" ||
    input.repository !== "creno-va/baro"
  )
    throw new FixtureFailure("CONFIGURATION_INVALID");
  const main = z
    .object({ object: z.object({ sha: z.literal(input.sha) }) })
    .safeParse(await input.github("git/ref/heads/main"));
  if (!main.success) throw new FixtureFailure("RELEASE_NOT_VERIFIED");
  try {
    await verifyRelease(input.sha, input.github, true);
  } catch {
    throw new FixtureFailure("RELEASE_NOT_VERIFIED");
  }
  for (const endpoint of ["live", "ready"]) {
    const response = await (input.fetcher ?? fetch)(`${ORIGIN}/api/health/${endpoint}`, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const result = z
      .object({
        status: z.literal(endpoint === "live" ? "ok" : "ready"),
        service: z.literal("baro"),
        environment: z.literal("preview"),
        release: z.literal(input.sha),
        ...(endpoint === "ready" ? { schemaVersion: z.literal(EXPECTED_SCHEMA) } : {}),
      })
      .safeParse(await response.json());
    if (!response.ok || !result.success) throw new FixtureFailure("RELEASE_NOT_VERIFIED");
  }
}

if (import.meta.main) {
  const [sha = "", rawMode] = process.argv.slice(2);
  let result: Outcome;
  try {
    const mode = z.enum(["status", "create"]).parse(rawMode);
    if (process.argv.length !== 4 || process.env.FIXTURE_ENVIRONMENT !== "preview")
      throw new FixtureFailure("CONFIGURATION_INVALID");
    const token = process.env.CLOUDFLARE_API_TOKEN;
    const githubToken = process.env.GITHUB_TOKEN;
    if (!token || !githubToken || !process.env.CASE_DATA_KEY_V1)
      throw new FixtureFailure("CONFIGURATION_INVALID");
    const github = async (path: string) => {
      const response = await fetch(`https://api.github.com/repos/creno-va/baro/${path}`, {
        headers: {
          authorization: `Bearer ${githubToken}`,
          accept: "application/vnd.github+json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new FixtureFailure("RELEASE_NOT_VERIFIED");
      return response.json();
    };
    await verifyFixtureRelease({
      sha,
      actor: process.env.GITHUB_ACTOR,
      triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR,
      ref: process.env.GITHUB_REF,
      event: process.env.GITHUB_EVENT_NAME,
      repository: process.env.GITHUB_REPOSITORY,
      checkoutSha: process.env.GITHUB_SHA,
      github,
    });
    const effectiveMode = await fixtureExecutionMode({
      requested: mode,
      runId: process.env.GITHUB_RUN_ID,
      runNumber: process.env.GITHUB_RUN_NUMBER,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      github,
    });
    const config = z
      .object({
        env: z.object({
          preview: z.object({
            name: z.literal("baro-preview"),
            vars: z.object({ APP_ENV: z.literal("preview") }),
            d1_databases: z.array(z.object({ binding: z.string(), database_id: z.string() })),
          }),
        }),
      })
      .parse(await Bun.file("wrangler.jsonc").json());
    const bindings = config.env.preview.d1_databases.filter((item) => item.binding === "DB");
    if (bindings.length !== 1 || bindings[0]?.database_id !== DATABASE)
      throw new FixtureFailure("CONFIGURATION_INVALID");
    const db = remoteBudgetD1(token, ACCOUNT, DATABASE, ((url, init) =>
      fetch(url, { ...init, redirect: "error" })) as typeof fetch);
    result = await preparePreviewCustomerFixture({
      db,
      cipher: await createCaseDataCipher({ CASE_DATA_KEY_V1: process.env.CASE_DATA_KEY_V1 }),
      mode: effectiveMode,
      now: new Date().toISOString(),
      verifyAtomicity: () =>
        verifyFixtureRestAtomicity(db, (batch) =>
          fetch(
            `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}/query`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ batch }),
              redirect: "error",
              signal: AbortSignal.timeout(30000),
            },
          ),
        ),
    });
    if (mode === "create" && effectiveMode === "status" && result.status === "absent")
      result = outcome("unknown", "ATTEMPT_UNRESOLVED", false, "readback");
  } catch (error) {
    result = outcome(
      "blocked",
      error instanceof FixtureFailure ? error.code : "DEPENDENCY_UNAVAILABLE",
    );
  }
  console.log(JSON.stringify(fixtureReceipt(sha, result)));
  if (result.status === "blocked" || result.status === "unknown") process.exitCode = 1;
}
