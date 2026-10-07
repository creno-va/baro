import { expect, test } from "bun:test";
import observation from "../docs/operations/AI-RUNTIME-OBSERVATION.json";
import { modelBounds, observationSchema, provisionAiRuntime } from "../scripts/provision-ai-budget";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import type { prepareGatewayWireInput } from "../src/server/modules/llm-gateway/service";
import type { WorkspaceParams } from "../src/server/modules/workspace/execution";
import { createWorkspaceService } from "../src/server/modules/workspace/service";
import { createWorkspaceDependencies, runWorkspaceRuntime } from "../src/server/runtime/workspace";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

test.each(["MODEL_UNAVAILABLE", "POLICY_REJECTED"] as const)(
  "actual workspace retry recovers %s with paid admission and full audit",
  async (failure) => {
    const preview = await createTestDatabase(),
      production = await createTestDatabase();
    try {
      const now = new Date().toISOString(),
        o = observationSchema.parse({
          ...observation,
          checkedAt: now,
          validUntil: new Date(Date.now() + 86400000).toISOString(),
        }),
        proof = await provisionAiRuntime(
          { preview: preview.binding, production: production.binding },
          o,
        ),
        session = await seedTestSession(preview, { consent: true }),
        key = btoa("w".repeat(32)).replace(/=+$/, ""),
        core = createV2Core(
          preview.binding,
          await createCaseDataCipher({ CASE_DATA_KEY_V1: key }),
          {
            monthlyBudgetCapEnabled: false,
          },
        );
      let dispatch: { id: string; params: WorkspaceParams } | undefined,
        modelCalls = 0,
        providerFail = true;
      const env = {
        DB: preview.binding,
        APP_ENV: "preview",
        MONTHLY_BUDGET_CAP_ENABLED: "false",
        CASE_DATA_KEY_V1: key,
        AI_GATEWAY_ID: "baro-preview",
        AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(modelBounds(o, proof.evidenceHash)),
        WORKSPACE_PROCESSING: {
          async get() {
            throw new Error("Synthetic absent instance");
          },
          async create(input: { id: string; params: WorkspaceParams }) {
            dispatch = input;
            return { id: input.id, status: async () => ({ status: "queued" }) };
          },
        },
        AI: {
          async run(_model: string, input: ReturnType<typeof prepareGatewayWireInput>) {
            modelCalls++;
            if (providerFail && failure === "MODEL_UNAVAILABLE")
              throw Object.assign(new Error("Synthetic provider error"), { status: 401 });
            const audit = input.response_format.json_schema.name.includes("workspace_audit");
            expect(JSON.stringify(input.response_format)).not.toContain('"oneOf"');
            return {
              id: "synthetic-provider-request",
              service_tier: "default",
              usage: {
                prompt_tokens: 10,
                completion_tokens: 20,
                prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
              },
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({
                      output: audit
                        ? {
                            pass: !providerFail,
                            findings: [],
                            unsupportedFactIds: [],
                            legalClaimsSupported: true,
                            strategyDetected: false,
                          }
                        : {
                            questions: [
                              {
                                id: "synthetic-question",
                                prompt: "계약 날짜를 확인할 자료가 있나요?",
                                answerType: "text",
                                options: [],
                              },
                            ],
                          },
                    }),
                  },
                },
              ],
            };
          },
        },
      } as unknown as Env;
      const service = createWorkspaceService(core, createWorkspaceDependencies(core, env)),
        workspace = await service.create(session.userId, crypto.randomUUID(), {
          narrative: "합성 계약 자료의 날짜를 확인하고 상담을 준비하려고 합니다.",
          subjectContext: "individual",
          jurisdiction: "KR",
          turnstileToken: "synthetic",
        });
      const pending: Promise<void>[] = [];
      const run = async () => {
        if (!dispatch) throw new Error("Synthetic dispatch absent");
        const result = await runWorkspaceRuntime(env, dispatch.params, dispatch.id, (work) =>
          pending.push(work),
        );
        await Promise.all(pending);
        return result;
      };
      await service.advance(session.userId, workspace.id, crypto.randomUUID(), {
        expectedRevision: workspace.workspaceRevision,
      });
      expect((await run()).status).toBe("failed");
      const job = await service.latestJob(session.userId, workspace.id),
        latest = await service.find(session.userId, workspace.id);
      if (!job) throw new Error("Synthetic job absent");
      expect(job.failure).toBe(failure);
      expect(job.retryable).toBe(true);
      if (failure === "POLICY_REJECTED")
        expect(
          preview.sqlite.query("SELECT retryable FROM v2_jobs WHERE id=?").get(job.id),
        ).toEqual({
          retryable: 0,
        });
      providerFail = false;
      expect(
        (
          await service.retry(session.userId, workspace.id, job.id, {
            expectedRevision: latest.workspaceRevision,
          })
        ).status,
      ).toBe("queued");
      expect((await run()).status).toBe("completed");
      expect(modelCalls).toBe(failure === "MODEL_UNAVAILABLE" ? 3 : 6);
      expect(
        preview.sqlite
          .query("SELECT state,count(*) AS n FROM v2_cost_attempts GROUP BY state ORDER BY state")
          .all(),
      ).toEqual(
        failure === "MODEL_UNAVAILABLE"
          ? [
              { state: "ambiguous", n: 1 },
              { state: "settled", n: 2 },
            ]
          : [{ state: "settled", n: 6 }],
      );
      expect(
        preview.sqlite.query("SELECT count(*) AS n FROM v2_paid_holds WHERE state='unknown'").get(),
      ).toEqual({ n: failure === "MODEL_UNAVAILABLE" ? 1 : 0 });
    } finally {
      preview.close();
      production.close();
    }
  },
);
