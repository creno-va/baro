import journal from "../drizzle/meta/_journal.json";
import { endpointSmoke } from "./endpoint-smoke";
import { foundationSmoke } from "./foundation-smoke";

const base = process.argv[2];
const sha = process.argv[3];
const mode = process.argv[4];
const expectedSchemaVersion = journal.entries.at(-1)?.tag;
if (
  !base ||
  !sha ||
  (mode !== "open" && mode !== "foundation") ||
  !expectedSchemaVersion ||
  !/^[0-9]{4}_[a-z0-9_]+$/.test(expectedSchemaVersion) ||
  !/^[a-f0-9]{40}$/.test(sha) ||
  !/^https:\/\/(preview\.)?baro\.site$/.test(base)
) {
  console.error(
    "Known HTTPS domain, release SHA, candidate migration baseline and open|foundation mode required",
  );
  process.exitCode = 1;
} else {
  const result = await foundationSmoke(base, sha, expectedSchemaVersion);
  if (result.passed) {
    console.log(`Foundation smoke passed: ${base} ${sha} ${expectedSchemaVersion}`);
    const endpoints = await endpointSmoke(base, mode);
    if (endpoints.passed)
      console.log(`Endpoint smoke passed: ${base} ${mode} (${endpoints.checked} routes)`);
    else {
      console.error(`Endpoint smoke failed: ${endpoints.path} (${endpoints.reason})`);
      process.exitCode = 1;
    }
  } else {
    console.error(
      `Foundation smoke failed: ${result.path} (${result.reason}, ${result.attempts} attempts)`,
    );
    process.exitCode = 1;
  }
}
