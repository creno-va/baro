import { expect, test } from "bun:test";
import { createFileRetry } from "../src/server/modules/file-processing/retry";
import { fixture, uploaded } from "./helpers/file-processing-fixture";

for (const admitted of [false, true])
  test(`deferred upload uses its existing file operation and preserves admission gate=${admitted}`, async () => {
    const f = await fixture(),
      u = await uploaded(f);
    expect(u.complete.processingQueued).toBe(false);
    const original = (await f.service.list(f.actor.ownerId, f.workspaceId))[0];
    const calls: { operationId: string; fileId: string }[] = [];
    const retry = createFileRetry(f.core, { APP_ENV: "preview" } as Env, {
      clock: () => f.actor.now,
      enqueueProcessing: async (input) => {
        calls.push(input);
        return admitted;
      },
    });
    const input = { expectedRevision: f.rev(), fileRevision: 2 };
    await expect(
      retry(crypto.randomUUID(), f.workspaceId, u.session.fileId, input),
    ).rejects.toMatchObject({ code: "PROCESSING_UNAVAILABLE" });
    await expect(
      retry(f.actor.ownerId, f.workspaceId, u.session.fileId, { ...input, fileRevision: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(calls).toHaveLength(0);
    const attempt = retry(f.actor.ownerId, f.workspaceId, u.session.fileId, input);
    if (admitted) expect((await attempt)?.operationId).toBe(original?.operationId);
    else await expect(attempt).rejects.toMatchObject({ code: "PROCESSING_UNAVAILABLE" });
    expect(calls).toEqual([
      expect.objectContaining({ operationId: original?.operationId, fileId: u.session.fileId }),
    ]);
    expect((await f.service.list(f.actor.ownerId, f.workspaceId))[0]?.status).toBe("uploaded");
  });
