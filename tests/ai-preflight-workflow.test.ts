import { expect, test } from "bun:test";
import { z } from "zod";

test("live AI inspection is read-only and preserves the failed result and sanitized artifact", async () => {
  const workflow = z
    .object({
      permissions: z.record(z.string(), z.string()),
      on: z.object({ workflow_run: z.object({ workflows: z.array(z.string()) }) }),
      jobs: z.object({
        inspect: z.object({
          if: z.string(),
          environment: z.object({ deployment: z.boolean() }),
          steps: z.array(
            z.object({
              uses: z.string().optional(),
              run: z.string().optional(),
              if: z.string().optional(),
              "continue-on-error": z.boolean().optional(),
            }),
          ),
        }),
      }),
    })
    .parse(Bun.YAML.parse(await Bun.file(".github/workflows/ai-preflight.yml").text()));
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.jobs.inspect.environment.deployment).toBe(false);
  expect(workflow.jobs.inspect.if).toContain("head_repository.full_name == github.repository");
  expect(workflow.jobs.inspect.if).toContain("head_branch == 'main'");
  expect(workflow.on.workflow_run.workflows).toEqual(["Deploy preview"]);
  const steps = workflow.jobs.inspect.steps;
  for (const step of steps) {
    if (step.uses) expect(step.uses).toMatch(/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
    expect(step["continue-on-error"]).not.toBe(true);
    if (step.run) {
      expect(step.run).not.toMatch(/provision-ai-budget|wrangler.*deploy|secret.*put/);
      expect(step.run).not.toContain("|| true");
    }
  }
  expect(steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"))?.if).toBe(
    "always()",
  );
});

test("deployment smoke cannot report success without the text AI configuration gate", async () => {
  const smoke = await Bun.file("scripts/smoke.ts").text();
  expect(smoke).toContain('import { inspectAiPreflight } from "./ai-preflight"');
  expect(smoke).toContain('scope: "text"');
  expect(smoke).toContain('report.status === "blocked"');
  expect(smoke).toContain("process.exitCode = 1");
  for (const file of ["deploy-preview.yml", "deploy-production.yml"]) {
    const workflow = await Bun.file(`.github/workflows/${file}`).text();
    const deployment = workflow.includes("uses: ./.github/actions/deploy-worker")
      ? await Bun.file(".github/actions/deploy-worker/action.yml").text()
      : workflow;
    expect(deployment).toContain("bun scripts/smoke.ts");
  }
});
