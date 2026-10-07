import { z } from "zod";
import journal from "../drizzle/meta/_journal.json";
import { usageDateKst } from "../src/server/db/repository";
import { createV2Core } from "../src/server/db/v2-core";
import { estimatePlanKrw } from "../src/server/db/v2-paid-contracts";
import {
  allocationProofSchema,
  createV2PaidRuntimeRepository,
} from "../src/server/db/v2-paid-runtime";
import { createPaidAvailability } from "../src/server/modules/budget/availability";
import { fundingProofSchema, pricingProofSchema } from "../src/server/modules/budget/contracts";
import { readProcessingProofs } from "../src/server/runtime/processing-proofs";
import { configuredBounds } from "../src/server/runtime/workspace";
import { remoteBudgetD1 } from "./remote-budget-d1";

type Environment = "preview" | "production";
type Scope = "text" | "all";
const targets = {
  preview: {
    worker: "baro-preview",
    origin: "https://preview.baro.site",
    database: "e8cdcf75-5bd8-469e-848e-f31816df4327",
  },
  production: {
    worker: "baro-production",
    origin: "https://baro.site",
    database: "d315e93f-2fac-4cc2-bf99-e9d6eb31523f",
  },
};
const accountId = "9e844969d0c44b2449f3951d1f301654";
const horizonMs = 5 * 60_000;
const warningMs = 7 * 86_400_000;
const groups = {
  model: ["model_input_tokens", "model_output_tokens"],
  processing: [
    "container_cpu_seconds",
    "container_memory_gib_seconds",
    "container_disk_gb_seconds",
    "r2_class_b_requests",
  ],
  asr: ["asr_seconds"],
  storage: [
    "r2_class_a_requests",
    "r2_class_b_requests",
    "r2_storage_gb_months",
    "worker_requests",
    "worker_cpu_ms",
    "d1_rows_read",
    "d1_rows_written",
  ],
} as const;
const bindings = {
  DB: "d1",
  AI: "ai",
  WORKSPACE_PROCESSING: "workflow",
  ANALYSIS_WORKFLOW: "workflow",
  CASE_PRIVATE_R2: "r2_bucket",
  PROFILE_PUBLIC_R2: "r2_bucket",
  FILE_PROCESSOR: "durable_object_namespace",
  FILE_PROCESSING: "workflow",
  ASSET_PROCESSING: "workflow",
  PROFILE_PUBLICATION: "workflow",
};
const secrets = ["CASE_DATA_KEY_V1", "BETTER_AUTH_SECRET", "LAW_API_OC", "TURNSTILE_SECRET_KEY"];
const record = z.record(z.string(), z.unknown());
const reservationSchema = z.object({
  phase: z.enum(["workspace_questions", "workspace_summary", "workspace_chat", "workspace_audit"]),
  inputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  outputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
/** A second boundary prevents future reused repository helpers from writing remotely. */
function readOnly(database: D1Database): D1Database {
  return {
    prepare(sql: string) {
      if (!/^\s*SELECT\b/i.test(sql) || sql.includes(";")) throw new Error("READ_ONLY_REQUIRED");
      return database.prepare(sql);
    },
    batch: async () => {
      throw new Error("READ_ONLY_REQUIRED");
    },
    exec: async () => {
      throw new Error("READ_ONLY_REQUIRED");
    },
  } as unknown as D1Database;
}
/** Metadata and SELECTs only. No provider calls, customer records, repairs or budget refreshes. */
export async function inspectAiPreflight(input: {
  token: string;
  environment: Environment;
  candidateSha: string;
  scope?: Scope;
  account?: string;
  now?: string;
  fetcher?: typeof fetch;
  database?: D1Database;
}) {
  const environment = z.enum(["preview", "production"]).parse(input.environment);
  const scope = z.enum(["text", "all"]).parse(input.scope ?? "all");
  const candidateSha = z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .parse(input.candidateSha);
  const now = new Date(z.iso.datetime().parse(input.now ?? new Date().toISOString())).toISOString();
  const account = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .parse(input.account ?? accountId);
  if (!input.token) throw new Error("PREFLIGHT_INPUT_INVALID");
  const target = targets[environment],
    fetcher = input.fetcher ?? fetch;
  const blockers: string[] = [],
    warnings: string[] = [];
  const unverified = [
    "live-provider-success",
    "oauth-callbacks",
    "secret-values",
    "gateway-credit-and-provider-retention",
    "legacy-analysis-runtime",
    "media-storage-vision-capability-metering",
  ];
  const checks: Record<string, boolean | string> = {};
  const check = (name: string, passed: boolean) => {
    checks[name] = passed;
    if (!passed) blockers.push(name);
  };
  const expiry = (name: string, cutoff: number) => {
    check(
      `${name}_five_minute_horizon`,
      Number.isFinite(cutoff) && cutoff > Date.parse(now) + horizonMs,
    );
    if (Number.isFinite(cutoff) && cutoff <= Date.parse(now) + warningMs)
      warnings.push(`${name}_expires_within_seven_days`);
  };
  let configured: Record<string, unknown>[] = [];
  try {
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${target.worker}/settings`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${input.token}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error("METADATA_UNAVAILABLE");
    configured = z
      .object({ success: z.literal(true), result: z.object({ bindings: z.array(record) }) })
      .parse(await response.json()).result.bindings;
    check("worker_metadata_available", true);
  } catch {
    check("worker_metadata_available", false);
  }
  const binding = (name: string, type: string) =>
    configured.find((value) => value.name === name && value.type === type);
  const text = (name: string) => binding(name, "plain_text")?.text;
  for (const [name, type] of Object.entries(bindings)) {
    if (scope === "text" && !["DB", "AI", "WORKSPACE_PROCESSING"].includes(name)) continue;
    check(`binding_${name}`, !!binding(name, type));
  }
  for (const name of secrets) check(`secret_${name}`, !!binding(name, "secret_text"));
  check("environment_matches", text("APP_ENV") === environment);
  check("gateway_matches", text("AI_GATEWAY_ID") === target.worker);
  check("auth_origin_matches", text("BETTER_AUTH_URL") === target.origin);
  check("release_matches", text("RELEASE_SHA") === candidateSha);
  check("database_matches", binding("DB", "d1")?.id === target.database);
  check(
    "budget_cap_setting_valid",
    ["true", "false"].includes(String(text("MONTHLY_BUDGET_CAP_ENABLED"))),
  );
  if (binding("AI_MODEL_TOKEN_BOUNDS_JSON", "secret_text")) {
    checks.model_bounds = "secret_present";
  } else {
    const bounds = configuredBounds({
      AI_MODEL_TOKEN_BOUNDS_JSON: text("AI_MODEL_TOKEN_BOUNDS_JSON"),
    } as Env);
    check(
      "model_bounds_valid",
      !!bounds &&
        Date.parse(bounds.verifiedAt) <= Date.parse(now) &&
        Date.parse(bounds.bounds.checkedAt) <= Date.parse(now),
    );
    if (bounds) expiry("model_bounds", Date.parse(bounds.bounds.validUntil));
  }
  let reservations: z.infer<typeof reservationSchema>[] | null = null;
  try {
    const response = await fetcher(`${target.origin}/api/health/ai-configuration`, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: { "cache-control": "no-cache" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200) throw new Error("CONFIGURATION_UNAVAILABLE");
    const receipt = z
      .object({
        status: z.literal("ready"),
        environment: z.literal(environment),
        release: z.literal(candidateSha),
        reservations: z.array(reservationSchema).length(4),
      })
      .parse(await response.json());
    if (new Set(receipt.reservations.map((r) => r.phase)).size !== 4)
      throw new Error("CONFIGURATION_INVALID");
    reservations = receipt.reservations;
  } catch {
    unverified.push("per-invocation-reservation-headroom");
  }
  check("runtime_configuration_attested", reservations !== null);
  const month = usageDateKst(now).slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonthAt = Date.UTC(year as number, monthNumber as number, 1) - 9 * 3_600_000;
  if (nextMonthAt <= Date.parse(now) + warningMs)
    warnings.push("kst_month_rollover_requires_verified_allocation");
  const budgetGroups: Record<string, { available: boolean; missingSkus: string[] }> = {};
  try {
    const database = readOnly(
      input.database ?? remoteBudgetD1(input.token, account, target.database, fetcher),
    );
    const core = createV2Core(
      database,
      {
        encrypt: async () => {
          throw new Error("PRIVATE_DATA_FORBIDDEN");
        },
        decrypt: async () => {
          throw new Error("PRIVATE_DATA_FORBIDDEN");
        },
      },
      { monthlyBudgetCapEnabled: text("MONTHLY_BUDGET_CAP_ENABLED") !== "false" },
    );
    const baseline = await core
      .statement("SELECT value FROM app_metadata WHERE key='schema_version'")
      .first<string>("value");
    check("schema_matches", baseline === journal.entries.at(-1)?.tag);
    const runtime = createV2PaidRuntimeRepository(core, environment);
    const exposure = await runtime.exposure(now);
    check("current_month_active", exposure?.month === month && exposure.phase === "active");
    for (const [name, skus] of Object.entries(groups)) {
      if (scope === "text" && name !== "model") continue;
      const ids = await readProcessingProofs(core, environment, now, skus[0]);
      const available = await createPaidAvailability(core, environment, {
        proofs: async () => ids,
        clock: () => now,
      })();
      const p = ids ? await runtime.findProof(ids.pricingProofId, now) : null;
      const f = ids ? await runtime.findProof(ids.fundingProofId, now) : null;
      const a = ids ? await runtime.findProof(ids.allocationProofId, now) : null;
      const pricing = pricingProofSchema.safeParse(p?.payload);
      const funding = fundingProofSchema.safeParse(f?.payload);
      const allocation = allocationProofSchema.safeParse(a?.payload);
      const prices = pricing.success ? pricing.data.prices : [];
      const missingSkus = skus.filter(
        (sku) => !prices.some((price) => price.sku === sku && price.billingMode === "metered"),
      );
      budgetGroups[name] = { available, missingSkus };
      check(`${name}_paid_available`, available);
      check(`${name}_skus_complete`, missingSkus.length === 0);
      if (name === "model" && reservations && pricing.success && funding.success && exposure) {
        const reserve = Math.max(
          ...reservations.map((r) =>
            estimatePlanKrw(pricing.data, [
              { sku: "model_input_tokens", maximumQuantity: String(r.inputTokens) },
              { sku: "model_output_tokens", maximumQuantity: String(r.outputTokens) },
            ]),
          ),
        );
        const total =
          exposure.settled_krw +
          exposure.reserved_krw +
          exposure.ambiguous_krw +
          exposure.fixed_maintenance_krw +
          exposure.carryover_krw +
          reserve;
        check(
          "model_reservation_headroom",
          Number.isSafeInteger(total) &&
            total <= funding.data.spendAllowanceKrw &&
            (!core.monthlyBudgetCapEnabled || total <= exposure.limit_krw),
        );
      }
      if (pricing.success && funding.success && allocation.success && p && f && a) {
        expiry(
          name,
          Math.min(
            ...[
              p.validUntil,
              f.validUntil,
              a.validUntil,
              pricing.data.validUntil,
              pricing.data.fx.validUntil,
              funding.data.validUntil,
              allocation.data.allocation.fundingValidUntil,
              ...prices.map((price) => price.validUntil),
            ].map(Date.parse),
          ),
        );
      }
    }
    if (nextMonthAt <= Date.parse(now) + horizonMs) {
      const nextNow = new Date(nextMonthAt).toISOString();
      const next = await createPaidAvailability(core, environment, {
        proofs: () => readProcessingProofs(core, environment, nextNow, "model_input_tokens"),
        clock: () => nextNow,
      })();
      check("next_month_active_before_horizon", next);
    }
    check("database_read_available", true);
  } catch {
    check("database_read_available", false);
  }
  if (scope === "all") {
    // These product paths currently omit the required ledgers/capability attestations.
    // Installing price rows alone cannot make their execution ready.
    check("legacy_analysis_attempt_ledger_wired", false);
    check("media_storage_vision_metering_wired", false);
  }
  return {
    version: 1,
    checkedAt: now,
    environment,
    scope,
    candidateSha,
    month,
    status: blockers.length ? ("blocked" as const) : ("configuration_ready" as const),
    checks,
    budgetGroups,
    blockers,
    warnings,
    unverified,
  };
}
if (import.meta.main) {
  try {
    const report = await inspectAiPreflight({
      token: process.env.CLOUDFLARE_API_TOKEN ?? "",
      ...(process.env.CLOUDFLARE_ACCOUNT_ID ? { account: process.env.CLOUDFLARE_ACCOUNT_ID } : {}),
      environment: process.argv[2] as Environment,
      candidateSha: process.argv[3] ?? "",
      scope: (process.argv[4] ?? "all") as Scope,
    });
    await Bun.write(
      `.wrangler/readiness/ai-${report.environment}.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(JSON.stringify(report));
    if (report.status === "blocked") process.exitCode = 1;
  } catch {
    console.error("AI_PREFLIGHT_UNAVAILABLE");
    process.exitCode = 1;
  }
}
