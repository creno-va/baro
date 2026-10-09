import { resolve } from "node:path";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../src/contracts";
import {
  prepareV2RestoreReplay,
  v2RestoreJournalSchema,
} from "../src/server/modules/deletion/restore";
import { deletionJournalSchema } from "../src/server/modules/deletion/service";

// Isolated #19 manifest contract. No remote restore, dispatch or cloud transport is wired to it.
// Resource identity must come from trusted operator configuration, not from the journal itself.
const isolatedName = z.string().regex(/^baro-drill-[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/);
const protectedDatabases = new Set([
  "e8cdcf75-5bd8-469e-848e-f31816df4327", // General preview, never an isolated restore target.
  "d315e93f-2fac-4cc2-bf99-e9d6eb31523f", // Production.
]);
export const isolatedDrillResourceSchema = z.strictObject({
  environment: z.literal("isolated-test"),
  syntheticOnly: z.literal(true),
  databaseId: uuidSchema
    .transform((id) => id.toLowerCase())
    .refine((id) => !protectedDatabases.has(id), "Protected database"),
  databaseName: isolatedName,
  workerName: isolatedName,
  workflowName: isolatedName,
});
const manifestContentSchema = z.strictObject({
  version: z.literal(1),
  candidateSha: z.string().regex(/^[a-f0-9]{40}$/),
  resource: isolatedDrillResourceSchema,
  exportedAt: timestampSchema,
  journal: deletionJournalSchema.superRefine((jobs, context) => {
    const ids = new Set<string>();
    for (const job of jobs) {
      if (ids.has(job.id)) context.addIssue({ code: "custom", message: "Duplicate journal ID" });
      ids.add(job.id);
      if (new Set(job.workflow_instance_ids).size !== job.workflow_instance_ids.length)
        context.addIssue({ code: "custom", message: "Duplicate Workflow ID" });
      if (Date.parse(job.expires_at) <= Date.parse(job.deleted_at))
        context.addIssue({ code: "custom", message: "Invalid journal retention interval" });
    }
  }),
});
export const isolatedJournalManifestSchema = manifestContentSchema.extend({
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
type ManifestContent = z.infer<typeof manifestContentSchema>;
// Canonical field/key order and sorting make the checksum independent of JSON formatting.
function canonicalContent(content: ManifestContent) {
  return JSON.stringify({
    version: content.version,
    candidateSha: content.candidateSha,
    resource: content.resource,
    exportedAt: content.exportedAt,
    journal: [...content.journal]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((job) => ({ ...job, workflow_instance_ids: [...job.workflow_instance_ids].sort() })),
  });
}
async function manifestChecksum(content: ManifestContent) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalContent(content)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function createIsolatedJournalManifest(input: unknown) {
  const content = manifestContentSchema.parse(input);
  if (content.journal.some((job) => Date.parse(job.deleted_at) > Date.parse(content.exportedAt)))
    throw new Error("JOURNAL_EXPORT_PRECEDES_DELETION");
  return { ...content, checksumSha256: await manifestChecksum(content) };
}
/** A checksum proves integrity only; it does not prove provenance, isolation or latest export. */
export async function validateIsolatedJournalManifest(
  input: unknown,
  expected: {
    resource: z.infer<typeof isolatedDrillResourceSchema>;
    candidateSha: string;
    exportedNotBefore: string;
    now: string;
  },
) {
  const manifest = isolatedJournalManifestSchema.parse(input);
  const resource = isolatedDrillResourceSchema.parse(expected.resource);
  manifestContentSchema.shape.candidateSha.parse(expected.candidateSha);
  const notBefore = Date.parse(timestampSchema.parse(expected.exportedNotBefore));
  const now = Date.parse(timestampSchema.parse(expected.now));
  if (notBefore > now) throw new Error("JOURNAL_INVALID_EXPORT_WINDOW");
  if (
    manifest.candidateSha !== expected.candidateSha ||
    JSON.stringify(manifest.resource) !== JSON.stringify(resource)
  )
    throw new Error("JOURNAL_SCOPE_MISMATCH");
  const exported = Date.parse(manifest.exportedAt);
  if (exported < notBefore || exported > now) throw new Error("JOURNAL_EXPORT_OUTSIDE_WINDOW");
  const { checksumSha256, ...content } = manifest;
  if (content.journal.some((job) => Date.parse(job.deleted_at) > exported))
    throw new Error("JOURNAL_EXPORT_PRECEDES_DELETION");
  if (checksumSha256 !== (await manifestChecksum(content)))
    throw new Error("JOURNAL_CHECKSUM_MISMATCH");
  return manifest;
}

const v2ManifestContentSchema = z.strictObject({
  version: z.literal(2),
  candidateSha: manifestContentSchema.shape.candidateSha,
  resource: isolatedDrillResourceSchema,
  exportedAt: timestampSchema,
  journal: v2RestoreJournalSchema,
});
const v2ManifestSchema = v2ManifestContentSchema.extend({
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
async function v2Checksum(content: z.infer<typeof v2ManifestContentSchema>) {
  const sorted = Object.fromEntries(
    Object.entries(content.journal).map(([key, rows]) => [
      key,
      [...rows].sort((a, b) => {
        const left = JSON.stringify(a),
          right = JSON.stringify(b);
        return left < right ? -1 : left > right ? 1 : 0;
      }),
    ]),
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({ ...content, journal: sorted })),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function createIsolatedV2JournalManifest(input: unknown) {
  const content = v2ManifestContentSchema.parse(input);
  if (content.journal.journals.some((j) => j.created_at > content.exportedAt))
    throw new Error("JOURNAL_EXPORT_PRECEDES_DELETION");
  return { ...content, checksumSha256: await v2Checksum(content) };
}
/** Expected scope comes from trusted operator configuration, separately from the export. */
export async function prepareIsolatedV2Replay(input: unknown, expectedInput: unknown) {
  const expected = z
    .strictObject({
      resource: isolatedDrillResourceSchema,
      candidateSha: manifestContentSchema.shape.candidateSha,
      exportedNotBefore: timestampSchema,
      now: timestampSchema,
      trafficClosed: z.literal(true),
      targetEnvironment: z.enum(["preview", "production"]),
      inventoryHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .parse(expectedInput);
  const manifest = v2ManifestSchema.parse(input);
  if (
    manifest.candidateSha !== expected.candidateSha ||
    JSON.stringify(manifest.resource) !== JSON.stringify(expected.resource)
  )
    throw new Error("JOURNAL_SCOPE_MISMATCH");
  if (
    expected.exportedNotBefore > expected.now ||
    manifest.exportedAt < expected.exportedNotBefore ||
    manifest.exportedAt > expected.now
  )
    throw new Error("JOURNAL_EXPORT_OUTSIDE_WINDOW");
  if (manifest.journal.journals.some((j) => j.created_at > manifest.exportedAt))
    throw new Error("JOURNAL_EXPORT_PRECEDES_DELETION");
  const { checksumSha256, ...content } = manifest;
  if (checksumSha256 !== (await v2Checksum(content))) throw new Error("JOURNAL_CHECKSUM_MISMATCH");
  return prepareV2RestoreReplay(manifest.journal, {
    trafficClosed: true,
    environment: expected.targetEnvironment,
    now: expected.now,
    ...(expected.inventoryHash === undefined ? {} : { inventoryHash: expected.inventoryHash }),
  })
    .map((sql) => `${sql};`)
    .join("\n");
}

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
${job.target_type === "account" ? `DELETE FROM app_metadata WHERE key=${literal(`account-type:${job.target_id}`)} AND EXISTS(SELECT 1 FROM deletion_jobs WHERE id=${literal(job.id)} AND target_type='account' AND target_id=${literal(job.target_id)});\n` : ""}DELETE FROM ${job.target_type === "account" ? "user" : "cases"} WHERE id=${literal(job.target_id)};`,
    )
    .join("\n");
}
if (import.meta.main) {
  try {
    const [mode, file, output, destination] = Bun.argv.slice(2);
    if (!file) throw new Error();
    if (mode === "prepare-v2" && output && destination) {
      const sql = await prepareIsolatedV2Replay(
        await Bun.file(protectedPath(file)).json(),
        await Bun.file(protectedPath(output)).json(),
      );
      await Bun.write(protectedPath(destination), sql);
      console.log(
        "V2 replay prepared for an isolated target. Traffic stays closed; no remote operation was executed.",
      );
    } else if (mode === "prepare" && output) {
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
      "JOURNAL_OPERATION_FAILED: use export-preview <.wrangler/file.json> or prepare <.wrangler/file.json> <.wrangler/replay.sql> or prepare-v2 <.wrangler/manifest.json> <.wrangler/trusted-scope.json> <.wrangler/replay.sql>; source remains preserved.",
    );
    process.exitCode = 1;
  }
}
