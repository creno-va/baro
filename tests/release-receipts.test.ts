import { expect, test } from "bun:test";
import { githubReceiptResolver } from "../scripts/release-receipts";

const sha = "a".repeat(40),
  digest = "b".repeat(64);
function fixture() {
  const run = {
    id: 12,
    head_branch: "main",
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    path: ".github/workflows/full-validation.yml",
    repository: { full_name: "creno-va/baro" },
  };
  const artifacts = {
    total_count: 1,
    artifacts: [
      {
        name: `release-accessibility-preview-${sha}`,
        digest: `sha256:${digest}`,
        expired: false,
        workflow_run: { id: 12 },
      },
    ],
  };
  const jobs = {
    total_count: 1,
    jobs: [
      {
        name: "Full validation",
        conclusion: "success",
        steps: [
          { name: "Run explicit full validation", conclusion: "success" },
          { name: "Record actual tested candidate", conclusion: "success" },
        ],
      },
    ],
  };
  const resolve = githubReceiptResolver(async (path) =>
    path.includes("/artifacts?") ? artifacts : path.includes("/jobs?") ? jobs : run,
  );
  const artifact = artifacts.artifacts[0],
    job = jobs.jobs[0],
    step = jobs.jobs[0]?.steps[0];
  if (!artifact || !job || !step) throw new Error("Synthetic fixture missing");
  return { run, jobs, artifacts, resolve, artifact, job, step };
}

test("GitHub resolver binds actual tested SHA, environment, check and archive digest to successful producer", async () => {
  const f = fixture();
  expect(await f.resolve(12)).toEqual({
    candidateSha: sha,
    environment: "preview",
    mode: "deterministic-ui",
    completed: true,
    conclusion: "success",
    artifactHash: digest,
    checks: ["accessibility"],
    criticalFindings: 0,
  });
});

test("a successful run cannot substitute wrong workflow, artifact, environment, check or incomplete step", async () => {
  const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.run.path = ".github/workflows/ci.yml";
    },
    (f) => {
      f.run.repository.full_name = "untrusted/baro";
    },
    (f) => {
      f.run.head_branch = "other";
    },
    (f) => {
      f.run.event = "pull_request";
    },
    (f) => {
      f.run.conclusion = "failure";
    },
    (f) => {
      f.artifact.name = `release-accessibility-production-${sha}`;
    },
    (f) => {
      f.artifact.name = `release-aiEval-preview-${sha}`;
    },
    (f) => {
      f.artifact.digest = "missing";
    },
    (f) => {
      f.artifact.expired = true;
    },
    (f) => {
      f.artifact.workflow_run.id = 99;
    },
    (f) => {
      f.artifacts.artifacts.push({ ...f.artifact });
      f.artifacts.total_count++;
    },
    (f) => {
      f.step.conclusion = "skipped";
    },
    (f) => {
      f.job.steps.pop();
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    await expect(f.resolve(12)).rejects.toThrow();
  }
});

test("manual full validation checks out explicit SHA and records git HEAD after the complete successful suite", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(".github/workflows/full-validation.yml").text(),
  ) as {
    on: { workflow_dispatch: { inputs: { target_sha: { required: boolean } } } };
    jobs: {
      validation: {
        needs: string[];
        steps: { name: string; run?: string; with?: Record<string, string> }[];
      };
    };
  };
  expect(workflow.on.workflow_dispatch.inputs.target_sha.required).toBe(true);
  const steps = workflow.jobs.validation.steps;
  expect(workflow.jobs.validation.needs).toEqual(["core", "browser", "native"]);
  expect(steps.find((s) => s.name === "Checkout")?.with?.ref).toBe("$" + "{{ inputs.target_sha }}");
  expect(steps.find((s) => s.name === "Verify actual checkout and main ancestry")?.run).toContain(
    "git rev-parse HEAD",
  );
  const check = steps.findIndex((s) => s.run === "bun scripts/full-validation-receipt.ts --check");
  expect(check).toBeGreaterThanOrEqual(0);
  expect(steps.findIndex((s) => s.name === "Record actual tested candidate")).toBeGreaterThan(
    check,
  );
  expect(steps.find((s) => s.name === "Save successful full validation receipt")?.with?.name).toBe(
    "release-accessibility-preview-$" + "{{ inputs.target_sha }}",
  );
});

test("a joined full receipt requires every successful section without falling back to a legacy step", async () => {
  const { fixtureItem, joinedFullFixture } = await import("./helpers/full-validation-receipt");
  const create = () => {
    const legacy = fixture();
    const joined = joinedFullFixture();
    const run = { ...legacy.run, ...joined.run };
    const resolve = githubReceiptResolver(async (path) =>
      path.includes("/artifacts?") ? legacy.artifacts : path.includes("/jobs?") ? joined.jobs : run,
    );
    return { ...joined, run, resolve };
  };
  expect((await create().resolve(12)).candidateSha).toBe(sha);
  for (const mutate of [
    (f: ReturnType<typeof create>) => {
      fixtureItem(f.jobs.jobs, 3).run_id++;
    },
    (f: ReturnType<typeof create>) => {
      fixtureItem(f.jobs.jobs, 3).run_attempt--;
    },
    (f: ReturnType<typeof create>) => {
      fixtureItem(f.jobs.jobs, 3).head_sha = sha;
    },
    (f: ReturnType<typeof create>) => {
      fixtureItem(f.jobs.jobs, 0).run_attempt--;
    },
    (f: ReturnType<typeof create>) => {
      fixtureItem(f.jobs.jobs, 1).conclusion = "failure";
    },
    (f: ReturnType<typeof create>) => {
      f.jobs.jobs.pop();
      f.jobs.total_count--;
    },
    (f: ReturnType<typeof create>) => {
      fixtureItem(fixtureItem(f.jobs.jobs, 3).steps, 0).conclusion = "failure";
    },
    (f: ReturnType<typeof create>) => {
      fixtureItem(f.jobs.jobs, 3).steps.shift();
    },
    (f: ReturnType<typeof create>) => {
      fixtureItem(f.jobs.jobs, 3).steps.push({
        name: "Run explicit full validation",
        conclusion: "success",
      });
    },
    (f: ReturnType<typeof create>) => {
      fixtureItem(fixtureItem(f.jobs.jobs, 1).steps, 1).conclusion = "skipped";
    },
    (f: ReturnType<typeof create>) => {
      fixtureItem(f.jobs.jobs, 0).head_sha = sha;
    },
  ]) {
    const f = create();
    mutate(f);
    await expect(f.resolve(12)).rejects.toThrow();
  }
});
