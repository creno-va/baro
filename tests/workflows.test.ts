import { expect, test } from "bun:test";
import { z } from "zod";

const workflowSchema = z.object({
  on: z.record(z.string(), z.unknown()),
  jobs: z.record(
    z.string(),
    z.object({
      steps: z.array(z.object({ uses: z.string().optional(), run: z.string().optional() })),
    }),
  ),
});

test("all workflow actions use immutable commits and valid YAML", async () => {
  for (const file of ["ci.yml", "deploy-preview.yml", "deploy-production.yml"]) {
    const workflow = workflowSchema.parse(
      Bun.YAML.parse(await Bun.file(`.github/workflows/${file}`).text()),
    );
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.uses) expect(step.uses).toMatch(/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
      }
    }
  }
});

test("CD builds before migration and production verifies immutable preview evidence", async () => {
  for (const file of ["deploy-preview.yml", "deploy-production.yml"]) {
    const content = await Bun.file(`.github/workflows/${file}`).text();
    const steps = Object.values(workflowSchema.parse(Bun.YAML.parse(content)).jobs).flatMap(
      (job) => job.steps,
    );
    const build = steps.findIndex((step) => step.run?.includes("bun run build:"));
    const migration = steps.findIndex((step) => step.run?.includes("bun run db:migrate:"));
    expect(build).toBeGreaterThanOrEqual(0);
    expect(migration).toBeGreaterThan(build);
    if (file === "deploy-production.yml") {
      expect(content).toContain('bun scripts/verify-release.ts "$TARGET_SHA"');
      expect(content).toContain("inputs.release_mode == 'public-beta'");
      expect(content).toContain("bun run release:check");
      expect(content).toContain("environment: production");
    }
  }
});
