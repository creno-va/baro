import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DrillCommandError, runDrillWrangler } from "./isolated-drill-process";

async function execute(source: string, timeout = 3000) {
  const directory = await mkdtemp(join(tmpdir(), "baro-node-cli-test-"));
  try {
    const entry = join(directory, "synthetic.cjs");
    await writeFile(entry, source);
    return await runDrillWrangler(["synthetic-only"], timeout, process.env, entry);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test("the direct CLI runs on Node and drains output as byte counts without retaining text", async () => {
  const observation = await execute(`
    if (process.versions.bun || process.argv[2] !== 'synthetic-only') process.exit(7);
    process.stdout.write('private synthetic output'.repeat(4096));
    process.stderr.write('private synthetic error');
  `);
  expect(observation).toMatchObject({
    runtime: "node",
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdoutBytes: 24 * 4096,
    stderrBytes: 23,
  });
  expect(JSON.stringify(observation)).not.toContain("private synthetic");
});
test("nonzero exit is rejected with only safe process observations", async () => {
  try {
    await execute("process.stderr.write('secret diagnostic'); process.exitCode = 17;");
    throw new Error("EXPECTED_FAILURE");
  } catch (error) {
    expect(error).toBeInstanceOf(DrillCommandError);
    expect((error as DrillCommandError).message).toBe("WRANGLER_COMMAND_FAILED");
    expect((error as DrillCommandError).observation).toMatchObject({
      exitCode: 17,
      signal: null,
      timedOut: false,
    });
    expect(JSON.stringify(error)).not.toContain("secret diagnostic");
  }
});
test("signal termination cannot be converted to exit0 by the Wrangler wrapper", async () => {
  try {
    await execute("process.kill(process.pid, 'SIGTERM');");
    throw new Error("EXPECTED_FAILURE");
  } catch (error) {
    expect(error).toBeInstanceOf(DrillCommandError);
    expect((error as DrillCommandError).message).toBe("WRANGLER_OUTCOME_UNKNOWN");
    expect((error as DrillCommandError).observation).toMatchObject({
      signal: "SIGTERM",
      timedOut: false,
    });
  }
});
test("a timed-out Node process is killed once and its result remains unknown", async () => {
  try {
    await execute("setInterval(() => {}, 1000);", 100);
    throw new Error("EXPECTED_FAILURE");
  } catch (error) {
    expect(error).toBeInstanceOf(DrillCommandError);
    expect((error as DrillCommandError).message).toBe("WRANGLER_OUTCOME_UNKNOWN");
    expect((error as DrillCommandError).observation).toMatchObject({
      signal: "SIGKILL",
      timedOut: true,
    });
  }
});
