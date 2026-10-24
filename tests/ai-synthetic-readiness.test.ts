import { expect, test } from "bun:test";
import {
  probePolicyFailureSchema,
  probeProviderFailureSchema,
} from "../scripts/ai-readiness-control";

test("provider observations accept only finite categories and never provider text", () => {
  expect(
    probePolicyFailureSchema.safeParse({
      reason: "unsupported_fact",
      factCategory: "source_text_mismatch",
    }).success,
  ).toBe(true);
  expect(
    probePolicyFailureSchema.safeParse({ reason: "audit_rejected", text: "private sentinel" })
      .success,
  ).toBe(false);
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
        strategy: {
          "max-parallel": number;
          "fail-fast": boolean;
          matrix: { feature_case: string };
        };
        if: string;
        environment: { name: string; deployment: boolean };
        steps: { run?: string; uses?: string; if?: string }[];
      };
    };
  };
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.permissions).toEqual({ contents: "read", actions: "read" });
  expect(workflow.jobs.probe.if).toContain("github.sha == inputs.candidate_sha");
  expect(workflow.jobs.probe.if).toContain("single-synthetic-probe");
  expect(workflow.jobs.probe.environment).toEqual({ name: "preview", deployment: false });
  expect(workflow.jobs.probe.strategy["max-parallel"]).toBe(1);
  expect(workflow.jobs.probe.strategy["fail-fast"]).toBe(false);
  expect(workflow.jobs.probe.strategy.matrix.feature_case).toContain("tools_business");
  expect(workflow.jobs.probe.strategy.matrix.feature_case).toContain("tools_property");
  expect(workflow.jobs.probe.strategy.matrix.feature_case).toContain("tools_registry");
  expect(workflow.jobs.probe.steps.some((step) => step.run?.includes("--ci-only"))).toBe(true);
  expect(
    workflow.jobs.probe.steps.some((step) => step.run === "bun scripts/run-ai-readiness.ts"),
  ).toBe(true);
  expect(
    workflow.jobs.probe.steps.find((step) => step.run === "bun scripts/run-ai-readiness.ts")?.if,
  ).toBe("matrix.feature_case != 'native_materials'");
  expect(workflow.jobs.probe.steps.find((step) => step.run === "bun run validate:native")?.if).toBe(
    "matrix.feature_case == 'native_materials'",
  );
  const automatic = await Bun.file(".github/workflows/ci.yml").text();
  const full = await Bun.file(".github/workflows/full-validation.yml").text();
  expect(automatic + full).not.toContain("run-ai-readiness.ts");
});
