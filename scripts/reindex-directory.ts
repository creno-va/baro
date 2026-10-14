import { z } from "zod";
import { runtimeDigest } from "../src/server/db/v2-paid-runtime";
import { directoryMaintenanceSchema } from "../src/server/modules/lawyers/directory-maintenance";

/** Authenticated operator port, never an HTTP product endpoint. Outputs only
 * counts and instance references; no profile payloads or credentials. */
export async function reindexDirectory(env: Record<string, string | undefined>, fetcher = fetch) {
  const target = z.enum(["preview", "production"]).parse(env.DIRECTORY_ENVIRONMENT);
  const params = directoryMaintenanceSchema.parse({
    maintenance: "directory-index",
    expectedReleaseSha: env.DIRECTORY_SHA,
    maximumProfiles: 10000,
    ...(env.DIRECTORY_AFTER ? { after: env.DIRECTORY_AFTER } : {}),
  });
  const token = z.string().min(1).parse(env.CLOUDFLARE_API_TOKEN);
  const account = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .parse(env.CLOUDFLARE_ACCOUNT_ID);
  const id = `directory-${(await runtimeDigest(params)).slice(0, 40)}`;
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workflows/baro-profile-publication-${target}/instances`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const created = await fetcher(base, {
    method: "POST",
    headers,
    body: JSON.stringify({ instance_id: id, params }),
    signal: AbortSignal.timeout(30000),
  });
  // A response loss is recovered using the same content-bound instance ID.
  if (!created.ok && created.status !== 409) throw new Error("DIRECTORY_TRIGGER_FAILED");
  for (let attempt = 0; attempt < 90; attempt++) {
    const response = await fetcher(`${base}/${id}`, {
      headers,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error("DIRECTORY_STATUS_UNAVAILABLE");
    const body = z
      .object({
        success: z.literal(true),
        result: z.object({ status: z.string(), output: z.unknown().optional() }),
      })
      .parse(await response.json());
    if (body.result.status === "complete") {
      const output = z
        .strictObject({
          processed: z.number().int().min(0).max(10000),
          indexed: z.number().int().min(0).max(10000),
          next: z.string().nullable(),
          releaseSha: z.literal(params.expectedReleaseSha),
        })
        .parse(body.result.output);
      console.info(JSON.stringify({ environment: target, instanceId: id, ...output }));
      if (output.next) throw new Error("DIRECTORY_CONTINUATION_REQUIRED");
      return output;
    }
    if (!["queued", "running", "waiting"].includes(body.result.status))
      throw new Error("DIRECTORY_MAINTENANCE_STOPPED");
    await Bun.sleep(10000);
  }
  throw new Error("DIRECTORY_MAINTENANCE_PENDING");
}
if (import.meta.main)
  try {
    await reindexDirectory(process.env);
  } catch {
    console.error(
      "Directory reindex incomplete; inspect the authenticated Workflow instance before retrying.",
    );
    process.exitCode = 1;
  }
