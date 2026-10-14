import { expect, test } from "bun:test";
import { reindexDirectory } from "../scripts/reindex-directory";
import { directoryMaintenanceSchema } from "../src/server/modules/lawyers/directory-maintenance";

test("operator reindex uses a content-bound retry ID and emits only sanitized completion counts", async () => {
  const sha = "a".repeat(40),
    paths: string[] = [],
    bodies: string[] = [];
  const env = {
    DIRECTORY_ENVIRONMENT: "preview",
    DIRECTORY_SHA: sha,
    CLOUDFLARE_API_TOKEN: "synthetic-token",
    CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  };
  const fetcher = (async (url, init) => {
    paths.push(String(url));
    if (init?.method === "POST") {
      bodies.push(String(init.body));
      return new Response(null, { status: 409 });
    }
    return Response.json({
      success: true,
      result: {
        status: "complete",
        output: { processed: 0, indexed: 0, next: null, releaseSha: sha },
      },
    });
  }) as typeof fetch;
  expect(await reindexDirectory(env, fetcher)).toMatchObject({ processed: 0, indexed: 0 });
  await reindexDirectory(env, fetcher);
  expect(bodies[0]).toBe(bodies[1]);
  expect(paths[1]).toBe(paths[3]);
  const params = JSON.parse(bodies[0] ?? "{}").params;
  expect(params.expectedReleaseSha).toBe(sha);
  expect(params.maximumProfiles).toBe(10000);
  expect(directoryMaintenanceSchema.safeParse({ ...params, maximumProfiles: 10001 }).success).toBe(
    false,
  );
  await expect(
    reindexDirectory(env, (async (_url: RequestInfo | URL) =>
      Response.json({
        success: true,
        result: { status: "errored", error: { message: "private error" } },
      })) as typeof fetch),
  ).rejects.toThrow("DIRECTORY_MAINTENANCE_STOPPED");
});
