export type DeploymentEnvironment = "preview" | "production";

export const oauthSecretNames = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "NAVER_CLIENT_ID",
  "NAVER_CLIENT_SECRET",
  "KAKAO_CLIENT_ID",
  "KAKAO_CLIENT_SECRET",
] as const;

// Official dummy sitekeys must stay in isolated tests, including on preview.
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
const testSitekeys = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
  "3x00000000000000000000FF",
]);
type Configuration = Record<string, unknown>;

function fail(code: string): never {
  throw new Error(`DEPLOYMENT_${code}`);
}
function object(value: unknown): Configuration {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("CONFIG_INVALID");
  return value as Configuration;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function selected(config: unknown, environment: DeploymentEnvironment): Configuration {
  return object(object(object(config).env)[environment]);
}
function assertIdentity(config: Configuration, environment: DeploymentEnvironment) {
  const vars = object(config.vars);
  const hostname = environment === "preview" ? "preview.baro.site" : "baro.site";
  const routes = config.routes;
  if (
    config.name !== `baro-${environment}` ||
    vars.APP_ENV !== environment ||
    vars.BETTER_AUTH_URL !== `https://${hostname}` ||
    vars.AI_GATEWAY_ID !== `baro-${environment}` ||
    !Array.isArray(routes) ||
    routes.length !== 1 ||
    object(routes[0]).pattern !== hostname ||
    object(routes[0]).custom_domain !== true
  )
    fail("ENVIRONMENT_IDENTITY_MISMATCH");
}

// Only these resource identities may differ; binding names, classes, flags,
// limits and feature switches must be identical. Never normalize arbitrary text.
const isolatedIdentity =
  /^(?:name|vars\.(?:APP_ENV|BETTER_AUTH_URL|AI_GATEWAY_ID)|routes\[\d+\]\.pattern|kv_namespaces\[\d+\]\.id|d1_databases\[\d+\]\.(?:database_id|database_name)|workflows\[\d+\]\.name|r2_buckets\[\d+\]\.bucket_name|containers\[\d+\]\.name)$/;
function normalized(config: Configuration) {
  const identities = new Map<string, string>();
  function visit(value: unknown, path: string): unknown {
    if (isolatedIdentity.test(path)) {
      if (typeof value !== "string" || !value.trim()) fail("RESOURCE_IDENTITY_INVALID");
      identities.set(path, value);
      return "<environment-specific>";
    }
    if (Array.isArray(value)) return value.map((item, index) => visit(item, `${path}[${index}]`));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          visit(item, path ? `${path}.${key}` : key),
        ]),
      );
    return value;
  }
  return { configuration: visit(config, ""), identities };
}

export function checkDeploymentConfig(config: unknown): void {
  const preview = selected(config, "preview");
  const production = selected(config, "production");
  assertIdentity(preview, "preview");
  assertIdentity(production, "production");
  const left = normalized(preview),
    right = normalized(production);
  if (canonical(left.configuration) !== canonical(right.configuration))
    fail("CONFIG_PARITY_MISMATCH");
  for (const [path, identity] of left.identities)
    if (identity === right.identities.get(path)) fail("RESOURCE_NOT_ISOLATED");
}

export function checkDeploymentInputs(inputs: Record<string, string | undefined>): void {
  if (inputs.PUBLIC_API_MODE !== "real") fail("REAL_API_MODE_REQUIRED");
  const sitekey = inputs.PUBLIC_TURNSTILE_SITE_KEY?.trim();
  if (!sitekey) fail("INPUT_MISSING_PUBLIC_TURNSTILE_SITE_KEY");
  if (testSitekeys.has(sitekey)) fail("TURNSTILE_TEST_KEY_FORBIDDEN");
  for (const name of oauthSecretNames) if (!inputs[name]?.trim()) fail(`INPUT_MISSING_${name}`);
}

function withoutPaths(value: unknown, ignored: readonly string[]) {
  if (!Array.isArray(value)) fail("CONFIG_INVALID");
  return value.map((entry) =>
    Object.fromEntries(Object.entries(object(entry)).filter(([key]) => !ignored.includes(key))),
  );
}
function runtimeSignature(config: Configuration) {
  return {
    name: config.name,
    vars: config.vars,
    compatibility_date: config.compatibility_date,
    compatibility_flags: config.compatibility_flags,
    routes: config.routes,
    ai: config.ai,
    assets: { binding: object(config.assets).binding },
    kv_namespaces: config.kv_namespaces,
    d1_databases: withoutPaths(config.d1_databases, ["migrations_dir"]),
    workflows: config.workflows,
    r2_buckets: config.r2_buckets,
    durable_objects: config.durable_objects,
    containers: withoutPaths(config.containers, ["image", "image_build_context"]),
    exports: config.exports,
    ratelimits: config.ratelimits,
    triggers: config.triggers,
    observability: config.observability,
  };
}

/** Astro rewrites entry/assets/migration/container paths and adds defaults.
 * Compare runtime bindings and settings, not its generated build metadata.
 */
export function checkBuiltDeployment(
  config: unknown,
  built: unknown,
  environment: DeploymentEnvironment,
): void {
  checkDeploymentConfig(config);
  const output = object(built);
  assertIdentity(output, environment);
  if (output.targetEnvironment !== environment) fail("ENVIRONMENT_IDENTITY_MISMATCH");
  const expected = { ...object(config), ...selected(config, environment) };
  if (canonical(runtimeSignature(output)) !== canonical(runtimeSignature(expected)))
    fail("BUILT_RUNTIME_MISMATCH");
}

if (import.meta.main) {
  try {
    const [environment, phase, ...extra] = process.argv.slice(2);
    if (
      (environment !== "preview" && environment !== "production") ||
      (phase !== undefined && phase !== "--built") ||
      extra.length > 0
    )
      fail("ARGUMENTS_INVALID");
    const config: unknown = await Bun.file("wrangler.jsonc").json();
    checkDeploymentConfig(config);
    if (phase === "--built")
      checkBuiltDeployment(config, await Bun.file("dist/server/wrangler.json").json(), environment);
    else checkDeploymentInputs(process.env);
    console.log(
      `Deployment ${phase === "--built" ? "artifact" : "preflight"} verified: ${environment}`,
    );
  } catch (error) {
    // Configuration/secrets are never printed, including parser diagnostics.
    console.error(
      error instanceof Error && /^DEPLOYMENT_[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "DEPLOYMENT_CHECK_FAILED",
    );
    process.exitCode = 1;
  }
}
