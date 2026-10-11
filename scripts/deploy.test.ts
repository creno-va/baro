import { expect, test } from "bun:test";
import { deploymentCommand, deploymentOptions } from "./deploy";

const sha = "a".repeat(40);
test("preview dispatch targets main workflow and one explicit immutable SHA", () => {
  const options = deploymentOptions(["preview", "--sha", sha, "--plan"]);
  expect(options.plan).toBe(true);
  expect(deploymentCommand(options, sha)).toEqual([
    "gh",
    "workflow",
    "run",
    "deploy-preview.yml",
    "--repo",
    "creno-va/baro",
    "--ref",
    "main",
    "-f",
    `target_sha=${sha}`,
  ]);
  expect(deploymentOptions(["preview"]).sha).toBeUndefined();
});

test("production requires a preview SHA and preserves explicit launch and configuration options", () => {
  expect(() => deploymentOptions(["production"])).toThrow("requires --sha");
  const foundation = deploymentCommand(deploymentOptions(["production", "--sha", sha]), sha);
  expect(foundation).toContain("release_mode=foundation");
  expect(foundation).toContain("configure_ai=false");
  expect(foundation).toContain("confirmation=production");
  const launch = deploymentOptions([
    "production",
    "--sha",
    sha,
    "--mode",
    "operator-authorized",
    "--authorization",
    "123",
    "--configure-ai",
  ]);
  expect(deploymentCommand(launch, sha)).toContain("launch_authorization_comment=123");
  expect(deploymentCommand(launch, sha)).toContain("configure_ai=true");
});

test("invalid options fail before a workflow can be dispatched", () => {
  for (const args of [
    ["other"],
    ["preview", "--sha", "main"],
    ["preview", "--sha", "$(command)"],
    ["preview", "--sha"],
    ["preview", "--sha", sha, "--sha", sha],
    ["preview", "--unknown"],
    ["preview", "--mode", "public-beta"],
    ["preview", "--configure-ai"],
    ["preview", "--authorization", "123"],
    ["production", "--sha", sha, "--mode", "open"],
    ["production", "--sha", sha, "--mode", "operator-authorized"],
    ["production", "--sha", sha, "--mode", "operator-authorized", "--authorization", "x"],
    ["production", "--sha", sha, "--authorization", "123"],
  ])
    expect(() => deploymentOptions(args)).toThrow();
  expect(() => deploymentCommand(deploymentOptions(["preview"]), "main")).toThrow();
});
