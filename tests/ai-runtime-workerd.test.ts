import { afterEach, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { Hono } from "hono";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { modelBounds, observationSchema, provisionAiRuntime } from "../scripts/provision-ai-budget";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { v2JobSchema } from "../src/contracts/v2";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core, type V2Core } from "../src/server/db/v2-core";
import { runtimeDigest } from "../src/server/db/v2-paid-runtime";
import { type DependencyCategory, dependencyCategory } from "../src/server/dependency-diagnostics";
import { paidHoldRequestSchema } from "../src/server/modules/budget/contracts";
import { createGatewayExecutionPlanner } from "../src/server/modules/budget/execution-plan";
import { MODEL_ID } from "../src/server/modules/llm-gateway/prompts";
import {
  gatewayWireIdentity,
  prepareGatewayWireInput,
} from "../src/server/modules/llm-gateway/service";
import { readWorkspaceContext } from "../src/server/modules/workspace/context";
import {
  type WorkspaceContext,
  workspaceModelInput,
} from "../src/server/modules/workspace/pipeline";
import { createWorkspaceService } from "../src/server/modules/workspace/service";
import {
  configuredBounds,
  createWorkspaceDependencies,
  runWorkspaceRuntime,
  workspaceTokenBounds,
} from "../src/server/runtime/workspace";
import { signedSessionCookie, testEnvironment } from "./helpers/d1";
import { measureD1Work } from "./helpers/d1-work";
import { syntheticGatewayInput } from "./helpers/gateway-input";
import observation from "./helpers/gemini-observation";
import { nativeD1Transport, nativeD1TransportWorker } from "./helpers/native-d1-transport";
import { createNativeFailureHistory, nativeFailure } from "./helpers/native-failure";
import { createNativeTestRegistry, type NativeLifetime } from "./helpers/native-lifetime";
import {
  createNativeRecoveryMeasurements,
  nativeHostMeasurements,
  nativeRecoveryWork,
} from "./helpers/native-measurements";
import { createNativeProgress } from "./helpers/native-progress";

const nativeTests = createNativeTestRegistry();
let activeProgress: ReturnType<typeof createNativeProgress> | undefined;
afterEach(async () => {
  // Bun can end a timed-out test before its pending native Promise settles.
  // Snapshot memory and clear the diagnostic timer before joining runtime cleanup.
  activeProgress?.finish(false);
  activeProgress = undefined;
  await nativeTests.stop();
});

/** Failure-only synthetic diagnostics: never serialize rows, identities, text or errors. */
async function nativeAdmissionDiagnostics(
  core: V2Core,
  env: Env,
  ownerId: string,
  workspaceId: string,
  jobId: string,
) {
  const result: Record<string, boolean | number | string | null> = { probeComplete: false };
  try {
    const now = new Date().toISOString();
    const job = await core
      .statement("SELECT status,phase,failure_code,attempts,lease_until FROM v2_jobs WHERE id=?", [
        jobId,
      ])
      .first<{
        status: unknown;
        phase: unknown;
        failure_code: unknown;
        attempts: unknown;
        lease_until: string | null;
      }>();
    result.jobPresent = !!job;
    if (job) {
      result.jobStatus = v2JobSchema.shape.status.parse(job.status);
      result.jobPhase = v2JobSchema.shape.phase.parse(job.phase);
      result.jobFailure = v2JobSchema.shape.failure.parse(job.failure_code);
      result.jobAttempts = v2JobSchema.shape.attempts.parse(job.attempts);
      result.jobLeasePresent = job.lease_until !== null;
      result.jobLeaseRemainingMs = job.lease_until
        ? Date.parse(job.lease_until) - Date.parse(now)
        : null;
    }
    const row = await core
      .statement(
        "SELECT h.state,p.payload_json,p.digest,p.evidence_hash FROM v2_execution_job_holds h JOIN v2_execution_job_plans p ON p.id=h.plan_id WHERE h.job_id=? ORDER BY h.attempt_id LIMIT 1",
        [jobId],
      )
      .first<{ state: string; payload_json: string; digest: string; evidence_hash: string }>();
    result.holdPresent = !!row;
    if (!row) return result;
    result.holdPrepared = row.state === "prepared";
    const plan = paidHoldRequestSchema.parse(JSON.parse(row.payload_json));
    result.planDigestMatches = (await runtimeDigest(plan)) === row.digest;
    result.deadlineRemainingMs = Date.parse(plan.plan.deadlineAt) - Date.parse(now);
    const proofs = await core
      .statement(
        "SELECT kind,verified_at<=? verified,valid_until>? fresh FROM v2_runtime_proofs WHERE id IN (?,?,(SELECT allocation_proof_id FROM v2_runtime_controls WHERE environment='preview' LIMIT 1))",
        [now, now, plan.pricingProofId, plan.fundingProofId],
      )
      .all<{ kind: string; verified: number; fresh: number }>();
    for (const kind of ["pricing", "funding", "allocation"]) {
      const proof = proofs.results.find((value) => value.kind === kind);
      result[`${kind}Present`] = !!proof;
      result[`${kind}VerifiedByNow`] = proof?.verified === 1;
      result[`${kind}Fresh`] = proof?.fresh === 1;
    }
    // A failed question job resets status/currentJobId only; the shared
    // context reader normalizes both, so its exact wire can still be compared.
    const input = workspaceModelInput(
      await readWorkspaceContext(core, { ownerId, now }, workspaceId),
    );
    const config = configuredBounds(env);
    result.boundsConfigured = !!config;
    const wire = prepareGatewayWireInput("workspace_questions", input);
    const execution = await createGatewayExecutionPlanner({
      applicationCostLimitsEnabled: core.applicationCostLimitsEnabled,
      input: async () => input,
      bounds: async (value) => workspaceTokenBounds(config, value.max_completion_tokens),
      verifyBounds: async (_descriptor, digest, at) =>
        config && Date.parse(config.verifiedAt) <= Date.parse(at)
          ? { digest, evidenceHash: config.evidenceHash, verifiedAt: config.verifiedAt }
          : null,
    }).verify(
      {
        invocationId: plan.plan.invocationId,
        requestId: jobId,
        phase: "workspace_questions",
        model: MODEL_ID,
        attemptOrdinal: 1,
        correction: false,
        ...(await gatewayWireIdentity(wire)),
        outputTokenUpperBound: wire.max_completion_tokens,
      },
      now,
    );
    result.executionVerified = !!execution;
    result.executionEvidenceMatches = execution?.evidenceHash === row.evidence_hash;
    result.probeComplete = true;
  } catch (error) {
    result.probeFailureCategory = dependencyCategory(error);
    // Preserve the original failing assertion without leaking the probe error.
  }
  return result;
}

// Wrangler pins this workerd/Miniflare pair in bun.lock. Using its actual D1
// implementation catches SQLite authorization/SQL limits that bun:sqlite cannot.
async function exerciseNativeRuntime(
  applicationCostLimitsEnabled: boolean,
  lifetime: NativeLifetime,
  staleChatAdmission = false,
) {
  const started = performance.now();
  const recovery = createNativeRecoveryMeasurements(),
    hostBaseline = nativeHostMeasurements();
  const providerMeasurements = { calls: 0, wallMs: 0, maximumWallMs: 0 };
  const progress = createNativeProgress(applicationCostLimitsEnabled);
  activeProgress = progress;
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: nativeD1TransportWorker,
      host: "127.0.0.1",
      compatibilityDate: "2026-10-01",
      d1Databases: ["PREVIEW", "PRODUCTION", "UPGRADE"],
      cf: false,
      unsafeRegisterWorker: false,
    }),
  );
  lifetime.own(() => mf.dispose());
  let completed = false;
  try {
    await mf.ready;
    const preview = nativeD1Transport(mf, "PREVIEW"),
      production = nativeD1Transport(mf, "PRODUCTION"),
      upgrade = nativeD1Transport(mf, "UPGRADE");
    const migrations = (await readdir("drizzle"))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    progress.enter("schema", "migrate");
    for (const db of [preview, production, upgrade]) {
      for (const name of migrations) {
        lifetime.check();
        // Product runtimes require latest schema. A separate native database
        // retains the real pre-upgrade schema for the populated upgrade below.
        if (db === upgrade && name >= "0014_") continue;
        const statements = (await Bun.file(`drizzle/${name}`).text())
          .split("--> statement-breakpoint")
          .map((sql) => sql.trim())
          .filter(Boolean);
        await db.batch(statements.map((sql) => db.prepare(sql)));
      }
    }
    const now = new Date().toISOString(),
      observed = observationSchema.parse({
        ...observation,
        spendAllowanceKrw: applicationCostLimitsEnabled ? observation.spendAllowanceKrw : 53410,
        checkedAt: now,
        validUntil: new Date(Date.now() + 86400000).toISOString(),
      });
    progress.enter("provision", "provision");
    const provisioned = await provisionAiRuntime({ preview, production }, observed),
      ownerId = crypto.randomUUID(),
      sessionId = crypto.randomUUID(),
      sessionToken = `synthetic-session-${sessionId}`;
    progress.boundary("seed");
    await preview.batch([
      preview
        .prepare(
          "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)",
        )
        .bind(ownerId, "Synthetic native D1", `${ownerId}@example.test`, Date.now(), Date.now()),
      preview
        .prepare(
          "INSERT INTO session(id,user_id,token,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        )
        .bind(sessionId, ownerId, sessionToken, Date.now() + 3600000, Date.now(), Date.now()),
      preview
        .prepare(
          "INSERT INTO user_consents(user_id,terms_version,privacy_version,ai_notice_version,over_14_confirmed,consented_at) VALUES(?,?,?,?,1,?)",
        )
        .bind(
          ownerId,
          CURRENT_POLICY_VERSIONS.termsVersion,
          CURRENT_POLICY_VERSIONS.privacyVersion,
          CURRENT_POLICY_VERSIONS.aiNoticeVersion,
          now,
        ),
    ]);
    const key = btoa("w".repeat(32)).replace(/=+$/, ""),
      cipher = await createCaseDataCipher({ CASE_DATA_KEY_V1: key });
    let providerCalls = 0,
      unavailable = false,
      auditRejected = false;
    const databaseFailures: DependencyCategory[] = [],
      databaseFailureDetails: ReturnType<typeof nativeFailure>[] = [],
      databaseFailureHistory = createNativeFailureHistory(),
      measured = measureD1Work(preview, (error) => {
        databaseFailures.push(dependencyCategory(error));
        databaseFailureDetails.push(nativeFailure(error));
        databaseFailureHistory.capture(error, measured.trace.operation);
      });
    recovery.observe(() => nativeRecoveryWork(measured.measurements(), providerMeasurements));
    let core = createV2Core(measured.binding, cipher, {
      applicationCostLimitsEnabled: true,
      monthlyBudgetCapEnabled: false,
    });
    const measureProvider =
      (run: (model: string, input: Record<string, unknown>) => Promise<Response>) =>
      async (model: string, input: Record<string, unknown>) => {
        const providerStarted = performance.now();
        try {
          return await run(model, input);
        } finally {
          const elapsed = Math.max(0, performance.now() - providerStarted);
          providerMeasurements.calls++;
          providerMeasurements.wallMs += elapsed;
          providerMeasurements.maximumWallMs = Math.max(
            providerMeasurements.maximumWallMs,
            elapsed,
          );
        }
      };
    const env = {
      ...testEnvironment(preview),
      APP_ENV: "preview",
      DB: measured.binding,
      CASE_DATA_KEY_V1: key,
      APPLICATION_COST_LIMITS_ENABLED: "true",
      MONTHLY_BUDGET_CAP_ENABLED: "false",
      AI_GATEWAY_ID: "synthetic-gateway",
      AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(modelBounds(observed, provisioned.evidenceHash)),
      ANALYSIS_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
      WORKSPACE_PROCESSING: {
        get: async () => {
          throw new Error("Synthetic absent instance");
        },
        create: async ({ id }: { id: string }) => ({ id }),
      },
      AI: {
        run: measureProvider(async (_model: string, input: Record<string, unknown>) => {
          lifetime.check();
          providerCalls++;
          if (unavailable)
            return Response.json(
              { error: { message: "Invalid schema for response_format: synthetic rejection" } },
              { status: 400 },
            );
          const { name: phase, data } = syntheticGatewayInput(input);
          const context = data as WorkspaceContext;
          let output: unknown;
          if (phase.includes("audit")) {
            output = {
              pass: !auditRejected,
              findings: [],
              unsupportedFactIds: [],
              legalClaimsSupported: true,
              strategyDetected: false,
            };
          } else if (phase.includes("questions")) {
            output = {
              questions: [
                {
                  id: "placeholder",
                  prompt: `자료 확인 단계 ${providerCalls}에서 확인할 날짜는 무엇인가요?`,
                  answerType: "text",
                  options: [],
                },
              ],
            };
          } else if (phase.includes("summary")) {
            output = {
              overview: "합성 거래 자료를 바탕으로 상담 준비 내용을 정리했습니다.",
              facts: [
                {
                  id: "initial_fact",
                  text: context.intake.narrative,
                  attribution: "user_statement",
                  certainty: "reported",
                  significance: "neutral",
                  userEdited: false,
                  references: [
                    { kind: "intake_narrative", intakeRevision: context.intake.revision },
                  ],
                  conflictingFactIds: [],
                },
              ],
              parties: [{ id: "initial_party", label: "사용자", role: "자료를 준비하는 당사자" }],
              unknowns: ["거래 날짜 미확인"],
              notices: ["사용자 진술을 정리한 준비 자료입니다."],
            };
          } else {
            const reference = {
              kind: "user_message",
              messageId: context.latestMessage?.id,
              workspaceRevision: context.latestMessage?.workspaceRevision,
            };
            output = {
              text: "새로 찾은 자료의 이름과 날짜를 확인해 주세요.",
              references: [reference],
              warnings: [],
              facts: [
                {
                  id: "new_fact",
                  text: context.latestMessage?.text,
                  attribution: "user_statement",
                  certainty: "reported",
                  significance: "neutral",
                  userEdited: false,
                  references: [reference],
                  conflictingFactIds: [],
                },
              ],
              actions: [
                {
                  id: "new_action",
                  revision: 1,
                  kind: "organize_materials",
                  title: "자료 목록 정리",
                  instructions: "새로 찾은 자료의 이름을 적어주세요.",
                  caution: "자료의 내용은 아직 확인되지 않았어요.",
                  status: "todo",
                  factIds: ["new_fact"],
                  references: [reference],
                },
              ],
              parties: [{ id: "new_party", label: "상대방", role: "추가 확인이 필요한 당사자" }],
              requestedSources: [],
              timeline: [
                {
                  id: "new_event",
                  revision: 1,
                  date: null,
                  datePrecision: "unknown",
                  event: "추가 자료를 찾았다는 진술",
                  certainty: "reported",
                  references: [reference],
                  factIds: ["new_fact"],
                  userEdited: false,
                },
              ],
            };
          }
          return Response.json({
            id: `synthetic-receipt-${providerCalls}`,
            service_tier: "default",
            choices: [{ message: { content: JSON.stringify({ output }) }, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 500,
              completion_tokens: 100,
              prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
            },
          });
        }),
      },
    } as unknown as Env;
    let service = createWorkspaceService(core, createWorkspaceDependencies(core, env));
    const cookie = await signedSessionCookie(sessionToken, env.BETTER_AUTH_SECRET);
    let requestPhase = "access_or_read",
      requestOrdinal = 0;
    let requestFailure: ReturnType<typeof nativeFailure> = [];
    progress.observe(() => ({
      activeCostLimitsEnabled: env.APPLICATION_COST_LIMITS_ENABLED !== "false",
      providerCalls,
      requestOrdinal,
      databaseTrace: measured.trace,
      databaseMeasurements: measured.measurements(),
      databaseFailureHistory: databaseFailureHistory.snapshot(),
      recoveryMeasurements: recovery.snapshot(),
      providerMeasurements,
      hostBaseline,
      hostMeasurements: nativeHostMeasurements(),
    }));
    const app = new Hono()
      .use("*", async (c, next) => {
        await next();
        // Hono retains the caught error on Context after the real API onError
        // handler responds. Observe it without replacing that product handler.
        if (c.error) requestFailure = nativeFailure(c.error);
      })
      .route(
        "/api/v2/cases",
        createWorkspacesApi({
          dependencies: async (bindings, c) => {
            const dependencies = createWorkspaceDependencies(c, bindings);
            return {
              ...dependencies,
              async prepareJob(input) {
                progress.boundary("prepare_job");
                requestPhase = "prepare_job";
                const prepared = await dependencies.prepareJob?.(input);
                requestPhase = prepared ? "job_commit" : "prepare_rejected";
                progress.boundary("request");
                return prepared ?? null;
              },
              async dispatch() {
                progress.boundary("dispatch");
                requestPhase = "dispatch";
                try {
                  return await dependencies.dispatch?.();
                } finally {
                  requestPhase = "receipt";
                  progress.boundary("receipt");
                }
              },
            };
          },
        }),
      );
    const request = async (path: string, method = "GET", body?: unknown) => {
      lifetime.check();
      progress.boundary("request");
      requestOrdinal++;
      requestPhase = "access_or_read";
      requestFailure = [];
      databaseFailures.length = 0;
      databaseFailureDetails.length = 0;
      measured.resetTrace();
      const beforeWork = { ...measured.work },
        started = performance.now();
      const key = crypto.randomUUID();
      const response = await app.request(
        path,
        {
          method,
          headers: {
            cookie,
            origin: env.BETTER_AUTH_URL,
            "content-type": "application/json",
            "idempotency-key": key,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        env,
      );
      if (response.status >= 500) {
        // JSON preserves the bounded safe cause chains that Bun inspection collapses.
        console.error(
          "Synthetic native request failure diagnostics",
          JSON.stringify({
            requestedCostLimitsEnabled: applicationCostLimitsEnabled,
            activeCostLimitsEnabled: env.APPLICATION_COST_LIMITS_ENABLED !== "false",
            requestOrdinal,
            requestPhase,
            status: response.status,
            durationMs: Math.round(performance.now() - started),
            providerCalls,
            error: requestFailure,
            databaseFailureCategories: databaseFailures,
            databaseFailureDetails,
            databaseTrace: { ...measured.trace },
            databaseWork: {
              statements: measured.work.statements - beforeWork.statements,
              rowsRead: measured.work.rowsRead - beforeWork.rowsRead,
              rowsWritten: measured.work.rowsWritten - beforeWork.rowsWritten,
            },
          }),
        );
        // Exact failed request only, never a previous job from this workspace.
        try {
          const saved = await preview
            .prepare(
              "SELECT j.id FROM v2_idempotency i JOIN v2_operations o ON o.id=i.operation_id JOIN v2_jobs j ON j.operation_id=o.id WHERE o.owner_id=? AND i.key=? LIMIT 1",
            )
            .bind(ownerId, key)
            .first<{ id: string }>();
          console.error(
            "Synthetic native request receipt diagnostics",
            JSON.stringify({
              requestOrdinal,
              jobCreated: !!saved,
              ...(saved
                ? await nativeAdmissionDiagnostics(core, env, ownerId, workspace.id, saved.id)
                : {}),
            }),
          );
        } catch (error) {
          console.error(
            "Synthetic native request receipt diagnostics",
            JSON.stringify({
              requestOrdinal,
              probeComplete: false,
              error: nativeFailure(error),
            }),
          );
        }
      }
      return response;
    };
    progress.enter("baseline", "create");
    const workspace = await service.create(ownerId, crypto.randomUUID(), {
      narrative: "합성 계약 자료의 거래 날짜를 확인하고 상담을 준비하려고 합니다.",
      jurisdiction: "KR",
      subjectContext: "individual",
      turnstileToken: "synthetic",
    });
    const admissionStarted = performance.now();
    const admission = await request(`/api/v2/cases/${workspace.id}/intake/advance`, "POST", {
      expectedRevision: workspace.workspaceRevision,
    });
    expect(admission.status).toBe(202);
    const queued = (await admission.json()) as { status: string; jobId: string };
    expect(queued.status).toBe("queued");
    const pending: Promise<void>[] = [];
    measured.reset();
    measured.resetTrace();
    databaseFailures.length = 0;
    databaseFailureDetails.length = 0;
    const runtimeStarted = performance.now();
    progress.boundary("runtime");
    const result = await runWorkspaceRuntime(
      env,
      {
        ownerId,
        workspaceId: workspace.id,
        workspaceRevision: workspace.workspaceRevision + 1,
        jobId: queued.jobId,
      },
      `${queued.jobId}-1`,
      (promise) => pending.push(promise),
    );
    const runtimeFinished = performance.now();
    progress.boundary("runtime_receipts");
    await Promise.all(pending);
    if (result.status !== "completed") {
      // Both variants first run a priced baseline, then upgrade populated legacy
      // rows before switching mode. Never label this failure as unpriced execution.
      console.error(
        "Synthetic native initial runtime diagnostics",
        JSON.stringify({
          requestedCostLimitsEnabled: applicationCostLimitsEnabled,
          activeCostLimitsEnabled: env.APPLICATION_COST_LIMITS_ENABLED !== "false",
          providerCalls,
          setupDurationMs: Math.round(admissionStarted - started),
          admissionDurationMs: Math.round(runtimeStarted - admissionStarted),
          runtimeDurationMs: Math.round(runtimeFinished - runtimeStarted),
          receiptWaitDurationMs: Math.round(performance.now() - runtimeFinished),
          stageTimings:
            "stageTimings" in result
              ? result.stageTimings.map(({ stage, durationMs, outcome }) => ({
                  stage,
                  durationMs,
                  outcome,
                }))
              : [],
          databaseWork: { ...measured.work },
          databaseFailureCategories: databaseFailures,
          databaseFailureDetails,
          databaseTrace: { ...measured.trace },
        }),
      );
      // Emit the already-available failure evidence before further D1 reads, so
      // a slow diagnostic probe cannot hide the stage near the test deadline.
      console.error(
        "Synthetic native initial admission diagnostics",
        JSON.stringify({
          ...(await nativeAdmissionDiagnostics(core, env, ownerId, workspace.id, queued.jobId)),
        }),
      );
    }
    expect(result.status).toBe("completed");
    expect(providerCalls).toBe(2);
    progress.boundary("readback");
    expect((await service.intake(ownerId, workspace.id))?.batches).toHaveLength(1);
    expect(
      await preview
        .prepare("SELECT count(*) AS n FROM v2_cost_attempts WHERE state='settled'")
        .first<number>("n"),
    ).toBe(2);
    expect(
      await preview
        .prepare("SELECT reserved_krw+ambiguous_krw AS unresolved FROM v2_monthly_budget")
        .first<number>("unresolved"),
    ).toBe(0);
    // Upgrade populated 0013 -> 0014 -> 0015 -> 0016 in order. A failure in any
    // import must roll back data, tables, triggers and the schema marker.
    // Copy actual synthetic legacy-path rows into the old schema. Current
    // product code must not be run against an unapplied required migration.
    progress.enter("migration", "copy");
    const fixtureCopyStarted = performance.now();
    let fixtureCopyReadCalls = 1;
    let fixtureCopyReadStatements = 1;
    let fixtureCopyMaximumBatch = 1;
    // The native bridge has per-call overhead. Keep the same row/column reads
    // while sending independent fixture queries in bounded batches.
    async function readFixture<T>(db: D1Database, statements: D1PreparedStatement[]) {
      const results: D1Result<T>[] = [];
      for (let start = 0; start < statements.length; start += 16) {
        lifetime.check();
        const batch = statements.slice(start, start + 16);
        fixtureCopyReadCalls++;
        fixtureCopyReadStatements += batch.length;
        fixtureCopyMaximumBatch = Math.max(fixtureCopyMaximumBatch, batch.length);
        const rows = await db.batch<T>(batch);
        lifetime.check();
        expect(rows).toHaveLength(batch.length);
        results.push(...rows);
      }
      return results;
    }
    const oldTables = (
      await upgrade
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='app_metadata'",
        )
        .all<{ name: string }>()
    ).results;
    const copied: D1PreparedStatement[] = [upgrade.prepare("PRAGMA defer_foreign_keys=ON")];
    // These rows are derived by the immutable funding-proof insert trigger.
    const copyTables = oldTables.filter(({ name }) => name !== "v2_storage_funding_heads");
    const existing = await readFixture<Record<string, unknown>>(
      upgrade,
      copyTables.map(({ name }) => upgrade.prepare(`SELECT * FROM "${name}"`)),
    );
    const emptyTables = copyTables.filter((_, index) => existing[index]?.results.length === 0);
    const columnRows = await readFixture<{ name: string }>(
      upgrade,
      emptyTables.map(({ name }) => upgrade.prepare(`PRAGMA table_info("${name}")`)),
    );
    const columnsByTable = new Map<string, string[]>();
    for (const [index, { name }] of emptyTables.entries()) {
      const columns = columnRows[index]?.results.map((column) => column.name);
      if (!columns?.length) throw new Error("Synthetic fixture columns missing");
      columnsByTable.set(name, columns);
    }
    const source = await readFixture<Record<string, unknown>>(
      preview,
      copyTables.map(({ name }) =>
        preview.prepare(
          `SELECT ${
            columnsByTable
              .get(name)
              ?.map((column) => `"${column}"`)
              .join(",") ?? "*"
          } FROM "${name}"`,
        ),
      ),
    );
    for (const [index, { name }] of copyTables.entries()) {
      lifetime.check();
      const targetRows = existing[index]?.results;
      const sourceRows = source[index]?.results;
      if (!targetRows || !sourceRows) throw new Error("Synthetic fixture rows missing");
      if (targetRows.length) {
        expect(sourceRows).toEqual(targetRows);
        continue;
      }
      const columns = columnsByTable.get(name);
      if (!columns) throw new Error("Synthetic fixture columns missing");
      const quoted = columns.map((column) => `"${column}"`).join(",");
      for (const row of sourceRows) {
        copied.push(
          upgrade
            .prepare(`INSERT INTO "${name}"(${quoted}) VALUES(${columns.map(() => "?").join(",")})`)
            .bind(...columns.map((column) => row[column])),
        );
      }
    }
    await upgrade.batch(copied);
    const [actual, expected] = await Promise.all(
      [upgrade, preview].map((db) =>
        readFixture(
          db,
          oldTables.map(({ name }) => db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`)),
        ),
      ),
    );
    for (const [index] of oldTables.entries()) {
      const actualRows = actual?.[index]?.results;
      const expectedRows = expected?.[index]?.results;
      if (!actualRows || !expectedRows) throw new Error("Synthetic fixture final rows missing");
      expect(actualRows).toEqual(expectedRows);
    }
    console.info(
      "Synthetic native fixture copy measurements",
      JSON.stringify({
        requestedCostLimitsEnabled: applicationCostLimitsEnabled,
        tables: oldTables.length,
        readCalls: fixtureCopyReadCalls,
        readStatements: fixtureCopyReadStatements,
        maximumReadBatch: fixtureCopyMaximumBatch,
        durationMs: Math.round(performance.now() - fixtureCopyStarted),
      }),
    );
    const preservedTables = [
      "v2_runtime_plans",
      "v2_paid_holds",
      "v2_cost_attempts",
      "v2_runtime_usage",
      "v2_runtime_proofs",
      "v2_monthly_budget",
      "v2_jobs",
      "v2_storage_projections",
      "app_metadata",
    ];
    const snapshot = async () =>
      Promise.all(
        preservedTables.map(
          async (table) => (await upgrade.prepare(`SELECT * FROM ${table}`).all()).results,
        ),
      );
    const schema = async (db: D1Database) =>
      (
        await db
          .prepare(
            "SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') ORDER BY type,name",
          )
          .all()
      ).results;
    for (const name of migrations.filter((name) => name >= "0014_")) {
      lifetime.check();
      const migration = (await Bun.file(`drizzle/${name}`).text())
        .split("--> statement-breakpoint")
        .map((sql) => sql.trim())
        .filter(Boolean);
      const original = await snapshot();
      expect(original[1]?.length).toBeGreaterThan(0);
      const originalSchema = await schema(upgrade);
      progress.boundary("rollback");
      await expect(
        upgrade.batch([
          ...migration.map((sql) => upgrade.prepare(sql)),
          upgrade.prepare("SELECT json('synthetic-invalid-json')"),
        ]),
      ).rejects.toThrow();
      expect(await snapshot()).toEqual(original);
      expect(await schema(upgrade)).toEqual(originalSchema);
      // Remote imports must not depend on deferred-FK state surviving statement
      // boundaries. Check every intermediate schema as well as the final rows.
      progress.boundary("upgrade");
      const upgraded = await upgrade.batch(
        migration.flatMap((sql) => [
          upgrade.prepare(sql),
          upgrade.prepare("PRAGMA foreign_key_check"),
        ]),
      );
      for (let i = 1; i < upgraded.length; i += 2) expect(upgraded[i]?.results).toEqual([]);
      expect((await snapshot()).slice(0, -1)).toEqual(original.slice(0, -1));
      expect(
        await upgrade
          .prepare("SELECT value FROM app_metadata WHERE key='schema_version'")
          .first<string>("value"),
      ).toBe(name.slice(0, -4));
      expect((await upgrade.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    }
    expect(await schema(upgrade)).toEqual(await schema(production));
    // Exercise observation mode on the current schema while retaining every
    // earlier paid plan, hold and receipt from the same product database.
    progress.enter("advance", "readback");
    env.APPLICATION_COST_LIMITS_ENABLED = String(applicationCostLimitsEnabled);
    core = createV2Core(measured.binding, cipher, {
      applicationCostLimitsEnabled,
      monthlyBudgetCapEnabled: false,
    });
    service = createWorkspaceService(core, createWorkspaceDependencies(core, env));
    if (!applicationCostLimitsEnabled) {
      // Preserve an existing unknown exposure and maintenance reservation; no credit increase.
      await preview
        .prepare(
          "UPDATE v2_monthly_budget SET settled_krw=283,ambiguous_krw=21895,fixed_maintenance_krw=31118,limit_krw=0",
        )
        .run();
    }
    // Match the UI: answers -> advance -> failed latest job -> retry route.
    const intake = await service.intake(ownerId, workspace.id);
    expect(
      (
        await request(`/api/v2/cases/${workspace.id}/intake/answers`, "PUT", {
          expectedRevision: intake?.revision,
          answers: intake?.batches[0]?.questions.map((q) => ({
            questionId: q.id,
            status: "unknown",
          })),
        })
      ).status,
    ).toBe(200);
    const current = await service.find(ownerId, workspace.id);
    const next = await request(`/api/v2/cases/${workspace.id}/intake/advance`, "POST", {
      expectedRevision: current.workspaceRevision,
    });
    expect(next.status).toBe(202);
    const failedJob = (await next.json()) as { jobId: string };
    const execute = async (jobId: string) => {
      lifetime.check();
      progress.boundary("readback");
      const job = await service.job(ownerId, workspace.id, jobId);
      if (job.target.kind !== "workspace") throw new Error("Wrong synthetic job target");
      const instanceId = await measured.binding
        .prepare("SELECT runtime_instance_id FROM v2_jobs WHERE id=?")
        .bind(jobId)
        .first<string>("runtime_instance_id");
      const background: Promise<void>[] = [];
      progress.boundary("runtime");
      const outcome = await runWorkspaceRuntime(
        env,
        {
          ownerId,
          workspaceId: workspace.id,
          workspaceRevision: job.target.workspaceRevision,
          jobId,
        },
        instanceId ?? "missing",
        (promise) => background.push(promise),
      );
      progress.boundary("runtime_receipts");
      await Promise.all(background);
      return outcome;
    };
    progress.enter("recovery", "runtime");
    unavailable = true;
    const callsBeforeOutage = providerCalls;
    const outageOutcome = await recovery.run("outage_runtime", () => execute(failedJob.jobId));
    expect(outageOutcome.status).toBe("failed");
    const latest = await recovery.run("outage_latest", () =>
      request(`/api/v2/cases/${workspace.id}/workspace-jobs/latest`),
    );
    expect(latest.status).toBe(200);
    const failed = (await latest.json()) as { status: string; retryable: boolean };
    if (failed.status !== "failed" || !failed.retryable) {
      console.error(
        "Synthetic native admission diagnostics",
        JSON.stringify({
          applicationCostLimitsEnabled,
          providerReached: providerCalls > callsBeforeOutage,
          providerCallsDuringOutage: providerCalls - callsBeforeOutage,
          stageTimings:
            "stageTimings" in outageOutcome
              ? outageOutcome.stageTimings.map(({ stage, durationMs, outcome }) => ({
                  stage,
                  durationMs,
                  outcome,
                }))
              : [],
          databaseFailureHistory: databaseFailureHistory.snapshot(),
          ...(await nativeAdmissionDiagnostics(core, env, ownerId, workspace.id, failedJob.jobId)),
        }),
      );
    }
    expect(failed).toMatchObject({ status: "failed", retryable: true });
    unavailable = false;
    auditRejected = true;
    const retryRevision = await recovery.run("policy_retry_revision", () =>
      service.find(ownerId, workspace.id),
    );
    const retry = await recovery.run("policy_retry_request", () =>
      request(`/api/v2/cases/${workspace.id}/workspace-jobs/${failedJob.jobId}/retry`, "POST", {
        expectedRevision: retryRevision.workspaceRevision,
      }),
    );
    expect(retry.status).toBe(202);
    expect(
      (await recovery.run("policy_rejected_runtime", () => execute(failedJob.jobId))).status,
    ).toBe("failed");
    expect(
      await recovery.run("policy_job_readback", () =>
        service.job(ownerId, workspace.id, failedJob.jobId),
      ),
    ).toMatchObject({
      status: "failed",
      failure: "POLICY_REJECTED",
      attempts: 2,
      retryable: true,
    });
    expect(
      await recovery.run("policy_flag_readback", () =>
        measured.binding
          .prepare("SELECT retryable FROM v2_jobs WHERE id=?")
          .bind(failedJob.jobId)
          .first<number>("retryable"),
      ),
    ).toBe(0);
    // Exercise the legacy retryable=0 branch on native D1 with real paid predicates.
    // The first retry's rejected drafts remain unpublished and its answers remain saved.
    expect(
      (await recovery.run("policy_intake_readback", () => service.intake(ownerId, workspace.id)))
        ?.batches,
    ).toHaveLength(1);
    auditRejected = false;
    const recoveryRevision = await recovery.run("recovery_revision", () =>
      service.find(ownerId, workspace.id),
    );
    const policyRetry = await recovery.run("recovery_request", () =>
      request(`/api/v2/cases/${workspace.id}/workspace-jobs/${failedJob.jobId}/retry`, "POST", {
        expectedRevision: recoveryRevision.workspaceRevision,
      }),
    );
    expect(policyRetry.status).toBe(202);
    expect((await recovery.run("recovery_runtime", () => execute(failedJob.jobId))).status).toBe(
      "completed",
    );
    expect(providerCalls).toBe(9);
    console.info(
      "Synthetic native recovery measurements",
      JSON.stringify({
        requestedCostLimitsEnabled: applicationCostLimitsEnabled,
        elapsedMs: Math.round(performance.now() - started),
        recovery: recovery.snapshot(),
        database: measured.measurements(),
        provider: providerMeasurements,
        hostBaseline,
        host: nativeHostMeasurements(),
      }),
    );
    progress.enter("summary", "readback");
    // Continue every paid product phase on native D1, including encrypted
    // staging/publishing of facts, parties, timeline and actions.
    for (const batchIndex of [1]) {
      const currentIntake = await service.intake(ownerId, workspace.id);
      expect(
        (
          await request(`/api/v2/cases/${workspace.id}/intake/answers`, "PUT", {
            expectedRevision: currentIntake?.revision,
            answers: currentIntake?.batches[batchIndex]?.questions.map((q) => ({
              questionId: q.id,
              status: "unknown",
            })),
          })
        ).status,
      ).toBe(200);
      const continuation = await request(`/api/v2/cases/${workspace.id}/intake/advance`, "POST", {
        expectedRevision: (await service.find(ownerId, workspace.id)).workspaceRevision,
      });
      expect(continuation.status).toBe(202);
      const accepted = (await continuation.json()) as { jobId: string };
      expect((await execute(accepted.jobId)).status).toBe("completed");
    }
    const summary = await service.intake(ownerId, workspace.id);
    expect(summary?.batches).toHaveLength(2);
    expect(summary?.summary).toBeDefined();
    const summaryResponse = await request(`/api/v2/cases/${workspace.id}/summary`);
    expect(summaryResponse.status).toBe(200);
    expect(await summaryResponse.json()).toMatchObject({
      facts: [{ id: "initial_fact" }],
      parties: [{ id: "initial_party" }],
    });
    const confirmed = await request(`/api/v2/cases/${workspace.id}/summary/confirm`, "POST", {
      expectedRevision: summary?.revision,
      summaryRevision: summary?.summary?.revision,
    });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ status: "active" });
    progress.enter("chat", "request");
    const chat = await request(`/api/v2/cases/${workspace.id}/messages`, "POST", {
      expectedRevision: (await service.find(ownerId, workspace.id)).workspaceRevision,
      text: "새로운 자료를 찾았습니다.",
      selectedFileIds: [],
    });
    expect(chat.status).toBe(202);
    const chatJob = (await chat.json()) as { jobId: string };
    const oldPlan = await preview
      .prepare(
        "SELECT p.id,p.evidence_hash,p.payload_json,p.digest FROM v2_execution_job_holds h JOIN v2_execution_job_plans p ON p.id=h.plan_id WHERE h.job_id=? AND h.state='prepared' ORDER BY h.attempt_id LIMIT 1",
      )
      .bind(chatJob.jobId)
      .first<{ id: string; evidence_hash: string; payload_json: string; digest: string }>();
    const callsBeforeChat = providerCalls;
    expect(oldPlan).not.toBeNull();
    // Legitimate configuration change after admission changes the wire. It
    // represents an old queued prompt/catalog without tampering with its proof.
    if (staleChatAdmission) env.HOMETAX_SERVICE_KEY = "synthetic-nonsecret-configuration";
    unavailable = !staleChatAdmission;
    expect((await execute(chatJob.jobId)).status).toBe("failed");
    expect(await service.job(ownerId, workspace.id, chatJob.jobId)).toMatchObject({
      status: "failed",
      failure: "MODEL_UNAVAILABLE",
      retryable: true,
    });
    if (staleChatAdmission) expect(providerCalls).toBe(callsBeforeChat);
    unavailable = false;
    const chatRetry = await request(
      `/api/v2/cases/${workspace.id}/workspace-jobs/${chatJob.jobId}/retry`,
      "POST",
      { expectedRevision: (await service.find(ownerId, workspace.id)).workspaceRevision },
    );
    expect(chatRetry.status).toBe(202);
    const replayedRetry = await request(
      `/api/v2/cases/${workspace.id}/workspace-jobs/${chatJob.jobId}/retry`,
      "POST",
      { expectedRevision: (await service.find(ownerId, workspace.id)).workspaceRevision },
    );
    expect(replayedRetry.status).toBe(202);
    expect((await execute(chatJob.jobId)).status).toBe("completed");
    const expectedCalls = staleChatAdmission ? 13 : 14;
    expect(providerCalls).toBe(expectedCalls);
    if (staleChatAdmission && oldPlan)
      expect(
        await preview
          .prepare(
            "SELECT id,evidence_hash,payload_json,digest FROM v2_execution_job_plans WHERE id=?",
          )
          .bind(oldPlan.id)
          .first<NonNullable<typeof oldPlan>>(),
      ).toEqual(oldPlan);
    const messages = await request(`/api/v2/cases/${workspace.id}/messages`);
    expect(messages.status).toBe(200);
    expect(await messages.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          safety: "validated",
          text: "새로 찾은 자료의 이름과 날짜를 확인해 주세요.",
        }),
      ]),
    });
    expect(await service.actions(ownerId, workspace.id)).toHaveLength(1);
    expect(await service.timeline(ownerId, workspace.id)).toHaveLength(1);
    expect(
      await preview
        .prepare("SELECT count(*) AS n FROM v2_execution_attempts WHERE state='settled'")
        .first<number>("n"),
    ).toBe(applicationCostLimitsEnabled ? 12 : expectedCalls);
    expect(
      await preview
        .prepare(
          "SELECT count(*) AS n FROM v2_execution_attempts WHERE state='ambiguous' AND charged_krw IS NULL",
        )
        .first<number>("n"),
    ).toBe(applicationCostLimitsEnabled ? (staleChatAdmission ? 1 : 2) : 0);
    if (!applicationCostLimitsEnabled) {
      expect(
        await preview.prepare("SELECT count(*) n FROM v2_cost_attempts").first<number>("n"),
      ).toBe(2);
      expect(
        await preview
          .prepare(
            "SELECT count(*) n FROM v2_execution_cost_observations WHERE charged_krw IS NULL",
          )
          .first<number>("n"),
      ).toBe(staleChatAdmission ? 1 : 2);
    }
    // Replay cannot emit another model request or duplicate published entities.
    progress.enter("replay", "runtime");
    expect((await execute(chatJob.jobId)).status).toBe("completed");
    expect(providerCalls).toBe(expectedCalls);
    completed = true;
  } catch (error) {
    progress.report("failure");
    throw error;
  } finally {
    progress.enter("cleanup", "dispose");
    let cleanupComplete = false;
    try {
      await lifetime.dispose();
      cleanupComplete = true;
    } finally {
      progress.finish(completed && cleanupComplete);
    }
  }
}

for (const enabled of [true, false]) {
  for (const stale of [false, true]) {
    test(
      `workerd D1 executes questions, recovery and chat (cost limits=${enabled}, stale admission=${stale})`,
      () => nativeTests.run((lifetime) => exerciseNativeRuntime(enabled, lifetime, stale)),
      30000,
    );
  }
}
