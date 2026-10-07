import { expect, test } from "bun:test";
import { inspectEnvironment, inspectPreview } from "../scripts/environment-readiness";

const sha = "a".repeat(40);
test("readiness excludes credentials, raw errors and unrelated account resources", async () => {
  const secret = "DO-NOT-EXPORT-CREDENTIAL";
  const requests: string[] = [];
  const fetcher = (async (input, init) => {
    const url = String(input);
    requests.push(url);
    expect(init?.method).toBe("GET");
    const result = url.includes("settings")
      ? {
          bindings: [
            { name: "BETTER_AUTH_SECRET", type: "secret_text", text: secret },
            { name: "BETTER_AUTH_URL", type: "plain_text", text: "https://preview.baro.site" },
            { name: "RELEASE_SHA", type: "plain_text", text: sha },
            { name: "APP_ENV", type: "plain_text", text: "preview" },
            { name: "PUBLIC_BETA_ENABLED", type: "plain_text", text: "false" },
            { name: "AI_MODEL_TOKEN_BOUNDS_JSON", type: "plain_text", text: secret },
            { name: "CASE_PRIVATE_R2", type: "r2_bucket", bucket_name: secret },
            { name: "FILE_PROCESSOR", type: "durable_object_namespace", namespace_id: secret },
          ],
          secret,
        }
      : url.includes("ai-gateway")
        ? [
            { id: "baro-preview", collect_logs: false, cache_ttl: 0, authentication: true, secret },
            { id: secret },
          ]
        : [
            { domains: ["preview.baro.site"], secret, sitekey: secret },
            { domains: [secret], secret },
          ];
    return Response.json({ success: true, result });
  }) as typeof fetch;
  const report = await inspectPreview(secret, sha, fetcher, { checkGateway: true });
  expect(JSON.stringify(report)).not.toContain(secret);
  expect(report.worker.deployedSha).toBe(sha);
  expect(report.worker.secrets.find((s) => s.name === "BETTER_AUTH_SECRET")?.present).toBe(true);
  expect(report.turnstile.observedExclusivePreviewWidgetCount).toBe(1);
  expect(report.gateway.authentication).toBe(true);
  expect(report.worker.environmentMatches).toBe(true);
  expect(report.worker.publicBetaClosed).toBe(true);
  expect(report.worker.modelBoundsConfigured).toBe(true);
  expect(report.worker.processingBindings.find((b) => b.name === "CASE_PRIVATE_R2")?.present).toBe(
    true,
  );
  expect(report.worker.processingBindings.find((b) => b.name === "FILE_PROCESSING")?.present).toBe(
    false,
  );
  expect(requests).toHaveLength(3);
});

test("forbidden or malformed responses never become passed live gates or expose errors", async () => {
  const report = await inspectPreview(
    "private-token",
    sha,
    (async (input) => {
      if (String(input).includes("settings"))
        return Response.json({ success: true, result: { bindings: "bad" } });
      if (String(input).includes("ai-gateway"))
        return new Response("private-error-body", { status: 403 });
      throw new Error("private-error-stack");
    }) as typeof fetch,
    { checkGateway: true },
  );
  expect(report.worker.parsed).toBe(false);
  expect(report.worker.secrets.every((s) => s.present === null)).toBe(true);
  expect(report.worker.processingBindings.every((b) => b.present === null)).toBe(true);
  expect(report.worker.modelBoundsConfigured).toBeNull();
  expect(report.gateway.status).toBe("forbidden");
  expect(report.gateway.exists).toBeNull();
  expect(report.turnstile.status).toBe("unavailable");
  expect(report.turnstile.observedPreviewWidgetCount).toBeNull();
  expect(JSON.stringify(report)).not.toContain("private-");
  expect(report.unverified).toContain("live-model-eval");
});

test("default metadata observation does not repeat a known forbidden Gateway probe", async () => {
  const requests: string[] = [];
  const report = await inspectPreview("private-token", sha, (async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("ai-gateway")) throw new Error("Gateway must not be requested");
    return Response.json({
      success: true,
      result: url.includes("settings") ? { bindings: [] } : [],
    });
  }) as typeof fetch);
  expect(requests).toHaveLength(2);
  expect(requests.some((url) => url.includes("ai-gateway"))).toBe(false);
  expect(report.gateway.status).toBe("not_requested");
  expect(report.gateway.exists).toBeNull();
  expect(report.gateway.authentication).toBeNull();
});

test("production inspection reads selected metadata and exports only its unique public sitekey", async () => {
  const privateValue = "DO-NOT-EXPORT-PRODUCTION-SECRET";
  const requests: string[] = [];
  const report = await inspectEnvironment("private-token", sha, "production", async (url, init) => {
    requests.push(url);
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(init.body).toBeUndefined();
    return Response.json({
      success: true,
      result: url.includes("settings")
        ? {
            bindings: [
              { name: "APP_ENV", type: "plain_text", text: "production" },
              { name: "BETTER_AUTH_URL", type: "plain_text", text: "https://baro.site" },
              { name: "AI_GATEWAY_ID", type: "plain_text", text: "baro-production" },
              { name: "CASE_DATA_KEY_V1", type: "secret_text", text: privateValue },
            ],
          }
        : [
            { domains: ["baro.site"], sitekey: "public-production-sitekey", secret: privateValue },
            { domains: ["preview.baro.site"], sitekey: "unrelated-preview-sitekey" },
          ],
    });
  });
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEndWith("/workers/scripts/baro-production/settings");
  expect(requests[1]).toEndWith("/challenges/widgets?per_page=100");
  expect(report.environment).toBe("production");
  expect(report.worker.environmentMatches).toBe(true);
  expect(report.worker.authOriginMatches).toBe(true);
  expect(report.worker.gatewayIdMatches).toBe(true);
  expect(report.worker.secrets.find((item) => item.name === "CASE_DATA_KEY_V1")?.present).toBe(
    true,
  );
  expect(report.turnstile.publicSiteKey).toBe("public-production-sitekey");
  expect(report.turnstile.observedExclusiveWidgetCount).toBe(1);
  expect(JSON.stringify(report)).not.toContain(privateValue);
  expect(JSON.stringify(report)).not.toContain("unrelated-preview-sitekey");
});

test("sitekey selection rejects absent, shared, ambiguous, malformed and truncated widgets", async () => {
  const target = { domains: ["baro.site"], sitekey: "public-production-sitekey" };
  const widgetLists = [
    [],
    [{ ...target, domains: ["baro.site", "preview.baro.site"] }],
    [target, { ...target, sitekey: "another-public-sitekey" }],
    [target, { ...target, domains: ["baro.site", "another.site"] }],
    [{ ...target, sitekey: { secret: "private-value" } }],
    [{ ...target, domains: ["subdomain.baro.site"] }],
    [target, ...Array.from({ length: 99 }, () => ({ domains: ["another.site"] }))],
  ];
  for (const widgets of widgetLists) {
    const report = await inspectEnvironment("private-token", sha, "production", async (url) =>
      Response.json({
        success: true,
        result: url.includes("settings") ? { bindings: [] } : widgets,
      }),
    );
    expect(report.turnstile.publicSiteKey).toBeNull();
  }
});

test("production optional Gateway check selects only the production Gateway", async () => {
  const requests: string[] = [];
  const report = await inspectEnvironment(
    "private-token",
    sha,
    "production",
    async (url) => {
      requests.push(url);
      return Response.json({
        success: true,
        result: url.includes("settings")
          ? { bindings: [] }
          : url.includes("ai-gateway")
            ? [{ id: "baro-production", collect_logs: false, cache_ttl: 0, authentication: true }]
            : [],
      });
    },
    { checkGateway: true },
  );
  expect(requests[1]).toEndWith("/ai-gateway/gateways?search=baro-production&per_page=100");
  expect(report.gateway.exists).toBe(true);
  expect(report.gateway.authentication).toBe(true);
});
