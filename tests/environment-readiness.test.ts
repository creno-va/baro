import { expect, test } from "bun:test";
import { inspectPreview } from "../scripts/environment-readiness";

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
  const report = await inspectPreview(secret, sha, fetcher);
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
  const report = await inspectPreview("private-token", sha, (async (input) => {
    if (String(input).includes("settings"))
      return Response.json({ success: true, result: { bindings: "bad" } });
    if (String(input).includes("ai-gateway"))
      return new Response("private-error-body", { status: 403 });
    throw new Error("private-error-stack");
  }) as typeof fetch);
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
