import { runtimeDigest } from "../src/server/db/v2-paid-runtime";
import { modelBounds, modelCapabilitySchema } from "./provision-ai-budget";

/** Read only model capability fields from the historical observation. Never
 * renew its dates, inspect credit, mutate accounting, or require cost refresh.
 * Deployed observation-only runtime retains technical token/vision boundaries.
 */
export async function modelCapabilityConfiguration(raw: unknown, now = new Date().toISOString()) {
  const capability = modelCapabilitySchema.parse(raw);
  if (
    !Number.isFinite(Date.parse(now)) ||
    Date.parse(capability.checkedAt) > Date.parse(now) ||
    Date.parse(capability.validUntil) <= Date.parse(capability.checkedAt)
  )
    throw new Error("AI_RUNTIME_CAPABILITY_INVALID");
  return modelBounds(capability, await runtimeDigest(capability));
}

if (import.meta.main) {
  try {
    const [environment, ...extra] = process.argv.slice(2);
    if ((environment !== "preview" && environment !== "production") || extra.length)
      throw new Error("AI_RUNTIME_ENVIRONMENT_REQUIRED");
    const source = await Bun.file("docs/operations/AI-RUNTIME-OBSERVATION.json").json();
    const bounds = await modelCapabilityConfiguration(source);
    const child = Bun.spawn(
      ["bunx", "wrangler", "secret", "put", "AI_MODEL_TOKEN_BOUNDS_JSON", "--env", environment],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
    child.stdin.write(JSON.stringify(bounds));
    child.stdin.end();
    await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if ((await child.exited) !== 0) throw new Error("AI_RUNTIME_BOUNDS_DEPLOY_FAILED");
    console.log(
      JSON.stringify({ environment, modelBoundsConfigured: true, costRefreshRequired: false }),
    );
  } catch {
    console.error("AI_RUNTIME_CAPABILITY_CONFIGURATION_FAILED");
    process.exitCode = 1;
  }
}
