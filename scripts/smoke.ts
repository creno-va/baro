import journal from "../drizzle/meta/_journal.json";
import { inspectAiPreflight } from "./ai-preflight";
import { foundationSmoke } from "./foundation-smoke";

const base = process.argv[2];
const sha = process.argv[3];
const expectedSchemaVersion = journal.entries.at(-1)?.tag;
if (
  !base ||
  !sha ||
  !expectedSchemaVersion ||
  !/^[0-9]{4}_[a-z0-9_]+$/.test(expectedSchemaVersion) ||
  !/^[a-f0-9]{40}$/.test(sha) ||
  !/^https:\/\/(preview\.)?baro\.site$/.test(base)
) {
  console.error("Known HTTPS domain, release SHA and candidate migration baseline required");
  process.exitCode = 1;
} else {
  const result = await foundationSmoke(base, sha, expectedSchemaVersion);
  if (result.passed)
    console.log(`Foundation smoke passed: ${base} ${sha} ${expectedSchemaVersion}`);
  else {
    console.error(
      `Foundation smoke failed: ${result.path} (${result.reason}, ${result.attempts} attempts)`,
    );
    process.exitCode = 1;
  }
}

// A healthy Worker/schema alone does not establish paid AI admission readiness.
// Deployment jobs provide their own Environment token; this never invokes a model.
if (process.exitCode !== 1 && base && sha) {
  try {
    const report = await inspectAiPreflight({
      token: process.env.CLOUDFLARE_API_TOKEN ?? "",
      environment: base === "https://preview.baro.site" ? "preview" : "production",
      candidateSha: sha,
      scope: "text",
      ...(process.env.CLOUDFLARE_ACCOUNT_ID ? { account: process.env.CLOUDFLARE_ACCOUNT_ID } : {}),
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
