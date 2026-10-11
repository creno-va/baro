import { expect, test } from "bun:test";
import { createReportsClient, domainRequest } from "../src/client/api/reports";
import { reportHttpFixture } from "./helpers/report-http-fixture";

async function fixture() {
  const f = await reportHttpFixture();
  const posts: { body: string; key: string | null }[] = [];
  let loseResponse = false;
  const client = createReportsClient(
    domainRequest(async (path, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("cookie", f.cookie);
      headers.set("origin", f.env.BETTER_AUTH_URL);
      if (init.method === "POST")
        posts.push({ body: String(init.body), key: headers.get("idempotency-key") });
      const response = await f.app.request(path, { ...init, headers }, f.env);
      if (init.method === "POST" && response.ok && loseResponse) {
        loseResponse = false;
        throw new Error("Synthetic generation response loss");
      }
      return response;
    }),
  );
  return {
    ...f,
    client,
    posts,
    lose: () => {
      loseResponse = true;
    },
  };
}

test("generation rejects the displayed version after a background metadata refresh", async () => {
  const f = await fixture();
  const displayed = await f.client.get(f.workspaceId);
  const peer = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: displayed.revision,
    content: "Synthetic unseen peer review",
    excludedFileIds: [],
    maskIdentifiers: false,
  });
  await f.client.get(f.workspaceId);
  await expect(
    f.client.generate(f.workspaceId, undefined, displayed.revision),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(JSON.parse(f.posts[0]?.body ?? "{}").expectedRevision).toBe(displayed.revision);
  expect(await f.reports.get(f.actor.ownerId, f.workspaceId)).toMatchObject({
    id: peer.id,
    revision: peer.revision,
    content: peer.content,
  });
  const generated = await f.client.generate(f.workspaceId);
  expect(generated.revision).toBe(peer.revision + 1);
});

for (const explicit of [false, true])
  test(`generation response-loss retry preserves its basis across refresh (explicit=${explicit})`, async () => {
    const f = await fixture();
    const displayed = await f.client.get(f.workspaceId);
    const revision = explicit ? displayed.revision : undefined;
    f.lose();
    await expect(f.client.generate(f.workspaceId, undefined, revision)).rejects.toThrow(
      "Synthetic generation response loss",
    );
    const committed = await f.client.get(f.workspaceId);
    const replay = await f.client.generate(f.workspaceId, undefined, revision);
    expect(replay.id).toBe(committed.id);
    expect(replay.revision).toBe(displayed.revision + 1);
    expect(f.posts[1]).toEqual(f.posts[0]);
    const fresh = await f.client.generate(f.workspaceId);
    expect(fresh.revision).toBe(replay.revision + 1);
    expect(f.posts[2]?.key).not.toBe(f.posts[1]?.key);
    expect(JSON.parse(f.posts[2]?.body ?? "{}").expectedRevision).toBe(replay.revision);
  });

test("changed source selections identify a fresh generation after an ambiguous failure", async () => {
  const f = await fixture();
  await f.client.get(f.workspaceId);
  f.lose();
  await expect(f.client.generate(f.workspaceId)).rejects.toThrow(
    "Synthetic generation response loss",
  );
  const committed = await f.client.get(f.workspaceId);
  const changed = await f.client.generate(f.workspaceId, [f.selectedFileId]);
  expect(changed.revision).toBe(committed.revision + 1);
  expect(changed.excludedFileIds).toEqual([f.selectedFileId]);
  expect(f.posts[1]?.key).not.toBe(f.posts[0]?.key);
  expect(JSON.parse(f.posts[1]?.body ?? "{}").expectedRevision).toBe(committed.revision);
});
