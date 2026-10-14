import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { Hono } from "hono";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import observation from "../docs/operations/AI-RUNTIME-OBSERVATION.json";
import { modelBounds, observationSchema, provisionAiRuntime } from "../scripts/provision-ai-budget";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core, type V2Core } from "../src/server/db/v2-core";
import { runtimeDigest } from "../src/server/db/v2-paid-runtime";
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

/** Failure-only synthetic diagnostics: never serialize rows, identities, text or errors. */
async function nativeAdmissionDiagnostics(
  core: V2Core,
  env: Env,
  ownerId: string,
  workspaceId: string,
  jobId: string,
) {
  const result: Record<string, boolean | number> = { probeComplete: false };
  try {
    const now = new Date().toISOString();
    const row = await core
      .statement(
        "SELECT h.state,p.payload_json,p.digest,p.evidence_hash FROM v2_paid_holds h JOIN v2_runtime_plans p ON p.id=h.plan_id WHERE h.job_id=? ORDER BY h.attempt_id LIMIT 1",
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
    // The failed second-question job resets status/currentJobId only; the shared
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
  } catch {
    // Preserve the original failing assertion without leaking the probe error.
  }
  return result;
}

// Wrangler pins this workerd/Miniflare pair in bun.lock. Using its actual D1
// implementation catches SQLite authorization/SQL limits that bun:sqlite cannot.
async function exerciseNativeRuntime(applicationCostLimitsEnabled: boolean) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("local AI runtime test"); } }',
      compatibilityDate: "2026-10-01",
      d1Databases: ["PREVIEW", "PRODUCTION"],
      cf: false,
      unsafeRegisterWorker: false,
    }),
  );
  try {
    const preview = (await mf.getD1Database("PREVIEW")) as unknown as D1Database,
      production = (await mf.getD1Database("PRODUCTION")) as unknown as D1Database;
    const migrations = (await readdir("drizzle"))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    for (const db of [preview, production]) {
      for (const name of migrations) {
        // Preview starts on the real pre-upgrade schema. Production is the fresh
        // latest-schema reference; never apply a later migration before an older one.
        if (db === preview && name >= "0014_") continue;
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
    const provisioned = await provisionAiRuntime({ preview, production }, observed),
      ownerId = crypto.randomUUID(),
      sessionId = crypto.randomUUID(),
      sessionToken = `synthetic-session-${sessionId}`;
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
    let core = createV2Core(preview, cipher, {
      applicationCostLimitsEnabled: true,
      monthlyBudgetCapEnabled: false,
    });
    let providerCalls = 0,
      unavailable = false,
      auditRejected = false;
    const env = {
      ...testEnvironment(preview),
      APP_ENV: "preview",
      DB: preview,
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
        async run(_model: string, input: Record<string, unknown>) {
          providerCalls++;
          if (unavailable)
            return Response.json(
              { error: { message: "Invalid schema for response_format: synthetic rejection" } },
              { status: 400 },
            );
          const phase = (input.response_format as { json_schema: { name: string } }).json_schema
            .name;
          const messages = input.messages as { content: string }[];
          const context = JSON.parse(messages[1]?.content ?? "null").data as WorkspaceContext;
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
        },
      },
    } as unknown as Env;
    let service = createWorkspaceService(core, createWorkspaceDependencies(core, env));
    const cookie = await signedSessionCookie(sessionToken, env.BETTER_AUTH_SECRET);
    const app = new Hono().route(
      "/api/v2/cases",
      createWorkspacesApi({
        dependencies: async (bindings, c) => createWorkspaceDependencies(c, bindings),
      }),
    );
    const request = async (path: string, method = "GET", body?: unknown) =>
      app.request(
        path,
        {
          method,
          headers: {
            cookie,
            origin: env.BETTER_AUTH_URL,
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        env,
      );
    const workspace = await service.create(ownerId, crypto.randomUUID(), {
      narrative: "합성 계약 자료의 거래 날짜를 확인하고 상담을 준비하려고 합니다.",
      jurisdiction: "KR",
      subjectContext: "individual",
      turnstileToken: "synthetic",
    });
    const admission = await request(`/api/v2/cases/${workspace.id}/intake/advance`, "POST", {
      expectedRevision: workspace.workspaceRevision,
    });
    expect(admission.status).toBe(202);
    const queued = (await admission.json()) as { status: string; jobId: string };
    expect(queued.status).toBe("queued");
    const pending: Promise<void>[] = [];
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
    await Promise.all(pending);
    expect(result.status).toBe("completed");
    expect(providerCalls).toBe(2);
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
    // Upgrade populated 0013 -> 0014 -> 0015 in order. A failure in either
    // import must roll back data, tables, triggers and the schema marker.
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
          async (table) => (await preview.prepare(`SELECT * FROM ${table}`).all()).results,
        ),
      );
    const schema = async (db: D1Database) =>
      (
        await db
          .prepare(
            "SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY type,name",
          )
          .all()
      ).results;
    for (const name of migrations.filter((name) => name >= "0014_")) {
      const migration = (await Bun.file(`drizzle/${name}`).text())
        .split("--> statement-breakpoint")
        .map((sql) => sql.trim())
        .filter(Boolean);
      const original = await snapshot();
      expect(original[1]?.length).toBeGreaterThan(0);
      const originalSchema = await schema(preview);
      await expect(
        preview.batch([
          ...migration.map((sql) => preview.prepare(sql)),
          preview.prepare("SELECT json('synthetic-invalid-json')"),
        ]),
      ).rejects.toThrow();
      expect(await snapshot()).toEqual(original);
      expect(await schema(preview)).toEqual(originalSchema);
      // Remote imports must not depend on deferred-FK state surviving statement
      // boundaries. Check every intermediate schema as well as the final rows.
      const upgraded = await preview.batch(
        migration.flatMap((sql) => [
          preview.prepare(sql),
          preview.prepare("PRAGMA foreign_key_check"),
        ]),
      );
      for (let i = 1; i < upgraded.length; i += 2) expect(upgraded[i]?.results).toEqual([]);
      expect((await snapshot()).slice(0, -1)).toEqual(original.slice(0, -1));
      expect(
        await preview
          .prepare("SELECT value FROM app_metadata WHERE key='schema_version'")
          .first<string>("value"),
      ).toBe(name.slice(0, -4));
      expect((await preview.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    }
    expect(await schema(preview)).toEqual(await schema(production));
    // The new no-cap runtime requires 0015's accounting tables. Exercise it only
    // after the populated upgrade, retaining earlier paid plans and receipts.
    env.APPLICATION_COST_LIMITS_ENABLED = String(applicationCostLimitsEnabled);
    core = createV2Core(preview, cipher, {
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
      const job = await service.job(ownerId, workspace.id, jobId);
      if (job.target.kind !== "workspace") throw new Error("Wrong synthetic job target");
      const instanceId = await preview
        .prepare("SELECT runtime_instance_id FROM v2_jobs WHERE id=?")
        .bind(jobId)
        .first<string>("runtime_instance_id");
      const background: Promise<void>[] = [];
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
      await Promise.all(background);
      return outcome;
    };
    unavailable = true;
    const callsBeforeOutage = providerCalls;
    expect((await execute(failedJob.jobId)).status).toBe("failed");
    const latest = await request(`/api/v2/cases/${workspace.id}/workspace-jobs/latest`);
    expect(latest.status).toBe(200);
    const failed = (await latest.json()) as { status: string; retryable: boolean };
    if (failed.status !== "failed" || !failed.retryable) {
      console.error("Synthetic native admission diagnostics", {
        applicationCostLimitsEnabled,
        providerReached: providerCalls > callsBeforeOutage,
        providerCallsDuringOutage: providerCalls - callsBeforeOutage,
        ...(await nativeAdmissionDiagnostics(core, env, ownerId, workspace.id, failedJob.jobId)),
      });
    }
    expect(failed).toMatchObject({ status: "failed", retryable: true });
    unavailable = false;
    auditRejected = true;
    const retry = await request(
      `/api/v2/cases/${workspace.id}/workspace-jobs/${failedJob.jobId}/retry`,
      "POST",
      { expectedRevision: (await service.find(ownerId, workspace.id)).workspaceRevision },
    );
    expect(retry.status).toBe(202);
    expect((await execute(failedJob.jobId)).status).toBe("failed");
    expect(await service.job(ownerId, workspace.id, failedJob.jobId)).toMatchObject({
      status: "failed",
      failure: "POLICY_REJECTED",
      attempts: 2,
      retryable: true,
    });
    expect(
      await preview
        .prepare("SELECT retryable FROM v2_jobs WHERE id=?")
        .bind(failedJob.jobId)
        .first<number>("retryable"),
    ).toBe(0);
    // Exercise the legacy retryable=0 branch on native D1 with real paid predicates.
    // The first retry's rejected drafts remain unpublished and its answers remain saved.
    expect((await service.intake(ownerId, workspace.id))?.batches).toHaveLength(1);
    auditRejected = false;
    const policyRetry = await request(
      `/api/v2/cases/${workspace.id}/workspace-jobs/${failedJob.jobId}/retry`,
      "POST",
      { expectedRevision: (await service.find(ownerId, workspace.id)).workspaceRevision },
    );
    expect(policyRetry.status).toBe(202);
    expect((await execute(failedJob.jobId)).status).toBe("completed");
    expect(providerCalls).toBe(9);
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
    const chat = await request(`/api/v2/cases/${workspace.id}/messages`, "POST", {
      expectedRevision: (await service.find(ownerId, workspace.id)).workspaceRevision,
      text: "새로운 자료를 찾았습니다.",
      selectedFileIds: [],
    });
    expect(chat.status).toBe(202);
    const chatJob = (await chat.json()) as { jobId: string };
    unavailable = true;
    expect((await execute(chatJob.jobId)).status).toBe("failed");
    expect(await service.job(ownerId, workspace.id, chatJob.jobId)).toMatchObject({
      status: "failed",
      failure: "MODEL_UNAVAILABLE",
      retryable: true,
    });
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
    expect(providerCalls).toBe(14);
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
        .prepare("SELECT count(*) AS n FROM v2_cost_attempts WHERE state='settled'")
        .first<number>("n"),
    ).toBe(12);
    expect(
      await preview
        .prepare(
          "SELECT count(*) AS n FROM v2_cost_attempts WHERE state='ambiguous' AND charged_krw IS NULL",
        )
        .first<number>("n"),
    ).toBe(2);
    // Replay cannot emit another model request or duplicate published entities.
    expect((await execute(chatJob.jobId)).status).toBe("completed");
    expect(providerCalls).toBe(14);
  } finally {
    await mf.dispose();
  }
}

for (const enabled of [true, false]) {
  test(
    `workerd D1 executes questions, recovery and chat (cost limits=${enabled})`,
    () => exerciseNativeRuntime(enabled),
    30000,
  );
}
