import { describe, expect, test } from "bun:test";
import { type AiConfiguration, inspectAiConfiguration } from "../runtime/ai-configuration";
import { api } from "./index";

describe("health API", () => {
  test("reports the Worker as live without requiring dependencies", async () => {
    const response = await api.request("/health/live");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(body).toEqual({
      status: "ok",
      service: "baro",
      environment: "test",
      release: "local",
    });
  });

  test("preserves a caller-provided request id", async () => {
    const response = await api.request("/health/live", {
      headers: { "x-request-id": "test-request-id" },
    });

    expect(response.headers.get("x-request-id")).toBe("test-request-id");
  });
});

function configurationFixture() {
  const now = new Date().toISOString();
  const secret = "configuration-secret-must-not-be-returned";
  const config = {
    bounds: {
      basis: "verified_model_context_limit",
      tokenizerRevision: secret,
      textTokensUpperBound: 1050000,
      framingTokensUpperBound: 0,
      vision: null,
      modelInputTokenLimit: 1050000,
      modelContextTokenLimit: 1050000,
      modelOutputTokenLimit: 128000,
      checkedAt: now,
      validUntil: new Date(Date.parse(now) + 3600000).toISOString(),
    },
    evidenceHash: "e".repeat(64),
    verifiedAt: now,
  };
  let calls = 0;
  const forbidden = () => {
    calls++;
    throw new Error(secret);
  };
  const env = {
    APP_ENV: "preview",
    RELEASE_SHA: "a".repeat(40),
    PUBLIC_BETA_ENABLED: "false",
    AI_GATEWAY_ID: "baro-preview",
    AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(config),
    CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, ""),
    BETTER_AUTH_SECRET: secret,
    AI: { run: forbidden },
    WORKSPACE_PROCESSING: { create: forbidden, get: forbidden },
    ANALYSIS_ACCOUNT_LIMIT: { limit: forbidden },
    CASE_ACCOUNT_LIMIT: { limit: forbidden },
    CASE_IP_LIMIT: { limit: forbidden },
    DB: { prepare: forbidden },
  } as unknown as Env;
  return { env, config, now, secret, calls: () => calls };
}

describe("AI configuration health", () => {
  test("checks actual planner limits without invoking AI, Workflow or DB and never exposes secrets", async () => {
    const f = configurationFixture();
    const response = await api.request("/health/ai-configuration", undefined, f.env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      status: "ready",
      environment: "preview",
      release: "a".repeat(40),
      reservations: [
        { phase: "workspace_questions", inputTokens: 1047600, outputTokens: 2400 },
        { phase: "workspace_summary", inputTokens: 1040000, outputTokens: 10000 },
        { phase: "workspace_chat", inputTokens: 1040000, outputTokens: 10000 },
        { phase: "workspace_audit", inputTokens: 1047600, outputTokens: 2400 },
      ],
    });
    expect(JSON.stringify(body)).not.toContain(f.secret);
    expect(JSON.stringify(body)).not.toContain(f.env.CASE_DATA_KEY_V1);
    expect(JSON.stringify(body)).not.toContain(f.config.evidenceHash);
    expect(f.calls()).toBe(0);
  });

  test("is public in closed production and fails closed without environment bindings", async () => {
    const f = configurationFixture();
    const production = await api.request("/health/ai-configuration", undefined, {
      ...f.env,
      APP_ENV: "production",
      AI_GATEWAY_ID: "baro-production",
    } as Env);
    expect(production.status).toBe(200);
    expect(((await production.json()) as AiConfiguration).environment).toBe("production");
    const missing = await api.request("/health/ai-configuration");
    expect(missing.status).toBe(503);
    expect((await missing.json()) as AiConfiguration).toEqual({
      status: "not_ready",
      environment: "test",
      release: "local",
      reservations: [],
    });
    expect(f.calls()).toBe(0);
  });

  for (const dependency of ["AI", "create", "get", "gateway"] as const) {
    test(`missing ${dependency} capability cannot report ready`, async () => {
      const f = configurationFixture();
      const env = {
        ...f.env,
        ...(dependency === "AI" ? { AI: {} } : {}),
        ...(dependency === "create" || dependency === "get"
          ? { WORKSPACE_PROCESSING: { ...f.env.WORKSPACE_PROCESSING, [dependency]: undefined } }
          : {}),
        ...(dependency === "gateway" ? { AI_GATEWAY_ID: " " } : {}),
      } as unknown as Env;
      const result = await inspectAiConfiguration(env, f.now);
      expect(result.status).toBe("not_ready");
      expect(result.reservations).toEqual([]);
      expect(f.calls()).toBe(0);
    });
  }

  for (const dependency of [
    "ANALYSIS_ACCOUNT_LIMIT",
    "CASE_ACCOUNT_LIMIT",
    "CASE_IP_LIMIT",
  ] as const) {
    for (const value of [undefined, { limit: "invalid" }]) {
      test(`missing or malformed ${dependency} fails without consuming a rate-limit token`, async () => {
        const f = configurationFixture();
        const result = await inspectAiConfiguration(
          { ...f.env, [dependency]: value } as unknown as Env,
          f.now,
        );
        expect(result.status).toBe("not_ready");
        expect(result.reservations).toEqual([]);
        expect(f.calls()).toBe(0);
      });
    }
  }

  test("missing or malformed case-data keys fail without revealing the key or touching data", async () => {
    const f = configurationFixture();
    for (const key of [undefined, "", f.secret, btoa("w".repeat(16)).replace(/=+$/, "")]) {
      const response = await api.request("/health/ai-configuration", undefined, {
        ...f.env,
        CASE_DATA_KEY_V1: key,
      } as unknown as Env);
      expect(response.status).toBe(503);
      const body = (await response.json()) as AiConfiguration;
      expect(body.status).toBe("not_ready");
      expect(body.reservations).toEqual([]);
      expect(JSON.stringify(body)).not.toContain(f.secret);
      if (key) expect(JSON.stringify(body)).not.toContain(key);
    }
    expect(f.calls()).toBe(0);
  });

  for (const condition of [
    "missing",
    "malformed",
    "expired",
    "short_horizon",
    "exact_horizon",
    "future_checked",
    "future_verified",
    "insufficient_output",
    "insufficient_input",
    "context_vision",
  ] as const) {
    test(`${condition} bounds fail closed with no partial capacity or private configuration`, async () => {
      const f = configurationFixture();
      const bounds = f.config.bounds;
      if (condition === "expired") bounds.validUntil = f.now;
      if (condition === "short_horizon")
        bounds.validUntil = new Date(Date.parse(f.now) + 299999).toISOString();
      if (condition === "exact_horizon")
        bounds.validUntil = new Date(Date.parse(f.now) + 300000).toISOString();
      if (condition === "future_checked")
        bounds.checkedAt = new Date(Date.parse(f.now) + 1000).toISOString();
      if (condition === "future_verified")
        f.config.verifiedAt = new Date(Date.parse(f.now) + 1000).toISOString();
      if (condition === "insufficient_output") bounds.modelOutputTokenLimit = 2400;
      if (condition === "insufficient_input") bounds.modelInputTokenLimit = 1000;
      const configured = {
        ...f.config,
        bounds: {
          ...bounds,
          ...(condition === "context_vision"
            ? {
                vision: {
                  imageCount: 1,
                  maximumTokens: 100,
                  capabilityEvidenceHash: "b".repeat(64),
                  dimensionsAndDetailHash: "c".repeat(64),
                },
              }
            : {}),
        },
      };
      f.env.AI_MODEL_TOKEN_BOUNDS_JSON =
        condition === "missing"
          ? ""
          : condition === "malformed"
            ? f.secret
            : JSON.stringify(configured);
      const result = await inspectAiConfiguration(f.env, f.now);
      expect(result.status).toBe("not_ready");
      expect(result.reservations).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(f.secret);
      expect(JSON.stringify(result)).not.toContain(f.config.evidenceHash);
      expect(f.calls()).toBe(0);
    });
  }

  test("verified tokenizer reservations match the planner including framing and vision", async () => {
    const f = configurationFixture();
    f.env.AI_MODEL_TOKEN_BOUNDS_JSON = JSON.stringify({
      ...f.config,
      bounds: {
        ...f.config.bounds,
        basis: "verified_tokenizer_and_framing",
        textTokensUpperBound: 1000,
        framingTokensUpperBound: 20,
        modelInputTokenLimit: 2000,
        modelContextTokenLimit: 12000,
        modelOutputTokenLimit: 10000,
        vision: {
          imageCount: 1,
          maximumTokens: 500,
          capabilityEvidenceHash: "b".repeat(64),
          dimensionsAndDetailHash: "c".repeat(64),
        },
      },
    });
    const result = await inspectAiConfiguration(f.env, f.now);
    expect(result.status).toBe("ready");
    expect(result.reservations.map((item) => item.inputTokens)).toEqual([1520, 1520, 1520, 1520]);
    expect(f.calls()).toBe(0);
  });
});
