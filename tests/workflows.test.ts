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
  for (const file of [
    "ci.yml",
    "full-validation.yml",
    "deploy-preview.yml",
    "deploy-production.yml",
    "environment-readiness.yml",
  ]) {
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

test("readiness is manual, main-only and cannot create deployment evidence", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(".github/workflows/environment-readiness.yml").text(),
  ) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: {
      inspect: {
        if: string;
        environment: { name: string; deployment: boolean };
        steps: { env?: Record<string, string> }[];
      };
    };
  };
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.jobs.inspect.if).toBe("github.ref == 'refs/heads/main'");
  expect(workflow.jobs.inspect.environment).toEqual({ name: "preview", deployment: false });
  expect(workflow.on.workflow_dispatch).toMatchObject({
    inputs: { check_legal: { type: "boolean", default: false } },
  });
  expect(
    workflow.jobs.inspect.steps.some((s) => s.env?.READINESS_CANDIDATE_SHA === "${{ github.sha }}"),
  ).toBe(true);
});

test("development CI checks the exact candidate and changed features without a case corpus loop", async () => {
  const ci = Bun.YAML.parse(await Bun.file(".github/workflows/ci.yml").text()) as {
    jobs: {
      quality: {
        steps: {
          name: string;
          with?: { ref?: string };
          env?: Record<string, string>;
          run?: string;
        }[];
      };
    };
  };
  const steps = ci.jobs.quality.steps;
  expect(steps.find((s) => s.name === "Checkout")?.with?.ref).toBe(
    "${{ github.event.pull_request.head.sha || github.sha }}",
  );
  for (const name of ["Changed feature tests", "Changed feature browser flows"]) {
    const step = steps.find((s) => s.name === name);
    expect(step?.env?.CHECK_CANDIDATE_SHA).toBe(
      "${{ github.event.pull_request.head.sha || github.sha }}",
    );
    expect(step?.env?.GITHUB_SHA).toBeUndefined();
  }
  expect(steps.some((s) => s.run?.includes("eval:offline"))).toBe(false);
  expect(steps.some((s) => s.run?.includes("bun run test:ui"))).toBe(false);
  expect(steps.some((s) => s.run === "bun run test")).toBe(false);
  const manual = Bun.YAML.parse(await Bun.file(".github/workflows/full-validation.yml").text()) as {
    on: Record<string, unknown>;
  };
  expect(Object.keys(manual.on)).toEqual(["workflow_dispatch"]);
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
      const buildRun = steps[build]?.run ?? "";
      expect(buildRun.indexOf("bun run bundle:check")).toBeGreaterThan(
        buildRun.indexOf("bun run build:production"),
      );
      expect(content).toContain('bun scripts/verify-release.ts "$TARGET_SHA"');
      expect(content).toContain("inputs.release_mode == 'public-beta'");
      expect(content).toContain("bun run release:check");
      expect(content).toContain("environment: production");
    }
  }
});

test("preview OAuth sync uses only preview Environment secrets before deployment", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(".github/workflows/deploy-preview.yml").text(),
  ) as {
    jobs: {
      deploy: {
        environment: string;
        steps: {
          name: string;
          env?: Record<string, string>;
          with?: Record<string, string>;
          run?: string;
        }[];
      };
    };
  };
  const job = workflow.jobs.deploy;
  expect(job.environment).toBe("preview");
  const validation = job.steps.findIndex(
    (step) => step.name === "Validate preview OAuth credentials",
  );
  const migration = job.steps.findIndex(
    (step) => step.name === "Apply validated preview migrations",
  );
  const deploy = job.steps.find((step) => step.name === "Deploy preview");
  expect(validation).toBeGreaterThan(-1);
  expect(validation).toBeLessThan(migration);
  const fields = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "NAVER_CLIENT_ID",
    "NAVER_CLIENT_SECRET",
    "KAKAO_CLIENT_ID",
    "KAKAO_CLIENT_SECRET",
  ];
  expect(deploy?.with?.secrets?.trim().split(/\s+/)).toEqual(fields);
  expect(Object.keys(deploy?.env ?? {}).sort()).toEqual([...fields].sort());
  for (const field of fields) {
    const expected = "${{ secrets." + field + " }}";
    expect(deploy?.env?.[field]).toBe(expected);
    expect(job.steps[validation]?.env?.[field]).toBe(expected);
  }
  expect(deploy?.with?.command).not.toContain("PUBLIC_BETA_ENABLED");
  expect(deploy?.with?.command).not.toContain("secret");
  expect(deploy?.with?.environment).toBeUndefined();
});
