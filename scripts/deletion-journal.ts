import { resolve } from "node:path";
import { deletionJournalSchema } from "../src/server/modules/deletion/service";

// Operator-only preparation. Never applies a restore or opens traffic.
// Keep opaque export/replay files in the ignored .wrangler directory, not CI artifacts.
function protectedPath(value: string) {
  const root = resolve(".wrangler");
  const path = resolve(value);
  if (!path.startsWith(`${root}/`) && !path.startsWith(`${root}\\`))
    throw new Error("JOURNAL_PATH_NOT_PRIVATE");
  return path;
}
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
export function prepareReplay(input: unknown) {
  const jobs = deletionJournalSchema.parse(input);
  return jobs
    .map(
      (
        job,
      ) => `INSERT INTO deletion_jobs(id,target_type,target_id,deleted_at,workflow_instance_ids,primary_state,cleanup_state,attempts,expires_at)
VALUES(${literal(job.id)},${literal(job.target_type)},${literal(job.target_id)},${literal(job.deleted_at)},${literal(JSON.stringify(job.workflow_instance_ids))},'deleted','pending',0,${literal(job.expires_at)})
ON CONFLICT(id) DO UPDATE SET cleanup_state='pending',attempts=0,cleanup_cursor=0,next_attempt_at='1970-01-01T00:00:00.000Z';
DELETE FROM ${job.target_type === "account" ? "user" : "cases"} WHERE id=${literal(job.target_id)};`,
    )
    .join("\n");
}
if (import.meta.main) {
  try {
    const [mode, file, output] = Bun.argv.slice(2);
    if (!file) throw new Error();
    if (mode === "prepare" && output) {
      await Bun.write(
        protectedPath(output),
        prepareReplay(await Bun.file(protectedPath(file)).json()),
      );
      console.log("Opaque replay prepared. Traffic must remain closed; no restore was executed.");
    } else if (mode === "export-preview") {
      const child = Bun.spawn(
        [
          "bunx",
          "wrangler",
          "d1",
          "execute",
          "DB",
          "--env",
          "preview",
          "--remote",
          "--json",
          "--command",
          "SELECT id,target_type,target_id,deleted_at,workflow_instance_ids,expires_at FROM deletion_jobs WHERE primary_state='deleted' ORDER BY id",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const raw = await new Response(child.stdout).text();
      await new Response(child.stderr).text();
      if ((await child.exited) !== 0) throw new Error();
      const response = JSON.parse(raw) as { results: Record<string, unknown>[] }[];
      const jobs = deletionJournalSchema.parse(
        response
          .flatMap((r) => r.results)
          .map((r) => ({
            ...r,
            workflow_instance_ids: JSON.parse(String(r.workflow_instance_ids)),
          })),
      );
      await Bun.write(protectedPath(file), JSON.stringify(jobs));
      console.log(
        `Opaque preview journal exported: ${jobs.length} entries. Store independently of the restore target.`,
      );
    } else throw new Error();
  } catch {
    console.error(
      "JOURNAL_OPERATION_FAILED: use export-preview <.wrangler/file.json> or prepare <.wrangler/file.json> <.wrangler/replay.sql>; source remains preserved.",
    );
    process.exitCode = 1;
  }
}
