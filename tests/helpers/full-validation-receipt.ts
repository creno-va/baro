import { fullValidationSections } from "../../scripts/full-validation-receipt";

export function joinedFullFixture() {
  const run = { id: 12, run_attempt: 2, head_sha: "d".repeat(40) };
  const jobs = {
    total_count: 4,
    jobs: [
      ...Object.values(fullValidationSections).map((section) => ({
        name: section.job,
        run_id: run.id,
        run_attempt: run.run_attempt,
        head_sha: run.head_sha,
        conclusion: "success",
        steps: [
          { name: "Verify actual checkout and main ancestry", conclusion: "success" },
          { name: section.step, conclusion: "success" },
        ],
      })),
      {
        name: "Full validation",
        run_id: run.id,
        run_attempt: run.run_attempt,
        head_sha: run.head_sha,
        conclusion: "success",
        steps: [
          { name: "Verify actual checkout and main ancestry", conclusion: "success" },
          { name: "Verify completed validation sections", conclusion: "success" },
          { name: "Record actual tested candidate", conclusion: "success" },
        ],
      },
    ],
  };
  return { run, jobs };
}

export function fixtureItem<T>(items: T[], index: number): T {
  const item = items[index];
  if (!item) throw new Error("Missing synthetic full-validation item");
  return item;
}
