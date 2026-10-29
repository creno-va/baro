import { z } from "zod";
import { failureCodeSchema, resultSchema, timestampSchema, uuidSchema } from "../src/contracts";
import { createCaseDataCipher, type EnvelopeCipher } from "../src/server/crypto";
import { usageDateKst } from "../src/server/db/repository";
import { quotaPredicate } from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import { runtimeDigest } from "../src/server/db/v2-paid-runtime";
import { MODEL_ID } from "../src/server/model-policy";
import { verifyFixtureRelease, verifyFixtureRestAtomicity } from "./preview-customer-fixture";
import { PREVIEW_FIXTURE_PROFILE_ID, readPreviewFixtureSource } from "./preview-fixture-source";
import { remoteBudgetD1 } from "./remote-budget-d1";

const ACCOUNT = "9e844969d0c44b2449f3951d1f301654";
const DATABASE = "c1612b14-6ab1-4d2e-82dc-33e596b31337";
const SCHEMA = "0018_external_lookup_admission";
const KEY = "baro-test-fixture:legacy-analysis-v1";
const MARKER = "one-fixed-synthetic-loan-v1";
const NARRATIVE =
  "합성 검증 사건입니다. 실제 사람이나 계약은 없습니다. 가상의 대여자는 2026년 9월 1일 지인에게30만 원을 빌려주고 9월30일 돌려받기로 했으나 아직 받지 못했다고 진술합니다. 이 가정만으로 확인된 사실과 미확인 사항을 구분하고 공식 법률 자료의 일반 정보만 정리합니다.";
type Code =
  | "OK"
  | "ABSENT"
  | "SCHEMA_MISMATCH"
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_MARKER_MISMATCH"
  | "ACCESS_OR_QUOTA_REJECTED"
  | "FIXTURE_INCOMPLETE"
  | "FIXTURE_DELETED"
  | "ATOMICITY_NOT_PROVEN"
  | "ATTEMPT_UNRESOLVED"
  | "CONFIGURATION_INVALID"
  | "RELEASE_NOT_VERIFIED"
  | "DEPENDENCY_UNAVAILABLE";
type Outcome = {
  status: "absent" | "prepared" | "present" | "blocked" | "unknown";
  code: Code;
  creationInvoked: boolean;
  restAtomicity: "not_checked" | "verified_this_run";
  analysisStatus?: string;
  failureCode?: string | null;
  workflowAttempt?: number;
  outboxStatus?: string | null;
  resultKind?: string | null;
  citationCount?: number;
  modelExecutionVerified?: boolean;
  phases?: { phase: string; state: string; transport: string | null; count: number }[];
};
const outcome = (status: Outcome["status"], code: Code): Outcome => ({
  status,
  code,
  creationInvoked: false,
  restAtomicity: "not_checked",
});

async function ids(ownerId: string) {
  const uuid = async (kind: string) => {
    const h = await runtimeDigest({
      fixture: KEY,
      source: PREVIEW_FIXTURE_PROFILE_ID,
      ownerId,
      kind,
    });
    return uuidSchema.parse(
      `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`,
    );
  };
  return {
    caseId: await uuid("case"),
    analysisId: await uuid("analysis"),
    outboxId: await uuid("outbox"),
  };
}

/** One operator-only synthetic source, never a generic case loader. Creation is
 * idempotent across candidates and never resets an analysis or model budget. */
export async function preparePreviewLegacyFixture(input: {
  db: D1Database;
  cipher: EnvelopeCipher;
  mode: "status" | "create";
  now: string;
  verifyAtomicity(): Promise<boolean>;
}): Promise<Outcome> {
  const { db, cipher, mode } = input,
    now = timestampSchema.parse(input.now);
  const core = createV2Core(db, cipher, { applicationCostLimitsEnabled: false });
  if (
    (await db
      .prepare("SELECT value FROM app_metadata WHERE key='schema_version'")
      .first("value")) !== SCHEMA
  )
    return outcome("blocked", "SCHEMA_MISMATCH");
  const reviewed = await readPreviewFixtureSource(core, now);
  if (!reviewed.ok) return outcome("blocked", reviewed.code);
  const { ownerId, fence } = reviewed;
  const { caseId, analysisId, outboxId } = await ids(ownerId);
  async function inspect(): Promise<Outcome | null> {
    const marker = await db
      .prepare("SELECT value FROM app_metadata WHERE key=?")
      .bind(KEY)
      .first<string>("value");
    const row = await db
      .prepare(`SELECT c.user_id,c.current_analysis_id,c.input_revision,c.encrypted_input,a.status,a.attempt,a.failure_code,a.encrypted_result,a.model_id
      FROM cases c LEFT JOIN analyses a ON a.id=c.current_analysis_id AND a.case_id=c.id AND a.input_revision=c.input_revision WHERE c.id=?`)
      .bind(caseId)
      .first<{
        user_id: string;
        current_analysis_id: string;
        input_revision: number;
        encrypted_input: string;
        status: string;
        attempt: number;
        failure_code: string | null;
        encrypted_result: string | null;
        model_id: string | null;
      }>();
    if (!marker && !row) return null;
    if (marker === MARKER && !row) return outcome("blocked", "FIXTURE_DELETED");
    if (
      marker !== MARKER ||
      !row ||
      row.user_id !== ownerId ||
      row.current_analysis_id !== analysisId ||
      row.input_revision !== 1 ||
      !Number.isInteger(row.attempt) ||
      row.attempt < 1 ||
      row.attempt > 3
    )
      return outcome("unknown", "FIXTURE_INCOMPLETE");
    const original = await cipher.decrypt(row.encrypted_input, {
      table: "cases",
      column: "encrypted_input",
      rowId: caseId,
      userId: ownerId,
    });
    if (original !== JSON.stringify({ narrative: NARRATIVE }))
      return outcome("unknown", "FIXTURE_INCOMPLETE");
    const phases = (
      await db
        .prepare(
          `SELECT a.phase,a.state,a.transport,count(*) AS count FROM legacy_ai_attempts a JOIN legacy_ai_operations o ON o.id=a.operation_id WHERE o.analysis_id=? AND a.workflow_attempt=? GROUP BY a.phase,a.state,a.transport ORDER BY a.phase,a.state,a.transport`,
        )
        .bind(analysisId, row.attempt)
        .all<{ phase: string; state: string; transport: string | null; count: number }>()
    ).results;
    const allowed = ["minimize", "screening", "structure", "questions", "generation", "validation"];
    if (
      phases.some(
        (p) =>
          !allowed.includes(p.phase) ||
          !["prepared", "dispatched", "unknown", "final"].includes(p.state) ||
          (p.transport !== null &&
            !["response", "provider_error", "unknown", "not_sent"].includes(p.transport)) ||
          !Number.isInteger(p.count) ||
          p.count < 1 ||
          p.count > 3,
      )
    )
      return outcome("unknown", "FIXTURE_INCOMPLETE");
    const result = row.encrypted_result
      ? resultSchema.parse(
          JSON.parse(
            await cipher.decrypt(row.encrypted_result, {
              table: "analyses",
              column: "encrypted_result",
              rowId: analysisId,
              userId: ownerId,
            }),
          ),
        )
      : null;
    const failure = failureCodeSchema.nullable().safeParse(row.failure_code);
    const states = [
      "queued",
      "screening",
      "waiting_for_answers",
      "retrieving",
      "generating",
      "validating",
      "completed",
      "failed",
      "superseded",
    ];
    if (!states.includes(row.status) || !failure.success)
      return outcome("unknown", "FIXTURE_INCOMPLETE");
    const outbox = await db
      .prepare("SELECT state FROM dispatch_outbox WHERE id=? AND analysis_id=?")
      .bind(outboxId, analysisId)
      .first<string>("state");
    const knownOutbox = outbox === null || ["pending", "dispatched", "failed"].includes(outbox);
    if (!knownOutbox) return outcome("unknown", "FIXTURE_INCOMPLETE");
    return {
      ...outcome("present", "OK"),
      analysisStatus: row.status,
      failureCode: failure.data,
      workflowAttempt: row.attempt,
      outboxStatus: outbox,
      resultKind: result?.kind ?? null,
      citationCount: result?.kind === "guidance" ? result.citations.length : 0,
      modelExecutionVerified:
        row.status === "completed" &&
        row.model_id === MODEL_ID &&
        result?.kind === "guidance" &&
        ["minimize", "screening", "structure", "generation", "validation"].every((phase) =>
          phases.some(
            (p) => p.phase === phase && p.state === "final" && p.transport === "response",
          ),
        ),
      phases,
    };
  }
  const existing = await inspect();
  if (existing) return existing;
  if (mode === "status") return outcome("absent", "ABSENT");
  const day = usageDateKst(now),
    quota = quotaPredicate({ kind: "new_case", units: 1 }, ownerId, day);
  if (
    !(await db
      .prepare(`SELECT 1 WHERE ${quota.sql}`)
      .bind(...quota.values)
      .first())
  )
    return outcome("blocked", "ACCESS_OR_QUOTA_REJECTED");
  try {
    if (!(await input.verifyAtomicity())) return outcome("blocked", "ATOMICITY_NOT_PROVEN");
  } catch {
    return outcome("unknown", "ATOMICITY_NOT_PROVEN");
  }
  const encrypted = await cipher.encrypt(JSON.stringify({ narrative: NARRATIVE }), {
    table: "cases",
    column: "encrypted_input",
    rowId: caseId,
    userId: ownerId,
  });
  const claimId = crypto.randomUUID(),
    claim = "EXISTS(SELECT 1 FROM v2_mutation_claims WHERE id=?)";
  try {
    const writes = await db.batch([
      db
        .prepare(
          `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,?,?,1 WHERE (${fence.sql}) AND (${quota.sql}) AND NOT EXISTS(SELECT 1 FROM app_metadata WHERE key=?) AND NOT EXISTS(SELECT 1 FROM cases WHERE id=?) AND NOT EXISTS(SELECT 1 FROM analyses WHERE id=?)`,
        )
        .bind(claimId, ownerId, caseId, ...fence.values, ...quota.values, KEY, caseId, analysisId),
      db
        .prepare(`INSERT INTO app_metadata(key,value,updated_at) SELECT ?,?,? WHERE ${claim}`)
        .bind(KEY, MARKER, now, claimId),
      db
        .prepare(
          `INSERT INTO cases(id,user_id,title,status,encrypted_input,input_revision,current_analysis_id,questions_asked,created_at,updated_at) SELECT ?,?,'구형 분석 합성 검증','queued',?,1,?,0,?,? WHERE ${claim}`,
        )
        .bind(caseId, ownerId, encrypted, analysisId, now, now, claimId),
      db
        .prepare(
          `INSERT INTO analyses(id,case_id,workflow_instance_id,input_revision,attempt,status,created_at,updated_at) SELECT ?,?,?,1,1,'queued',?,? WHERE ${claim}`,
        )
        .bind(analysisId, caseId, `${analysisId}-1`, now, now, claimId),
      db
        .prepare(
          `INSERT INTO dispatch_outbox(id,analysis_id,attempt,instance_id,revision,state,attempts,next_attempt_at,created_at) SELECT ?,?,1,?,1,'pending',0,?,? WHERE ${claim}`,
        )
        .bind(outboxId, analysisId, `${analysisId}-1`, now, now, claimId),
      db
        .prepare(
          `INSERT INTO v2_daily_usage(owner_id,day,cases_used) SELECT ?,?,max(coalesce((SELECT cases_used FROM v2_daily_usage WHERE owner_id=? AND day=?),0),coalesce((SELECT analysis_count FROM daily_usage WHERE user_id=? AND usage_date_kst=?),0))+1 WHERE ${claim} ON CONFLICT(owner_id,day) DO UPDATE SET cases_used=excluded.cases_used`,
        )
        .bind(ownerId, day, ownerId, day, ownerId, day, claimId),
      db
        .prepare(
          `INSERT INTO daily_usage(user_id,usage_date_kst,analysis_count,updated_at) SELECT ?,?,1,? WHERE ${claim} ON CONFLICT(user_id,usage_date_kst) DO UPDATE SET analysis_count=analysis_count+1,updated_at=excluded.updated_at`,
        )
        .bind(ownerId, day, now, claimId),
      db.prepare("DELETE FROM v2_mutation_claims WHERE id=?").bind(claimId),
    ]);
    const stored = await inspect();
    if (stored)
      return {
        ...stored,
        status:
          stored.status === "present" && writes[0]?.meta.changes === 1 ? "prepared" : stored.status,
        creationInvoked: true,
        restAtomicity: "verified_this_run",
      };
    return {
      ...outcome(
        writes[0]?.meta.changes === 0 ? "blocked" : "unknown",
        writes[0]?.meta.changes === 0 ? "ACCESS_OR_QUOTA_REJECTED" : "ATTEMPT_UNRESOLVED",
      ),
      creationInvoked: true,
      restAtomicity: "verified_this_run",
    };
  } catch {
    return {
      ...outcome("unknown", "ATTEMPT_UNRESOLVED"),
      creationInvoked: true,
      restAtomicity: "verified_this_run",
    };
  }
}

export function legacyFixtureReceipt(
  sha: string,
  requestedMode: string,
  effectiveMode: string,
  result: Outcome,
) {
  const publicOutcome = z
    .object({
      status: z.enum(["absent", "prepared", "present", "blocked", "unknown"]),
      code: z.enum([
        "OK",
        "ABSENT",
        "SCHEMA_MISMATCH",
        "SOURCE_UNAVAILABLE",
        "SOURCE_MARKER_MISMATCH",
        "ACCESS_OR_QUOTA_REJECTED",
        "FIXTURE_INCOMPLETE",
        "FIXTURE_DELETED",
        "ATOMICITY_NOT_PROVEN",
        "ATTEMPT_UNRESOLVED",
        "CONFIGURATION_INVALID",
        "RELEASE_NOT_VERIFIED",
        "DEPENDENCY_UNAVAILABLE",
      ]),
      creationInvoked: z.boolean(),
      restAtomicity: z.enum(["not_checked", "verified_this_run"]),
      analysisStatus: z
        .enum([
          "queued",
          "screening",
          "waiting_for_answers",
          "retrieving",
          "generating",
          "validating",
          "completed",
          "failed",
          "superseded",
        ])
        .optional(),
      failureCode: failureCodeSchema.nullable().optional(),
      workflowAttempt: z.number().int().min(1).max(3).optional(),
      outboxStatus: z.enum(["pending", "dispatched", "failed"]).nullable().optional(),
      resultKind: z.enum(["guidance", "out_of_scope", "urgent_redirect"]).nullable().optional(),
      citationCount: z.number().int().min(0).max(20).optional(),
      modelExecutionVerified: z.boolean().optional(),
      phases: z
        .array(
          z.object({
            phase: z.enum([
              "minimize",
              "screening",
              "structure",
              "questions",
              "generation",
              "validation",
            ]),
            state: z.enum(["prepared", "dispatched", "unknown", "final"]),
            transport: z.enum(["response", "provider_error", "unknown", "not_sent"]).nullable(),
            count: z.number().int().min(1).max(3),
          }),
        )
        .max(18)
        .optional(),
    })
    .safeParse(result);
  return {
    receiptVersion: 1,
    environment: "preview",
    candidateSha: /^[a-f0-9]{40}$/.test(sha) ? sha : null,
    requestedMode: ["create", "status"].includes(requestedMode) ? requestedMode : "invalid",
    effectiveMode: ["create", "status"].includes(effectiveMode) ? effectiveMode : "invalid",
    ...(publicOutcome.success ? publicOutcome.data : outcome("unknown", "DEPENDENCY_UNAVAILABLE")),
    uiCreationVerified: false,
    externalAccountsCreated: false,
  };
}

export function verifyLegacyFixtureConfiguration(value: unknown) {
  const config = z
    .object({
      env: z.object({
        preview: z.object({
          name: z.literal("baro-preview"),
          vars: z.object({ APP_ENV: z.literal("preview") }),
          triggers: z.object({ crons: z.array(z.string()).refine((v) => v.includes("* * * * *")) }),
          d1_databases: z.array(z.object({ binding: z.string(), database_id: z.string() })),
        }),
      }),
    })
    .parse(value);
  const bindings = config.env.preview.d1_databases.filter((v) => v.binding === "DB");
  if (bindings.length !== 1 || bindings[0]?.database_id !== DATABASE)
    throw new Error("CONFIGURATION_INVALID");
}

export function legacyFixtureEffectiveMode(mode: "create" | "status", runAttempt: unknown) {
  return runAttempt === "1" ? mode : "status";
}

if (import.meta.main) {
  const [sha = "", rawMode] = process.argv.slice(2);
  let result = outcome("blocked", "CONFIGURATION_INVALID"),
    effectiveMode: "create" | "status" = "status";
  try {
    const mode = z.enum(["create", "status"]).parse(rawMode);
    if (process.argv.length !== 4 || process.env.FIXTURE_ENVIRONMENT !== "preview")
      throw new Error("CONFIGURATION_INVALID");
    const token = process.env.CLOUDFLARE_API_TOKEN,
      githubToken = process.env.GITHUB_TOKEN,
      key = process.env.CASE_DATA_KEY_V1;
    if (!token || !githubToken || !key) throw new Error("CONFIGURATION_INVALID");
    const github = async (path: string) => {
      const response = await fetch(`https://api.github.com/repos/creno-va/baro/${path}`, {
        headers: { authorization: `Bearer ${githubToken}`, accept: "application/vnd.github+json" },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("RELEASE_NOT_VERIFIED");
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
    effectiveMode = legacyFixtureEffectiveMode(mode, process.env.GITHUB_RUN_ATTEMPT);
    verifyLegacyFixtureConfiguration(await Bun.file("wrangler.jsonc").json());
    const db = remoteBudgetD1(token, ACCOUNT, DATABASE, ((url, init) =>
      fetch(url, { ...init, redirect: "error" })) as typeof fetch);
    result = await preparePreviewLegacyFixture({
      db,
      cipher: await createCaseDataCipher({ CASE_DATA_KEY_V1: key }),
      mode: effectiveMode,
      now: new Date().toISOString(),
      verifyAtomicity: () =>
        verifyFixtureRestAtomicity(db, (batch) =>
          fetch(
            `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}/query`,
            {
              method: "POST",
              headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
              body: JSON.stringify({ batch }),
              redirect: "error",
              signal: AbortSignal.timeout(30000),
            },
          ),
        ),
    });
  } catch {
    result = outcome("unknown", "DEPENDENCY_UNAVAILABLE");
  }
  console.log(
    JSON.stringify(legacyFixtureReceipt(sha, rawMode ?? "invalid", effectiveMode, result)),
  );
  if (["blocked", "unknown"].includes(result.status)) process.exit(1);
}
