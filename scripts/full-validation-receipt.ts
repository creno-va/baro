import { mkdir } from "node:fs/promises";
import { z } from "zod";

export const fullValidationSections = {
  core: { job: "Full core validation", step: "Run full core validation" },
  browser: { job: "Full browser validation (screens 1)", step: "Run full browser validation" },
  native: { job: "Full native validation", step: "Run full native validation" },
} as const;

export const additionalFullBrowserJobs = [
  { job: "Full browser validation (screens 2)", step: "Run full browser validation" },
  { job: "Full browser validation (journeys)", step: "Run full browser validation" },
] as const;

export function verifyFullValidationSections(raw: string | undefined) {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "null");
  } catch {
    throw new Error("FULL_VALIDATION_SECTIONS_INCOMPLETE");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("FULL_VALIDATION_SECTIONS_INCOMPLETE");
  const expected = Object.keys(fullValidationSections).sort();
  if (Object.keys(value).sort().join(",") !== expected.join(","))
    throw new Error("FULL_VALIDATION_SECTIONS_INCOMPLETE");
  for (const id of expected) {
    const section = (value as Record<string, unknown>)[id];
    if (
      !section ||
      typeof section !== "object" ||
      Array.isArray(section) ||
      !Object.hasOwn(section, "result") ||
      (section as { result: unknown }).result !== "success"
    )
      throw new Error("FULL_VALIDATION_SECTIONS_INCOMPLETE");
  }
  return expected;
}

const identitySchema = z.object({
  id: z.number().int().positive(),
  run_attempt: z.number().int().positive(),
  head_sha: z.string().regex(/^[a-f0-9]{40}$/),
});

function validationJobs(rawRun: unknown, rawJobs: unknown) {
  const run = identitySchema.parse(rawRun);
  const jobs = z
    .object({
      total_count: z.number().int().min(0).max(100),
      jobs: z
        .array(
          z.object({
            name: z.string(),
            run_id: z.number().int().positive(),
            run_attempt: z.number().int().positive(),
            head_sha: z.string(),
            conclusion: z.string().nullable(),
            steps: z.array(z.object({ name: z.string(), conclusion: z.string().nullable() })),
          }),
        )
        .max(100),
    })
    .parse(rawJobs);
  if (jobs.total_count !== jobs.jobs.length) throw new Error("FULL_VALIDATION_SECTIONS_INCOMPLETE");
  return { run, jobs };
}

export function verifyFullValidationJobs(rawRun: unknown, rawJobs: unknown) {
  const { run, jobs } = validationJobs(rawRun, rawJobs);
  for (const section of [...Object.values(fullValidationSections), ...additionalFullBrowserJobs]) {
    const matching = jobs.jobs.filter((job) => job.name === section.job);
    const job = matching.length === 1 ? matching[0] : undefined;
    if (
      !job ||
      job.run_id !== run.id ||
      job.run_attempt !== run.run_attempt ||
      job.head_sha !== run.head_sha ||
      job.conclusion !== "success" ||
      !["Verify actual checkout and main ancestry", section.step].every((name) =>
        job.steps.some((step) => step.name === name && step.conclusion === "success"),
      )
    )
      throw new Error("FULL_VALIDATION_SECTIONS_INCOMPLETE");
  }
}

/** Completed producer verification is separate: the writer's join is still running. */
export function verifyFullValidationJoin(rawRun: unknown, rawJobs: unknown) {
  const { run, jobs } = validationJobs(rawRun, rawJobs);
  const matching = jobs.jobs.filter((job) => job.name === "Full validation");
  const job = matching.length === 1 ? matching[0] : undefined;
  if (
    !job ||
    job.run_id !== run.id ||
    job.run_attempt !== run.run_attempt ||
    job.head_sha !== run.head_sha ||
    job.conclusion !== "success" ||
    ![
      "Verify actual checkout and main ancestry",
      "Verify completed validation sections",
      "Record actual tested candidate",
    ].every((name) => job.steps.some((step) => step.name === name && step.conclusion === "success"))
  )
    throw new Error("FULL_VALIDATION_JOIN_INCOMPLETE");
}

async function verifyCurrentRun() {
  const runId = process.env.GITHUB_RUN_ID ?? "";
  const attempt = process.env.GITHUB_RUN_ATTEMPT ?? "";
  const token = process.env.GITHUB_TOKEN;
  if (!/^[1-9]\d*$/.test(runId) || !/^[1-9]\d*$/.test(attempt) || !token)
    throw new Error("FULL_VALIDATION_RUN_UNVERIFIED");
  const get = async (path: string): Promise<unknown> => {
    const response = await fetch(`https://api.github.com/repos/creno-va/baro/${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("FULL_VALIDATION_RUN_UNVERIFIED");
    return response.json();
  };
  const run = z
    .object({
      ...identitySchema.shape,
      head_branch: z.literal("main"),
      event: z.literal("workflow_dispatch"),
      path: z.literal(".github/workflows/full-validation.yml"),
      repository: z.object({ full_name: z.literal("creno-va/baro") }),
    })
    .parse(await get(`actions/runs/${runId}`));
  if (
    String(run.id) !== runId ||
    String(run.run_attempt) !== attempt ||
    run.head_sha !== process.env.GITHUB_SHA
  )
    throw new Error("FULL_VALIDATION_RUN_UNVERIFIED");
  verifyFullValidationJobs(run, await get(`actions/runs/${runId}/jobs?filter=latest&per_page=100`));
}

// Invoked only after all full-validation sections succeed. Git is the tested SHA;
// github.sha may instead identify the workflow dispatcher revision.
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args[0] && args[0] !== "--check"))
    throw new Error("FULL_VALIDATION_ARGUMENT_INVALID");
  const sections = verifyFullValidationSections(process.env.FULL_VALIDATION_SECTIONS);
  const sha = (await new Response(Bun.spawn(["git", "rev-parse", "HEAD"]).stdout).text()).trim();
  if (!/^[a-f0-9]{40}$/.test(sha) || sha !== process.env.TARGET_SHA)
    throw new Error("FULL_VALIDATION_CHECKOUT_MISMATCH");
  await verifyCurrentRun();
  if (args[0] === "--check") {
    console.log("All full-validation sections and actual checkout verified");
    process.exit(0);
  }
  await mkdir(".wrangler/release", { recursive: true });
  await Bun.write(
    ".wrangler/release/full-validation.json",
    JSON.stringify({
      candidateSha: sha,
      environment: "preview",
      mode: "deterministic-ui",
      result: "pass",
      check: "accessibility",
      fullValidation: true,
      validationSections: sections,
      runId: process.env.GITHUB_RUN_ID,
      paidExternalCalls: false,
      independentExternalEvidenceComplete: false,
    }),
  );
}
