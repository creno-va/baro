import { z } from "zod";
import type { DeploymentEnvironment } from "./check-deployment";

// OAuth is validated from the Environment and synchronized by deployment.
// These existing runtime secrets must not be missing when that deployment starts.
export const requiredRuntimeSecrets = [
  "BETTER_AUTH_SECRET",
  "CASE_DATA_KEY_V1",
  "TURNSTILE_SECRET_KEY",
  "LAW_API_OC",
] as const;
type RequiredSecret = (typeof requiredRuntimeSecrets)[number];
class RuntimeSecretsError extends Error {
  constructor(
    code: "INPUT_INVALID" | "READ_FAILED" | "INVALID_RESPONSE" | "MISSING",
    missing: readonly RequiredSecret[] = [],
  ) {
    super(`RUNTIME_SECRETS_${code}${missing.length ? `: ${missing.join(", ")}` : ""}`);
  }
}
const secretList = z.object({
  success: z.literal(true),
  result: z.array(z.object({ name: z.string(), type: z.string() })),
});

/** Read the names-only list, never individual secret values or Worker settings. */
export async function checkRuntimeSecrets(
  environment: DeploymentEnvironment,
  accountId: string,
  token: string,
  fetcher: (input: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<void> {
  if (
    (environment !== "preview" && environment !== "production") ||
    !/^[a-f0-9]{32}$/.test(accountId) ||
    !token.trim()
  )
    throw new RuntimeSecretsError("INPUT_INVALID");
  let response: Response;
  try {
    response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/baro-${environment}/secrets`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new RuntimeSecretsError("READ_FAILED");
  }
  if (!response.ok) throw new RuntimeSecretsError("READ_FAILED");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RuntimeSecretsError("INVALID_RESPONSE");
  }
  const parsed = secretList.safeParse(body);
  if (!parsed.success) throw new RuntimeSecretsError("INVALID_RESPONSE");
  const names = new Set(
    parsed.data.result
      .filter((secret) => secret.type === "secret_text")
      .map((secret) => secret.name),
  );
  const missing = requiredRuntimeSecrets.filter((name) => !names.has(name));
  if (missing.length) throw new RuntimeSecretsError("MISSING", missing);
}

if (import.meta.main) {
  try {
    const [environment, ...extra] = process.argv.slice(2);
    if ((environment !== "preview" && environment !== "production") || extra.length)
      throw new RuntimeSecretsError("INPUT_INVALID");
    await checkRuntimeSecrets(
      environment,
      process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
      process.env.CLOUDFLARE_API_TOKEN ?? "",
    );
    console.log(`Required runtime secret names verified: ${environment}`);
  } catch (error) {
    console.error(
      error instanceof RuntimeSecretsError ? error.message : "RUNTIME_SECRETS_CHECK_FAILED",
    );
    process.exitCode = 1;
  }
}
