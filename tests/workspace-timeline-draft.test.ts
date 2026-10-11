import { expect, test } from "bun:test";
import { createWorkspaceApi } from "../src/client/api/workspace";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { createWorkspaceService } from "../src/server/modules/workspace/service";
import { reportHttpFixture } from "../tests/helpers/report-http-fixture";

test("workspace refresh preserves the revision of an open timeline draft", async () => {
  const f = await reportHttpFixture();
  const service = createWorkspaceService(f.core, { clock: () => f.actor.now });
  f.app.route(
    "/api/v2/cases",
    createWorkspacesApi({ dependencies: async () => ({ clock: () => f.actor.now }) }),
  );
  const owner = f.actor.ownerId,
    id = f.workspaceId;
  const original = await service.createTimeline(owner, id, crypto.randomUUID(), {
    expectedRevision: f.rev(),
    date: "2026-10-06",
    datePrecision: "day",
    event: "Synthetic original event\nOriginal detail",
  });
  const transport = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", f.cookie);
    headers.set("origin", f.env.BETTER_AUTH_URL);
    return f.app.request(path, { ...init, headers }, f.env);
  };
  const client = createWorkspaceApi(transport, null);
  const before = await client.get(id);
  const displayed = before.timeline.find((e) => e.id === original.id);
  expect(displayed).toBeDefined();
  if (!displayed) throw new Error("MISSING_SYNTHETIC_TIMELINE");
  const peer = await service.editTimeline(owner, id, original.id, crypto.randomUUID(), {
    expectedRevision: original.revision,
    date: "2026-10-06",
    datePrecision: "day",
    event: "Synthetic peer correction\nPeer detail",
  });
  const draft = { ...displayed, title: "Synthetic old-screen correction" };
  let baselineCode = "";
  try {
    await client.saveTimeline(id, draft);
  } catch (e) {
    baselineCode = (e as { code: string }).code;
  }
  expect(baselineCode).toBe("CONFLICT");
  const refreshed = await client.get(id);
  expect(refreshed.timeline.find((e) => e.id === original.id)?.title).toBe(
    "Synthetic peer correction",
  );
  await expect(client.saveTimeline(id, draft)).rejects.toMatchObject({ code: "CONFLICT" });
  const preserved = await client.get(id);
  expect(preserved.timeline.find((e) => e.id === original.id)?.title).toBe(
    "Synthetic peer correction",
  );
  expect(preserved.timeline.find((e) => e.id === original.id)?.detail).toBe("Peer detail");
  expect(preserved.timeline.find((e) => e.id === original.id)?.revision).toBe(peer.revision);
});
