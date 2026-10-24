import { z } from "zod";
import { controlSchema, featureCaseSchema, probeReportFor } from "./ai-readiness-control";

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const script = "baro-synthetic-ai-readiness";
type Code =
  | "PLATFORM_UNAVAILABLE"
  | "STATUS_UNAVAILABLE"
  | "CONTROL_INVALID"
  | "PROVENANCE_MISMATCH"
  | "SECRET_CLEANUP_FAILED";
class InspectionError extends Error {
  constructor(readonly code: Code) {
    super(code);
  }
}
async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new InspectionError("STATUS_UNAVAILABLE");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 262144) {
        await reader.cancel();
        throw new InspectionError("CONTROL_INVALID");
      }
      parts.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new InspectionError("CONTROL_INVALID");
  }
}

/** Reads retained status only. It never deploys code, resets a DO or POSTs a model request.
 * The temporary probe credential is rotated and removed; application secrets are never addressed. */
export async function inspectSyntheticProbe(
  raw: { accountId: string; token: string; candidateSha: string; featureCase: string },
  options: {
    fetch?: typeof fetch;
    pause?: (milliseconds: number) => Promise<void>;
    newToken?: () => string;
    clock?: () => string;
  } = {},
) {
  const input = z
    .strictObject({
      accountId: z.string().regex(/^[a-f0-9]{32}$/),
      token: z.string().trim().min(1),
      candidateSha: sha,
      featureCase: featureCaseSchema,
    })
    .parse(raw);
  const network = options.fetch ?? fetch;
  const pause = options.pause ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const probeToken = (
    options.newToken ??
    (() =>
      Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""))
  )();
  if (!/^[a-f0-9]{64}$/.test(probeToken)) throw new InspectionError("CONTROL_INVALID");
  const base = `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/workers`;
  const secret = `${base}/scripts/${script}/secrets`;
  let rotationAttempted = false,
    credentialCleanup: boolean | null = null,
    failure: Code | null = null;
  type Snapshot = {
    started: boolean;
    reservedAttempts: number;
    reportPresent: boolean;
    reportValid: boolean | null;
    activeProbeSourceSha256: string;
    terminalFailure: z.infer<typeof controlSchema>["terminalFailure"];
    report: z.infer<ReturnType<typeof probeReportFor>> | null;
  };
  let snapshot: Snapshot | null = null;
  let unavailable: Code = "PLATFORM_UNAVAILABLE";
  const platform = async (url: string, method: "GET" | "PUT" | "DELETE", body?: unknown) => {
    const response = await network(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${input.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (method === "DELETE" && [204, 404].includes(response.status)) return null;
    const data = await boundedJson(response);
    if (
      !response.ok ||
      !data ||
      typeof data !== "object" ||
      !("success" in data) ||
      data.success !== true
    )
      throw new InspectionError("PLATFORM_UNAVAILABLE");
    return data;
  };
  try {
    const domain = z
      .object({
        result: z.object({ subdomain: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/) }),
      })
      .parse(await platform(`${base}/subdomain`, "GET"));
    rotationAttempted = true;
    await platform(secret, "PUT", {
      name: "READINESS_TOKEN",
      type: "secret_text",
      text: probeToken,
    });
    unavailable = "STATUS_UNAVAILABLE";
    let body: unknown;
    for (const delay of [0, 1000, 2000, 4000, 8000, 16000]) {
      if (delay) await pause(delay);
      const response = await network(
        `https://${script}.${domain.result.subdomain}.workers.dev/probe`,
        {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: { authorization: `Bearer ${probeToken}` },
        },
      );
      if (response.status === 403) {
        await response.body?.cancel();
        continue;
      }
      if (response.status !== 200) throw new InspectionError("STATUS_UNAVAILABLE");
      body = await boundedJson(response);
      break;
    }
    if (body === undefined) throw new InspectionError("STATUS_UNAVAILABLE");
    const parsed = controlSchema.safeParse(body);
    if (!parsed.success) throw new InspectionError("CONTROL_INVALID");
    const state = parsed.data;
    if (
      state.activeCandidateSha !== input.candidateSha ||
      state.activeFeatureCase !== input.featureCase ||
      !state.activeProbeSourceSha256
    )
      throw new InspectionError("PROVENANCE_MISMATCH");
    const report =
      state.storedReport === null
        ? null
        : probeReportFor({
            candidateSha: input.candidateSha,
            featureCase: input.featureCase,
            probeSourceSha256: state.activeProbeSourceSha256,
          }).safeParse(state.storedReport);
    snapshot = {
      started: state.started,
      reservedAttempts: state.attempts,
      reportPresent: state.storedReport !== null,
      reportValid: report === null ? null : report.success,
      activeProbeSourceSha256: state.activeProbeSourceSha256,
      terminalFailure: state.terminalFailure,
      report: report?.success ? report.data : null,
    };
  } catch (error) {
    failure = error instanceof InspectionError ? error.code : unavailable;
  } finally {
    if (rotationAttempted) {
      try {
        await platform(`${secret}/READINESS_TOKEN?url_encoded=true`, "DELETE");
        credentialCleanup = true;
      } catch {
        credentialCleanup = false;
        failure ??= "SECRET_CLEANUP_FAILED";
      }
    }
  }
  return {
    version: 1 as const,
    mode: "status_only" as const,
    checkedAt: (options.clock ?? (() => new Date().toISOString()))(),
    candidateSha: input.candidateSha,
    featureCase: input.featureCase,
    modelPostAttempts: 0 as const,
    credentialCleanup,
    status: failure ? ("failed" as const) : ("observed" as const),
    failure,
    snapshot,
  };
}

if (import.meta.main) {
  try {
    const result = await inspectSyntheticProbe({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
      token: process.env.CLOUDFLARE_API_TOKEN ?? "",
      candidateSha: process.env.INSPECT_CANDIDATE_SHA ?? "",
      featureCase: process.env.INSPECT_FEATURE_CASE ?? "",
    });
    await Bun.write(".wrangler/readiness/inspection.json", `${JSON.stringify(result, null, 2)}\n`);
    console.log(
      JSON.stringify({
        check: "retained-synthetic-probe",
        status: result.status,
        modelPostAttempts: 0,
        failure: result.failure,
        credentialCleanup: result.credentialCleanup,
      }),
    );
    if (result.failure) process.exitCode = 1;
  } catch {
    await Bun.write(
      ".wrangler/readiness/inspection.json",
      `${JSON.stringify({ version: 1, mode: "status_only", status: "failed", failure: "INPUT_INVALID", modelPostAttempts: 0, checkedAt: new Date().toISOString() })}\n`,
    );
    console.error(
      JSON.stringify({
        check: "retained-synthetic-probe",
        status: "failed",
        failure: "INPUT_INVALID",
        modelPostAttempts: 0,
      }),
    );
    process.exitCode = 1;
  }
}
