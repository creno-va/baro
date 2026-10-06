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
const environmentSchema = z.enum(["preview", "production"]);
type ReadinessEnvironment = z.infer<typeof environmentSchema>;
type ReadinessFetch = (input: string, init: RequestInit) => Promise<Response>;
type Observation =
  | { status: "available"; result: unknown }
  | {
      status: "forbidden" | "unavailable" | "not_requested";
      httpStatus: number | null;
    };

// Only GET requests and explicit projections: settings and widget responses can contain credentials.
export async function inspectEnvironment(
  token: string,
  candidateSha: string,
  environment: ReadinessEnvironment = "preview",
  fetcher: ReadinessFetch = fetch,
  options: { checkGateway?: boolean } = {},
) {
  if (!token || !/^[a-f0-9]{40}$/.test(candidateSha)) throw new Error("Readiness inputs invalid");
  environmentSchema.parse(environment);
  const workerName = `baro-${environment}`;
  const hostname = environment === "preview" ? "preview.baro.site" : "baro.site";
  async function read(path: string): Promise<Observation> {
    try {
      const response = await fetcher(
        `https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          redirect: "error",
          cache: "no-store",
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
    read(`workers/scripts/${workerName}/settings`),
    options.checkGateway === true
      ? read(`ai-gateway/gateways?search=${workerName}&per_page=100`)
      : Promise.resolve<Observation>({ status: "not_requested", httpStatus: null }),
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
    ? gatewayList.data.find((g) => g.id === workerName)
    : undefined;
  const widgetList =
    widgets.status === "available" ? z.array(object).safeParse(widgets.result) : null;
  const targetWidgets = widgetList?.success
    ? widgetList.data.filter((w) => Array.isArray(w.domains) && w.domains.includes(hostname))
    : [];
  const exclusiveWidgets = targetWidgets.filter(
    (w) => Array.isArray(w.domains) && w.domains.length === 1,
  );
  const possiblyTruncated = widgetList?.success ? widgetList.data.length >= 100 : null;
  // A sitekey is public client configuration. Never expose the widget secret,
  // unrelated keys, or select among ambiguous/shared/truncated hostname matches.
  const publicSiteKey =
    possiblyTruncated === false && targetWidgets.length === 1 && exclusiveWidgets.length === 1
      ? z
          .string()
          .min(1)
          .max(100)
          .regex(/^[A-Za-z0-9_-]+$/)
          .safeParse(exclusiveWidgets[0]?.sitekey)
      : null;
  const status = (observation: Observation) =>
    observation.status === "available" ? { status: observation.status } : observation;
  const boolean = (value: unknown) => (typeof value === "boolean" ? value : null);
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const release = text("RELEASE_SHA");
  return {
    version: 1,
    checkedAt: new Date().toISOString(),
    environment,
    candidateSha,
    worker: {
      ...status(settings),
      parsed: bindings?.success === true,
      deployedSha: typeof release === "string" && /^[a-f0-9]{40}$/.test(release) ? release : null,
      authOriginMatches: bindings?.success
        ? text("BETTER_AUTH_URL") === `https://${hostname}`
        : null,
      gatewayIdMatches: bindings?.success ? text("AI_GATEWAY_ID") === workerName : null,
      aiBindingPresent: bindings?.success
        ? configured.some((b) => b.name === "AI" && b.type === "ai")
        : null,
      environmentMatches: bindings?.success ? text("APP_ENV") === environment : null,
      publicBetaClosed: bindings?.success ? text("PUBLIC_BETA_ENABLED") === "false" : null,
      modelBoundsConfigured: bindings?.success
        ? (typeof text("AI_MODEL_TOKEN_BOUNDS_JSON") === "string" &&
            String(text("AI_MODEL_TOKEN_BOUNDS_JSON")).trim().length > 0) ||
          configured.some(
            (b) => b.name === "AI_MODEL_TOKEN_BOUNDS_JSON" && b.type === "secret_text",
          )
        : null,
      processingBindings: [
        { name: "CASE_PRIVATE_R2", type: "r2_bucket" },
        { name: "PROFILE_PUBLIC_R2", type: "r2_bucket" },
        { name: "FILE_PROCESSOR", type: "durable_object_namespace" },
        { name: "FILE_PROCESSING", type: "workflow" },
        { name: "WORKSPACE_PROCESSING", type: "workflow" },
        { name: "ASSET_PROCESSING", type: "workflow" },
        { name: "PROFILE_PUBLICATION", type: "workflow" },
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
      observedWidgetCount: widgetList?.success ? targetWidgets.length : null,
      possiblyTruncated,
      observedExclusiveWidgetCount: widgetList?.success ? exclusiveWidgets.length : null,
      publicSiteKey: publicSiteKey?.success ? publicSiteKey.data : null,
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

/** Preserve the existing preview report shape for historical callers. */
export async function inspectPreview(
  token: string,
  candidateSha: string,
  fetcher: ReadinessFetch = fetch,
  options: { checkGateway?: boolean } = {},
) {
  const report = await inspectEnvironment(token, candidateSha, "preview", fetcher, options);
  const {
    observedWidgetCount,
    observedExclusiveWidgetCount,
    publicSiteKey: _sitekey,
    ...turnstile
  } = report.turnstile;
  return {
    ...report,
    environment: "preview" as const,
    turnstile: {
      ...turnstile,
      observedPreviewWidgetCount: observedWidgetCount,
      observedExclusivePreviewWidgetCount: observedExclusiveWidgetCount,
    },
  };
}

if (import.meta.main) {
  try {
    const environment = environmentSchema.parse(
      process.env.READINESS_TARGET_ENVIRONMENT ?? "preview",
    );
    const report = await inspectEnvironment(
      process.env.CLOUDFLARE_API_TOKEN ?? "",
      process.env.READINESS_CANDIDATE_SHA ?? "",
      environment,
      fetch,
      { checkGateway: process.env.READINESS_CHECK_GATEWAY === "true" },
    );
    await Bun.write(
      `.wrangler/readiness/${environment}.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      JSON.stringify({
        environment,
        worker: report.worker.status,
        gateway: report.gateway.status,
        turnstile: report.turnstile.status,
        missingSecrets: report.worker.parsed
          ? report.worker.secrets.filter((s) => s.present === false).map((s) => s.name)
          : null,
      }),
    );
  } catch {
    console.error("ENVIRONMENT_READINESS_FAILED");
    process.exitCode = 1;
  }
}
