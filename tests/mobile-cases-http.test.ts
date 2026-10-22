import { expect, test } from "bun:test";
import { createCasesClient, createJsonRequester, type OperationRequest } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { Hono } from "hono";
import { createCasesModel } from "../apps/mobile/src/features/cases/model";
import type { SessionState } from "../apps/mobile/src/features/session/model";
import { createCaseOperationStorage } from "../apps/mobile/src/platform/storage/case-operations";
import { casesApi } from "../src/server/api/cases";
import type { ApiEnvironment } from "../src/server/api/errors";
import { meApi } from "../src/server/api/me";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

test("native model + verified operation storage recovers a lost actual Hono/SQL creation with one case and no stored facts", async () => {
  const db = await createTestDatabase();
  try {
    const owner = await seedTestSession(db, { consent: true });
    const env: Env = {
      ...owner.env,
      CASE_DATA_KEY_V1: btoa("a".repeat(32)).replace(/=+$/, ""),
      CASE_IP_LIMIT: { limit: async () => ({ success: true }) },
      CASE_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
    };
    const app = new Hono<ApiEnvironment>()
      .route("/api/me", meApi)
      .route("/api/cases", casesApi)
      .route("/api/v2/cases", createWorkspacesApi({ turnstile: async () => true }));
    const scope = createSessionScope(),
      records = new Map<string, string>(),
      keys: string[] = [];
    const fingerprint = async (value: string) =>
      Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString(
        "hex",
      );
    let lost = true;
    const storage = createCaseOperationStorage({
      namespace: "baro_preview_case_operations",
      fingerprint,
      storage: {
        get: async (key) => records.get(key) ?? null,
        set: async (key, value) => {
          records.set(key, value);
        },
        remove: async (key) => {
          records.delete(key);
        },
      },
    });
    const request = createJsonRequester({
      scope,
      newKey: () => crypto.randomUUID(),
      transport: async (path, init) => {
        const headers = new Headers(init.headers);
        headers.set("cookie", owner.cookie);
        headers.set("origin", env.BETTER_AUTH_URL);
        headers.set("cf-connecting-ip", "192.0.2.1");
        const response = await app.request(path, { ...init, headers }, env);
        if (init.method === "POST" && path === "/api/v2/cases") {
          expect(response.status).toBe(201);
          keys.push(headers.get("idempotency-key") ?? "");
          if (lost) {
            lost = false;
            throw new Error("SYNTHETIC_RESPONSE_LOSS");
          }
        }
        return response;
      },
    });
    const operation: OperationRequest = (_action, _input, options = {}) =>
      request({ ...options, path: options.path ?? "/invalid" });
    const session: SessionState = {
      phase: "ready",
      busy: false,
      role: "customer",
      error: null,
      consent: null,
      session: {
        user: { id: owner.userId, name: "합성 고객", accountType: "customer" },
        needsConsent: false,
      },
    };
    const model = createCasesModel({
      session: { getSnapshot: () => session, subscribe: () => () => {}, refresh: async () => {} },
      createClient: (signal) =>
        createCasesClient({
          mode: "real",
          scope,
          signal,
          request: operation,
          persistence: "required",
          storage,
          newKey: () => crypto.randomUUID(),
          fingerprint,
          challenge: async () => "synthetic-widget-proof",
        }),
    });
    const stop = model.start();
    const ready = () =>
      new Promise<void>((done) => {
        if (!model.getSnapshot().busy) return done();
        const unsubscribe = model.subscribe(() => {
          if (!model.getSnapshot().busy) {
            unsubscribe();
            done();
          }
        });
      });
    await ready();
    model.newCase();
    const narrative = "계약과 대화 날짜를 정리해서 상담을 준비하려는 합성 사건 사실입니다.";
    model.setNarrative(narrative);
    await model.create();
    expect(model.getSnapshot().view).toBe("create");
    expect(model.getSnapshot().narrative).toBe(narrative);
    expect(records.size).toBe(1);
    expect(JSON.stringify([...records])).not.toContain(narrative);
    await model.create();
    expect(model.getSnapshot().view).toBe("detail");
    expect(model.getSnapshot().item?.schemaVersion).toBe("2");
    expect(new Set(keys).size).toBe(1);
    expect(records.size).toBe(0);
    expect(db.sqlite.query("SELECT count(*) n FROM v2_workspaces").get()).toEqual({ n: 1 });
    stop();
  } finally {
    db.close();
  }
});
