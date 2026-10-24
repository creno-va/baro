import { expect, test } from "bun:test";
import { probeProviderFailureSchema } from "../scripts/ai-readiness-control";

test("provider observations accept only finite categories and never provider text", () => {
  expect(
    probeProviderFailureSchema.parse({
      phase: "screening",
      category: "provider_schema",
      httpStatus: 400,
    }),
  ).toEqual({ phase: "screening", category: "provider_schema", httpStatus: 400 });
  for (const value of [
    { phase: "screening", category: "private-provider-message", httpStatus: 400 },
    { phase: "screening", category: "provider_request", httpStatus: 400, message: "private" },
    { phase: "screening", category: "provider_request", httpStatus: 200 },
  ])
    expect(probeProviderFailureSchema.safeParse(value).success).toBe(false);
});

test("live acceptance remains a separate manual action with exact candidate and bounded probe", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(".github/workflows/ai-synthetic-readiness.yml").text(),
  ) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: {
      probe: {
        if: string;
        environment: { name: string; deployment: boolean };
        steps: { run?: string; uses?: string }[];
      };
    };
  };
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.permissions).toEqual({ contents: "read", actions: "read" });
  expect(workflow.jobs.probe.if).toContain("github.sha == inputs.candidate_sha");
  expect(workflow.jobs.probe.if).toContain("single-synthetic-probe");
  expect(workflow.jobs.probe.environment).toEqual({ name: "preview", deployment: false });
  expect(workflow.jobs.probe.steps.some((step) => step.run?.includes("--ci-only"))).toBe(true);
  expect(
    workflow.jobs.probe.steps.some((step) => step.run === "bun scripts/run-ai-readiness.ts"),
  ).toBe(true);
  const automatic = await Bun.file(".github/workflows/ci.yml").text();
  const full = await Bun.file(".github/workflows/full-validation.yml").text();
  expect(automatic + full).not.toContain("run-ai-readiness.ts");
});
