import { z } from "zod";
import journal from "../drizzle/meta/_journal.json";
import { endpointSmoke } from "./endpoint-smoke";
import { foundationSmoke } from "./foundation-smoke";

const account = "9e844969d0c44b2449f3951d1f301654";
const worker = "workers/scripts/baro-production";
const recoveryNames = ["CASE_DATA_KEY_V1", "LAW_API_OC", "TURNSTILE_SECRET_KEY"] as const;
type RecoveryName = (typeof recoveryNames)[number];
type RecoveryFetch = (input: string, init: RequestInit) => Promise<Response>;
const bindingsSchema = z.array(
  z.object({ name: z.string(), type: z.string(), text: z.string().optional() }),
);
const widgetSchema = z.object({
  sitekey: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  domains: z.array(z.string()),
  mode: z.literal("managed"),
  clearance_level: z.literal("no_clearance"),
});
class RecoveryError extends Error {
  constructor(code: string) {
    super(`PRODUCTION_RECOVERY_${code}`);
  }
}
function caseKeyValid(value: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const bytes = Uint8Array.fromBase64(value, { alphabet: "base64url" });
  return (
    bytes.length === 32 && bytes.toBase64({ alphabet: "base64url", omitPadding: true }) === value
  );
}

/** Protected production job only. Existing bindings are never intentionally replaced.
 * The provider's PUT is not compare-and-set: exclude external writers during recovery.
 * Never retry mutations automatically, rotate keys, or emit provider payloads/errors.
 */
export async function recoverProductionRuntime(
  input: { token: string; expectedLiveSha: string; caseKey: string; lawApiOc: string },
  fetcher: RecoveryFetch = fetch,
) {
  if (!input.token.trim() || !/^[a-f0-9]{40}$/.test(input.expectedLiveSha))
    throw new RecoveryError("INPUT_INVALID");
  async function request(path: string, method = "GET", body?: unknown): Promise<unknown> {
    try {
      const response = await fetcher(
        `https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,
        {
          method,
          headers: { authorization: `Bearer ${input.token}`, "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) throw new Error();
      const parsed = z
        .object({ success: z.literal(true), result: z.unknown() })
        .safeParse(await response.json());
      if (!parsed.success) throw new Error();
      return parsed.data.result;
    } catch {
      // A timed-out write may have succeeded. Rerun from fresh metadata; no blind retry/rollback.
      throw new RecoveryError(method === "GET" ? "READ_FAILED" : "WRITE_UNCONFIRMED");
    }
  }
  async function settings() {
    const parsed = z
      .object({ bindings: bindingsSchema })
      .safeParse(await request(`${worker}/settings`));
    if (!parsed.success) throw new RecoveryError("SETTINGS_INVALID");
    const bindings = parsed.data.bindings;
    const one = (name: string) => {
      const matches = bindings.filter((b) => b.name === name);
      if (matches.length > 1) throw new RecoveryError("BINDING_CONFLICT");
      return matches[0];
    };
    for (const [name, value] of Object.entries({
      APP_ENV: "production",
      BETTER_AUTH_URL: "https://baro.site",
      RELEASE_SHA: input.expectedLiveSha,
      PUBLIC_BETA_ENABLED: "true",
    })) {
      const binding = one(name);
      if (binding?.type !== "plain_text" || binding.text !== value)
        throw new RecoveryError("LIVE_STATE_CHANGED");
    }
    if (one("BETTER_AUTH_SECRET")?.type !== "secret_text") throw new RecoveryError("AUTH_MISSING");
    for (const name of recoveryNames) {
      const binding = one(name);
      if (binding && binding.type !== "secret_text") throw new RecoveryError("BINDING_CONFLICT");
    }
    return new Set(bindings.filter((b) => b.type === "secret_text").map((b) => b.name));
  }
  const initial = await settings();
  if (!initial.has("CASE_DATA_KEY_V1") && !caseKeyValid(input.caseKey))
    throw new RecoveryError("CASE_KEY_INVALID");
  if (!initial.has("LAW_API_OC") && !/^[A-Za-z0-9_.@-]{1,128}$/.test(input.lawApiOc))
    throw new RecoveryError("LAW_CREDENTIAL_MISSING");
  // Parse unrelated widgets minimally: their configuration is not ours to validate/change.
  const list = z
    .array(z.object({ sitekey: z.string(), domains: z.array(z.string()) }).passthrough())
    .safeParse(await request("challenges/widgets?per_page=100"));
  if (!list.success || list.data.length >= 100) throw new RecoveryError("WIDGET_LIST_INVALID");
  const matches = list.data.filter((w) => w.domains.includes("baro.site"));
  if (matches.length > 1 || (matches[0] && matches[0].domains.length !== 1))
    throw new RecoveryError("WIDGET_AMBIGUOUS");
  if (!matches.length && initial.has("TURNSTILE_SECRET_KEY"))
    throw new RecoveryError("WIDGET_SECRET_MISMATCH");
  let widget: unknown;
  const widgetStatus = matches.length ? "existing" : "created";
  if (matches[0]) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(matches[0].sitekey))
      throw new RecoveryError("WIDGET_INVALID");
    widget = initial.has("TURNSTILE_SECRET_KEY")
      ? matches[0]
      : await request(`challenges/widgets/${matches[0].sitekey}`);
  } else {
    if ((await settings()).has("TURNSTILE_SECRET_KEY"))
      throw new RecoveryError("WIDGET_SECRET_MISMATCH");
    widget = await request("challenges/widgets", "POST", {
      name: "baro-production",
      domains: ["baro.site"],
      mode: "managed",
      clearance_level: "no_clearance",
    });
  }
  const parsedWidget = widgetSchema.safeParse(widget);
  if (
    !parsedWidget.success ||
    (matches[0] && parsedWidget.data.sitekey !== matches[0].sitekey) ||
    parsedWidget.data.domains.length !== 1 ||
    parsedWidget.data.domains[0] !== "baro.site"
  )
    throw new RecoveryError("WIDGET_INVALID");
  const secret = z.object({ secret: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/) }).safeParse(widget);
  if (!initial.has("TURNSTILE_SECRET_KEY") && !secret.success)
    throw new RecoveryError("WIDGET_SECRET_MISSING");
  const values: Record<RecoveryName, string> = {
    CASE_DATA_KEY_V1: input.caseKey,
    LAW_API_OC: input.lawApiOc,
    TURNSTILE_SECRET_KEY: secret.success ? secret.data.secret : "",
  };
  const secrets: { name: RecoveryName; status: "applied" | "already-present" }[] = [];
  for (const name of recoveryNames) {
    if ((await settings()).has(name)) {
      secrets.push({ name, status: "already-present" });
      continue;
    }
    // Values were validated against initial state; a removed existing binding is a conflict.
    if (initial.has(name)) throw new RecoveryError("LIVE_STATE_CHANGED");
    const result = z.object({ name: z.literal(name), type: z.literal("secret_text") }).safeParse(
      await request(`${worker}/secrets`, "PUT", {
        name,
        type: "secret_text",
        text: values[name],
      }),
    );
    if (!result.success) throw new RecoveryError("WRITE_UNCONFIRMED");
    secrets.push({ name, status: "applied" });
  }
  const after = await settings();
  if (recoveryNames.some((name) => !after.has(name))) throw new RecoveryError("VERIFY_FAILED");
  return {
    environment: "production" as const,
    liveSha: input.expectedLiveSha,
    publicSiteKey: parsedWidget.data.sitekey,
    widget: widgetStatus,
    secrets,
  };
}

if (import.meta.main) {
  try {
    const expectedLiveSha = process.env.RECOVERY_EXPECTED_LIVE_SHA ?? "";
    const schema = journal.entries.at(-1)?.tag;
    if (!schema || !/^[a-f0-9]{40}$/.test(expectedLiveSha))
      throw new RecoveryError("INPUT_INVALID");
    if (!(await foundationSmoke("https://baro.site", expectedLiveSha, schema)).passed)
      throw new RecoveryError("HEALTH_PREFLIGHT_FAILED");
    const report = await recoverProductionRuntime({
      token: process.env.CLOUDFLARE_API_TOKEN ?? "",
      expectedLiveSha,
      caseKey: process.env.CASE_DATA_KEY_V1 ?? "",
      lawApiOc: process.env.LAW_API_OC ?? "",
    });
    await Bun.write(
      ".wrangler/readiness/production-recovery.json",
      `${JSON.stringify(report, null, 2)}\n`,
    );
    const health = await foundationSmoke("https://baro.site", report.liveSha, schema);
    const endpoints = await endpointSmoke("https://baro.site", "open");
    console.log(JSON.stringify({ ...report, health, endpoints }));
    if (!health.passed || !endpoints.passed) throw new RecoveryError("ENDPOINT_VERIFY_FAILED");
  } catch (error) {
    console.error(error instanceof RecoveryError ? error.message : "PRODUCTION_RECOVERY_FAILED");
    process.exitCode = 1;
  }
}
