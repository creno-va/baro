import { foundationSmoke } from "./foundation-smoke";

const base = process.argv[2];
const sha = process.argv[3];
if (
  !base ||
  !sha ||
  !/^[a-f0-9]{40}$/.test(sha) ||
  !/^https:\/\/(preview\.)?baro\.site$/.test(base)
) {
  console.error("Known HTTPS domain and release SHA required");
  process.exitCode = 1;
} else {
  const result = await foundationSmoke(base, sha);
  if (result.passed) console.log(`Foundation smoke passed: ${base} ${sha}`);
  else {
    console.error(
      `Foundation smoke failed: ${result.path} (${result.reason}, ${result.attempts} attempts)`,
    );
    process.exitCode = 1;
  }
}
