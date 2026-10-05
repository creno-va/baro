import journal from "../drizzle/meta/_journal.json";
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
