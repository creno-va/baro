import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

export const workGraphSchema = z
  .object({
    repository: z.literal("creno-va/baro"),
    items: z.array(
      z
        .object({
          issue: z.number().int().positive(),
          milestone: z.number().int().positive(),
          kind: z.enum(["implementation", "external"]),
          dependsOn: z.array(z.number().int().positive()),
          owns: z.array(z.string().min(1)).min(1),
          docs: z.array(z.string().min(1)).min(1),
          validation: z.string().min(10),
        })
        .strict(),
    ),
  })
  .strict();

export type WorkGraph = z.infer<typeof workGraphSchema>;

export function validateWorkGraph(graph: WorkGraph): string[] {
  const errors: string[] = [];
  const items = new Map(graph.items.map((item) => [item.issue, item]));
  if (items.size !== graph.items.length) errors.push("Duplicate issue number");
  const visiting = new Set<number>();
  const visited = new Set<number>();
  function visit(issue: number) {
    if (visiting.has(issue)) {
      errors.push(`Dependency cycle at #${issue}`);
      return;
    }
    if (visited.has(issue)) return;
    visiting.add(issue);
    for (const dependency of items.get(issue)?.dependsOn ?? []) {
      if (dependency === issue) errors.push(`Self-dependency #${issue}`);
      if (!items.has(dependency) && ![4, 7, 22].includes(dependency)) {
        errors.push(`Unknown dependency #${dependency} from #${issue}`);
      }
      visit(dependency);
    }
    visiting.delete(issue);
    visited.add(issue);
  }
  for (const item of graph.items) {
    visit(item.issue);
    for (const path of item.docs) {
      if (!path.startsWith("docs/") || path.includes("..") || !existsSync(resolve(path))) {
        errors.push(`Invalid document ${path} for #${item.issue}`);
      }
    }
  }
  return errors;
}

if (import.meta.main) {
  const graph = workGraphSchema.parse(await Bun.file("docs/development/work-items.json").json());
  const errors = validateWorkGraph(graph);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`Work graph valid: ${graph.items.length} tasks, no cycles`);
  if (!process.argv.includes("--live")) process.exit(0);

  async function ghJson(args: string[]): Promise<unknown> {
    const result = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
    const [output, error, status] = await Promise.all([
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
      result.exited,
    ]);
    if (status !== 0) throw new Error(`GitHub read failed: ${error}`);
    return JSON.parse(output);
  }
  const issueSchema = z.array(
    z.object({
      number: z.number(),
      title: z.string(),
      state: z.enum(["OPEN", "CLOSED"]),
      labels: z.array(z.object({ name: z.string() })),
      milestone: z.object({ number: z.number() }).nullable(),
    }),
  );
  const live = issueSchema.parse(
    await ghJson([
      "issue",
      "list",
      "--repo",
      graph.repository,
      "--state",
      "all",
      "--limit",
      "1000",
      "--json",
      "number,title,state,labels,milestone",
    ]),
  );
  const prs = z
    .array(z.object({ number: z.number(), body: z.string(), url: z.string() }))
    .parse(
      await ghJson([
        "pr",
        "list",
        "--repo",
        graph.repository,
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        "number,body,url",
      ]),
    );
  const issues = new Map(live.map((item) => [item.number, item]));
  let drift = false;
  for (const item of graph.items) {
    const issue = issues.get(item.issue);
    if (!issue) {
      console.error(`MISSING #${item.issue}`);
      drift = true;
      continue;
    }
    if (issue.state === "CLOSED") continue;
    if (issue.milestone?.number !== item.milestone) {
      console.error(`MILESTONE DRIFT #${item.issue}`);
      drift = true;
    }
    const blockedBy = item.dependsOn.filter((id) => issues.get(id)?.state !== "CLOSED");
    const active =
      issue.labels.some((label) => label.name === "status:in-progress") ||
      prs.some((pr) =>
        new RegExp(`(?:Refs|Closes|Fixes) #${item.issue}(?!\\d)`, "i").test(pr.body),
      );
    const status = active
      ? "IN_PROGRESS"
      : item.kind === "external"
        ? "EXTERNAL"
        : blockedBy.length
          ? "BLOCKED"
          : "READY";
    console.log(
      `${status} #${item.issue} ${issue.title}${blockedBy.length ? ` <- ${blockedBy.map((id) => `#${id}`).join(", ")}` : ""}`,
    );
  }
  const untracked = live.filter(
    (item) =>
      item.state === "OPEN" &&
      !itemsHas(graph, item.number) &&
      item.labels.some((label) => label.name === "type:task"),
  );
  if (untracked.length) {
    console.error(`UNTRACKED: ${untracked.map((item) => `#${item.number}`).join(", ")}`);
    drift = true;
  }
  if (drift) process.exit(1);
}

function itemsHas(graph: WorkGraph, issue: number) {
  return graph.items.some((item) => item.issue === issue);
}
