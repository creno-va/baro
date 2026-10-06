import { z } from "zod";

const account = "9e844969d0c44b2449f3951d1f301654";
const secretNames = [
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "NAVER_CLIENT_ID",
  "NAVER_CLIENT_SECRET",
  "KAKAO_CLIENT_ID",
  "KAKAO_CLIENT_SECRET",
  "TURNSTILE_SECRET_KEY",
  "CASE_DATA_KEY_V1",
  "LAW_API_OC",
] as const;
const object = z.record(z.string(), z.unknown());
type Observation =
  | { status: "available"; result: unknown }
  | {
      status: "forbidden" | "unavailable";
      httpStatus: number | null;
    };

// Only GET requests and explicit projections: settings and widget responses can contain credentials.
export async function inspectPreview(
  token: string,
  candidateSha: string,
  fetcher: typeof fetch = fetch,
) {
  if (!token || !/^[a-f0-9]{40}$/.test(candidateSha)) throw new Error("Readiness inputs invalid");
  async function read(path: string): Promise<Observation> {
    try {
      const response = await fetcher(
        `https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok)
        return {
          status: response.status === 401 || response.status === 403 ? "forbidden" : "unavailable",
          httpStatus: response.status,
        };
      const body = z
        .object({ success: z.literal(true), result: z.unknown() })
        .safeParse(await response.json());
      return body.success
        ? { status: "available", result: body.data.result }
        : { status: "unavailable", httpStatus: response.status };
    } catch {
      return { status: "unavailable", httpStatus: null };
    }
  }
  const [settings, gateways, widgets] = await Promise.all([
    read("workers/scripts/baro-preview/settings"),
    read("ai-gateway/gateways?search=baro-preview&per_page=100"),
    read("challenges/widgets?per_page=100"),
  ]);
  const settingsResult = settings.status === "available" ? object.safeParse(settings.result) : null;
  const bindings = settingsResult?.success
    ? z.array(object).safeParse(settingsResult.data.bindings)
    : null;
  const configured = bindings?.success ? bindings.data : [];
  const text = (name: string) =>
    configured.find((b) => b.name === name && b.type === "plain_text")?.text;
  const secrets = secretNames.map((name) => ({
    name,
    present: bindings?.success
      ? configured.some((b) => b.name === name && b.type === "secret_text")
      : null,
  }));
  const gatewayList =
    gateways.status === "available" ? z.array(object).safeParse(gateways.result) : null;
  const gateway = gatewayList?.success
    ? gatewayList.data.find((g) => g.id === "baro-preview")
    : undefined;
  const widgetList =
    widgets.status === "available" ? z.array(object).safeParse(widgets.result) : null;
  const previewWidgets = widgetList?.success
    ? widgetList.data.filter(
        (w) => Array.isArray(w.domains) && w.domains.includes("preview.baro.site"),
      )
    : [];
  const status = (observation: Observation) =>
    observation.status === "available" ? { status: observation.status } : observation;
  const boolean = (value: unknown) => (typeof value === "boolean" ? value : null);
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const release = text("RELEASE_SHA");
  return {
    version: 1,
    checkedAt: new Date().toISOString(),
    environment: "preview",
    candidateSha,
    worker: {
      ...status(settings),
      parsed: bindings?.success === true,
      deployedSha: typeof release === "string" && /^[a-f0-9]{40}$/.test(release) ? release : null,
      authOriginMatches: bindings?.success
        ? text("BETTER_AUTH_URL") === "https://preview.baro.site"
        : null,
      gatewayIdMatches: bindings?.success ? text("AI_GATEWAY_ID") === "baro-preview" : null,
      aiBindingPresent: bindings?.success
        ? configured.some((b) => b.name === "AI" && b.type === "ai")
        : null,
      environmentMatches: bindings?.success ? text("APP_ENV") === "preview" : null,
      publicBetaClosed: bindings?.success ? text("PUBLIC_BETA_ENABLED") === "false" : null,
      modelBoundsConfigured: bindings?.success
        ? typeof text("AI_MODEL_TOKEN_BOUNDS_JSON") === "string" &&
          String(text("AI_MODEL_TOKEN_BOUNDS_JSON")).trim().length > 0
        : null,
      processingBindings: [
        { name: "CASE_PRIVATE_R2", type: "r2_bucket" },
        { name: "PROFILE_PUBLIC_R2", type: "r2_bucket" },
        { name: "FILE_PROCESSOR", type: "durable_object_namespace" },
        { name: "FILE_PROCESSING", type: "workflow" },
        { name: "WORKSPACE_PROCESSING", type: "workflow" },
      ].map(({ name, type }) => ({
        name,
        present: bindings?.success
          ? configured.some((b) => b.name === name && b.type === type)
          : null,
      })),
      secrets,
    },
    gateway: {
      ...status(gateways),
      parsed: gatewayList?.success === true,
      exists: gatewayList?.success ? !!gateway : null,
      collectLogs: boolean(gateway?.collect_logs),
      cacheTtl: number(gateway?.cache_ttl),
      authentication: boolean(gateway?.authentication),
    },
    turnstile: {
      ...status(widgets),
      parsed: widgetList?.success === true,
      observedPreviewWidgetCount: widgetList?.success ? previewWidgets.length : null,
      possiblyTruncated: widgetList?.success ? widgetList.data.length >= 100 : null,
      observedExclusivePreviewWidgetCount: widgetList?.success
        ? previewWidgets.filter((w) => Array.isArray(w.domains) && w.domains.length === 1).length
        : null,
    },
    // Configuration presence is never live OAuth/model/restore or human approval evidence.
    unverified: [
      "oauth-callbacks",
      "turnstile-action-smoke",
      "gateway-budget-credit-provider-retention",
      "durable-pricing-funding-allocation-billing",
      "r2-container-whisper-product-smoke",
      "live-model-eval",
      "crypto-recovery-custody",
      "backup-restore",
      "public-policy-approval",
    ],
  };
}

if (import.meta.main) {
  try {
    const report = await inspectPreview(
      process.env.CLOUDFLARE_API_TOKEN ?? "",
      process.env.READINESS_CANDIDATE_SHA ?? "",
    );
    await Bun.write(".wrangler/readiness/preview.json", `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify({
        worker: report.worker.status,
        gateway: report.gateway.status,
        turnstile: report.turnstile.status,
        missingSecrets: report.worker.parsed
          ? report.worker.secrets.filter((s) => s.present === false).map((s) => s.name)
          : null,
      }),
    );
  } catch {
    console.error("PREVIEW_READINESS_FAILED");
    process.exitCode = 1;
  }
}
