import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { Hono } from "hono";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import observation from "../docs/operations/AI-RUNTIME-OBSERVATION.json";
import { modelBounds, observationSchema, provisionAiRuntime } from "../scripts/provision-ai-budget";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import type { WorkspaceContext } from "../src/server/modules/workspace/pipeline";
import { createWorkspaceService } from "../src/server/modules/workspace/service";
import { createWorkspaceDependencies, runWorkspaceRuntime } from "../src/server/runtime/workspace";
import { signedSessionCookie, testEnvironment } from "./helpers/d1";

// Wrangler pins this workerd/Miniflare pair in bun.lock. Using its actual D1
// implementation catches SQLite authorization/SQL limits that bun:sqlite cannot.
test("workerd D1 executes authenticated questions, retry, summary confirmation and chat publication", async () => {
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
      core = createV2Core(preview, await createCaseDataCipher({ CASE_DATA_KEY_V1: key }), {
        monthlyBudgetCapEnabled: false,
      });
    let providerCalls = 0,
      unavailable = false;
    const env = {
      ...testEnvironment(preview),
      APP_ENV: "preview",
      DB: preview,
      CASE_DATA_KEY_V1: key,
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
          if (unavailable) throw new Error("Synthetic provider outage");
          const phase = (input.response_format as { json_schema: { name: string } }).json_schema
            .name;
          const messages = input.messages as { content: string }[];
          const context = JSON.parse(messages[1]?.content ?? "null").data as WorkspaceContext;
          let output: unknown;
          if (phase.includes("audit")) {
            output = {
              pass: true,
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
          return {
            id: `synthetic-receipt-${providerCalls}`,
            service_tier: "default",
            choices: [{ message: { content: JSON.stringify({ output }) }, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 500,
              completion_tokens: 100,
              prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
            },
          };
        },
      },
    } as unknown as Env;
    const service = createWorkspaceService(core, createWorkspaceDependencies(core, env));
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
    expect((await execute(failedJob.jobId)).status).toBe("failed");
    const latest = await request(`/api/v2/cases/${workspace.id}/workspace-jobs/latest`);
    expect(latest.status).toBe(200);
    expect(await latest.json()).toMatchObject({ status: "failed", retryable: true });
    unavailable = false;
    const retry = await request(
      `/api/v2/cases/${workspace.id}/workspace-jobs/${failedJob.jobId}/retry`,
      "POST",
      { expectedRevision: (await service.find(ownerId, workspace.id)).workspaceRevision },
    );
    expect(retry.status).toBe(202);
    expect((await execute(failedJob.jobId)).status).toBe("completed");
    expect(providerCalls).toBe(5);
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
    expect((await execute(chatJob.jobId)).status).toBe("completed");
    expect(providerCalls).toBe(9);
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
    ).toBe(8);
    // Replay cannot emit another model request or duplicate published entities.
    expect((await execute(chatJob.jobId)).status).toBe("completed");
    expect(providerCalls).toBe(9);
  } finally {
    await mf.dispose();
  }
}, 30000);
