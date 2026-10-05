import { z } from "zod";

export function hasVerifiedCI(
  runs: { head_sha: string; head_branch: string; conclusion: string | null; event: string }[],
  sha: string,
) {
  return runs.some(
    (run) =>
      run.head_sha === sha &&
      run.head_branch === "main" &&
      run.conclusion === "success" &&
      run.event === "push",
  );
}

if (import.meta.main) {
  const sha = process.argv[2];
  if (!sha || !/^[a-f0-9]{40}$/.test(sha)) throw new Error("A full immutable SHA is required");
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");
  async function get(path: string): Promise<unknown> {
    const response = await fetch(`https://api.github.com/repos/creno-va/baro/${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub verification failed: ${response.status}`);
    return response.json();
  }
  const runs = z
    .object({
      workflow_runs: z.array(
        z.object({
          head_sha: z.string(),
          head_branch: z.string(),
          conclusion: z.string().nullable(),
          event: z.string(),
        }),
      ),
    })
    .parse(await get(`actions/workflows/ci.yml/runs?head_sha=${sha}&status=success&per_page=100`));
  if (!hasVerifiedCI(runs.workflow_runs, sha))
    throw new Error("No successful main push CI for this SHA");
  const deployments = z
    .array(z.object({ id: z.number(), sha: z.string() }))
    .parse(await get(`deployments?sha=${sha}&environment=preview&per_page=100`));
  let verifiedPreview = false;
  for (const deployment of deployments) {
    if (deployment.sha !== sha) continue;
    const statuses = z
      .array(z.object({ state: z.string() }))
      .parse(await get(`deployments/${deployment.id}/statuses`));
    if (statuses[0]?.state === "success") {
      verifiedPreview = true;
      break;
    }
  }
  if (!verifiedPreview) throw new Error("No successful preview deployment/smoke for this SHA");
  console.log(`Verified CI + preview for ${sha}`);
}
