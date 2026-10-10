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
    "recover-production-runtime.yml",
  ]) {
    const workflow = workflowSchema.parse(
      Bun.YAML.parse(await Bun.file(`.github/workflows/${file}`).text()),
    );
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.uses && step.uses !== "./.github/actions/deploy-worker")
          expect(step.uses).toMatch(/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
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
        steps: {
          name?: string;
          if?: string;
          env?: Record<string, string>;
          with?: Record<string, string>;
        }[];
      };
    };
  };
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.jobs.inspect.if).toBe("github.ref == 'refs/heads/main'");
  expect(workflow.jobs.inspect.environment).toEqual({ name: "preview", deployment: false });
  expect(workflow.on.workflow_dispatch).toMatchObject({
    inputs: {
      target_environment: {
        type: "choice",
        options: ["preview", "production"],
        default: "preview",
      },
      check_legal: { type: "boolean", default: false },
    },
  });
  expect(
    workflow.jobs.inspect.steps.some((s) => s.env?.READINESS_CANDIDATE_SHA === "${{ github.sha }}"),
  ).toBe(true);
  expect(
    workflow.jobs.inspect.steps.some(
      (step) => step.env?.READINESS_TARGET_ENVIRONMENT === "${{ inputs.target_environment }}",
    ),
  ).toBe(true);
  expect(
    workflow.jobs.inspect.steps.find(
      (step) => step.name === "Verify v2 official law precedent and guide integrity",
    )?.if,
  ).toBe("always() && inputs.check_legal && inputs.target_environment == 'preview'");
  const artifact = workflow.jobs.inspect.steps.find(
    (step) => step.name === "Save allowlisted readiness observation",
  );
  expect(artifact?.with?.name).toBe("${{ inputs.target_environment }}-readiness-${{ github.sha }}");
  expect(artifact?.with?.path).toContain(
    ".wrangler/readiness/${{ inputs.target_environment }}.json",
  );
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

interface DeploymentStep {
  name: string;
  uses?: string;
  run?: string;
  if?: string;
  shell?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
}
async function deploymentWorkflow(environment: "preview" | "production") {
  return Bun.YAML.parse(await Bun.file(`.github/workflows/deploy-${environment}.yml`).text()) as {
    on: { workflow_dispatch?: { inputs: Record<string, unknown> } };
    jobs: {
      deploy: { environment: string; env: Record<string, string>; steps: DeploymentStep[] };
    };
  };
}
async function deploymentAction() {
  return Bun.YAML.parse(await Bun.file(".github/actions/deploy-worker/action.yml").text()) as {
    runs: { using: string; steps: DeploymentStep[] };
  };
}
const oauthFields = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "NAVER_CLIENT_ID",
  "NAVER_CLIENT_SECRET",
  "KAKAO_CLIENT_ID",
  "KAKAO_CLIENT_SECRET",
];

test("both environments use one real build and OAuth synchronization pipeline", async () => {
  for (const environment of ["preview", "production"] as const) {
    const workflow = await deploymentWorkflow(environment);
    const job = workflow.jobs.deploy;
    expect(job.environment).toBe(environment);
    const deploy = job.steps.filter((step) => step.uses === "./.github/actions/deploy-worker");
    expect(deploy).toHaveLength(1);
    expect(deploy[0]?.env?.PUBLIC_API_MODE).toBe("real");
    expect(deploy[0]?.env?.PUBLIC_TURNSTILE_SITE_KEY).toBe("${{ vars.PUBLIC_TURNSTILE_SITE_KEY }}");
    for (const field of oauthFields) {
      expect(deploy[0]?.env?.[field]).toBe("${{ secrets." + field + " }}");
      expect(job.env[field]).toBeUndefined();
    }
    expect(deploy[0]?.with?.["target-environment"]).toBe(environment);
    expect(job.steps.some((step) => step.run?.includes("bun run build"))).toBe(false);
    expect(job.steps.some((step) => step.uses?.startsWith("cloudflare/"))).toBe(false);
    expect(workflow.on.workflow_dispatch?.inputs.sync_oauth).toBeUndefined();
  }
  const action = await deploymentAction();
  expect(action.runs.using).toBe("composite");
  const steps = action.runs.steps;
  for (const step of steps) {
    if (step.run) expect(step.shell).toBe("bash");
    if (step.uses) expect(step.uses).toMatch(/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
  }
  const deploy = steps.find((step) => step.uses?.startsWith("cloudflare/"));
  expect(deploy?.with?.secrets?.trim().split(/\s+/)).toEqual(oauthFields);
  expect(deploy?.with?.environment).toBe("${{ inputs.target-environment }}");
  expect(deploy?.if).toBeUndefined();
  expect(deploy?.with?.command).toContain("--var PUBLIC_BETA_ENABLED:");
});

test("CD validates config and selected build before migrations and verifies endpoints after deploy", async () => {
  const steps = (await deploymentAction()).runs.steps;
  const preflight = steps.findIndex((step) => step.name === "Validate deployment inputs");
  const build = steps.findIndex((step) => step.name === "Build and validate selected environment");
  const current = steps.findIndex(
    (step) => step.name === "Reject superseded preview release before migration",
  );
  const migration = steps.findIndex((step) => step.name === "Apply validated migrations");
  const deploy = steps.findIndex((step) => step.uses?.startsWith("cloudflare/"));
  const smoke = steps.findIndex(
    (step) => step.name === "Verify release, schema and endpoint behavior",
  );
  expect(preflight).toBeGreaterThanOrEqual(0);
  expect(build).toBeGreaterThan(preflight);
  expect(current).toBeGreaterThan(build);
  expect(migration).toBeGreaterThan(current);
  expect(deploy).toBeGreaterThan(migration);
  expect(smoke).toBeGreaterThan(deploy);
  expect(steps[preflight]?.run).toContain('bun scripts/check-deployment.ts "$DEPLOY_ENVIRONMENT"');
  expect(steps[preflight]?.run).toContain(
    'bun scripts/check-runtime-secrets.ts "$DEPLOY_ENVIRONMENT"',
  );
  expect(steps[preflight]?.run).toContain('test "$(git rev-parse HEAD)" = "$RELEASE_SHA"');
  expect(steps[build]?.env).toMatchObject({
    CLOUDFLARE_ENV: "${{ inputs.target-environment }}",
    PUBLIC_API_MODE: "real",
  });
  const buildRun = steps[build]?.run ?? "";
  expect(buildRun.indexOf("bun run bundle:check")).toBeGreaterThan(
    buildRun.indexOf("bun run build"),
  );
  expect(buildRun).toContain('bun scripts/check-deployment.ts "$CLOUDFLARE_ENV" --built');
  expect(steps[current]?.if).toBe("inputs.target-environment == 'preview'");
  expect(steps[smoke]?.run).toContain('bun scripts/smoke.ts "$origin" "$RELEASE_SHA" "$mode"');
  expect(steps[smoke]?.run).toContain("mode=foundation");
  expect(steps[smoke]?.run).toContain("mode=open");
});

test("production verifies immutable preview and launch evidence before shared deployment", async () => {
  const job = (await deploymentWorkflow("production")).jobs.deploy;
  expect(job.environment).toBe("production");
  const deployment = job.steps.findIndex((s) => s.uses === "./.github/actions/deploy-worker");
  const verification = job.steps.findIndex((s) => s.run?.includes("bun scripts/verify-release.ts"));
  expect(verification).toBeGreaterThanOrEqual(0);
  expect(verification).toBeLessThan(deployment);
  const strictIndex = job.steps.findIndex((s) => s.name === "Check public beta release evidence");
  const strict = job.steps[strictIndex];
  expect(strictIndex).toBeLessThan(deployment);
  expect(strict?.if).toBe("inputs.release_mode == 'public-beta'");
  expect(strict?.run).toBe("bun run release:check");
  const operator = job.steps.findIndex(
    (s) => s.name === "Check explicit operator launch authorization",
  );
  expect(operator).toBeGreaterThan(-1);
  expect(operator).toBeLessThan(deployment);
  expect(job.steps[operator]?.if).toBe("inputs.release_mode == 'operator-authorized'");
  expect(job.steps[operator]?.run).toContain('"$TARGET_SHA" "$LAUNCH_AUTHORIZATION_COMMENT"');
  expect(job.steps[operator]?.env?.LAUNCH_AUTHORIZATION_COMMENT).toBe(
    "${{ inputs.launch_authorization_comment }}",
  );
  expect(job.steps[deployment]?.with?.["public-beta-enabled"]).toBe(
    "${{ (inputs.release_mode == 'public-beta' || inputs.release_mode == 'operator-authorized') && 'true' || 'false' }}",
  );
  const steps = (await deploymentAction()).runs.steps;
  const migration = steps.findIndex((s) => s.name === "Apply validated migrations");
  const ai = steps.findIndex((s) => s.name === "Configure verified AI runtime");
  const deploy = steps.findIndex((s) => s.uses?.startsWith("cloudflare/"));
  expect(ai).toBeGreaterThan(migration);
  expect(ai).toBeLessThan(deploy);
  expect(steps[ai]?.if).toBe(
    "inputs.target-environment == 'production' && inputs.configure-ai == 'true'",
  );
  expect(steps[ai]?.run).toBe('bun scripts/provision-ai-budget.ts "$RELEASE_SHA"');
});

test("production runtime recovery preserves reviewer protection and cannot become release evidence", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(".github/workflows/recover-production-runtime.yml").text(),
  ) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    concurrency: { group: string; "cancel-in-progress": boolean };
    jobs: {
      recover: {
        if: string;
        env?: Record<string, string>;
        environment: { name: string; deployment: boolean };
        steps: (Omit<DeploymentStep, "with"> & {
          with?: Record<string, unknown>;
          "continue-on-error"?: boolean;
        })[];
      };
    };
  };
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.on.workflow_dispatch).toMatchObject({
    inputs: {
      confirmation: { required: true, type: "string" },
      expected_live_sha: { required: true, type: "string" },
    },
  });
  expect(workflow.permissions).toEqual({ contents: "read", actions: "read" });
  expect(workflow.concurrency).toEqual({
    group: "cloudflare-production",
    "cancel-in-progress": false,
  });
  const job = workflow.jobs.recover;
  expect(job.if).toBe("inputs.confirmation == 'production' && github.ref == 'refs/heads/main'");
  expect(job.environment).toEqual({ name: "production", deployment: false });
  expect(job.env).toBeUndefined();
  const validation = job.steps.findIndex((step) => step.name === "Validate recovery target");
  const recovery = job.steps.findIndex(
    (step) => step.run === "bun scripts/recover-production-runtime.ts",
  );
  expect(validation).toBeGreaterThanOrEqual(0);
  expect(recovery).toBeGreaterThan(validation);
  expect(job.steps[validation]?.run).toBe('[[ "$RECOVERY_EXPECTED_LIVE_SHA" =~ ^[a-f0-9]{40}$ ]]');
  expect(job.steps[validation]?.env).toEqual({
    RECOVERY_EXPECTED_LIVE_SHA: "${{ inputs.expected_live_sha }}",
  });
  expect(job.steps[recovery]?.env).toEqual({
    RECOVERY_EXPECTED_LIVE_SHA: "${{ inputs.expected_live_sha }}",
    CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
    CASE_DATA_KEY_V1: "${{ secrets.CASE_DATA_KEY_V1 }}",
    LAW_API_OC: "${{ secrets.LAW_API_OC }}",
  });
  const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  expect(checkout?.with).toMatchObject({ ref: "${{ github.sha }}", "persist-credentials": false });
  const artifact = job.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  expect(artifact?.if).toBe("always()");
  expect(artifact?.with?.path).toBe(".wrangler/readiness/production-recovery.json");
  expect(artifact?.with?.["retention-days"]).toBe(7);
  for (const [index, step] of job.steps.entries()) {
    expect(step["continue-on-error"]).not.toBe(true);
    expect(step.uses).not.toBe("./.github/actions/deploy-worker");
    expect(step.run ?? "").not.toMatch(
      /wrangler.*deploy|migrate|provision-ai-budget|PUBLIC_BETA_ENABLED|\/deployments/,
    );
    if (index !== recovery)
      expect(Object.values(step.env ?? {}).some((value) => value.includes("secrets."))).toBe(false);
  }
});
