import { Hono } from "hono";
import { inspectAiConfiguration } from "../runtime/ai-configuration";

export const healthApi = new Hono<{ Bindings: Env }>()
  .get("/live", (context) => {
    return context.json({
      status: "ok" as const,
      service: "baro",
      environment: context.env?.APP_ENV ?? "test",
      release: context.env?.RELEASE_SHA ?? "local",
    });
  })
  .get("/ai-configuration", async (context) => {
    context.header("cache-control", "no-store");
    const configuration = await inspectAiConfiguration(context.env);
    return context.json(configuration, configuration.status === "ready" ? 200 : 503);
  })
  .get("/ready", async (context) => {
    try {
      const metadata = await context.env.DB.prepare(
        "SELECT value FROM app_metadata WHERE key = ? LIMIT 1",
      )
        .bind("schema_version")
        .first<{ value: string }>();

      if (!metadata) {
        return context.json(
          {
            status: "not_ready" as const,
            service: "baro",
            dependency: "d1",
            code: "SCHEMA_METADATA_MISSING",
          },
          503,
        );
      }

      return context.json({
        status: "ready" as const,
        service: "baro",
        environment: context.env.APP_ENV,
        schemaVersion: metadata.value,
        release: context.env.RELEASE_SHA,
      });
    } catch {
      return context.json(
        {
          status: "not_ready" as const,
          service: "baro",
          dependency: "d1",
          code: "D1_UNAVAILABLE",
        },
        503,
      );
    }
  });
