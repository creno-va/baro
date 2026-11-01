import { expect, test } from "bun:test";
import { createFilesApi } from "../src/client/api/files";
import { createFilesMock } from "../src/client/api/mock/files";
import { createWorkspaceMock, type WorkspaceMockRuntime } from "../src/client/api/mock/workspace";
import { workspaceViewSchema } from "../src/client/api/workspace";

async function fixture(text: string) {
  let raw = JSON.stringify({
    session: {
      user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
      needsConsent: false,
    },
    cases: {
      demo: {
        id: "demo",
        title: "Synthetic case",
        subjectContext: "individual",
        stage: "active",
        revision: 1,
        updatedAt: "2026-10-01T00:00:00Z",
        summary: "Synthetic confirmed facts",
        schemaVersion: "2",
      },
    },
    workspace: {},
    files: {},
  });
  const runtime: WorkspaceMockRuntime = {
    read: () => JSON.parse(raw),
    update: (fn) => {
      const state = JSON.parse(raw);
      const result = fn(state);
      raw = JSON.stringify(state);
      return result;
    },
  };
  const blobs = new Map<string, Blob>();
  const originals = async (key: string, value?: Blob | null) => {
    if (value === null) blobs.delete(key);
    else if (value) blobs.set(key, value);
    return blobs.get(key) ?? null;
  };
  const files = createFilesMock(runtime, originals),
    workspace = createWorkspaceMock(runtime);
  const send = async (path: string, init: RequestInit = {}) =>
    (await files(new Request(`http://localhost${path}`, init))) ??
    (await workspace(new Request(`http://localhost${path}`, init))) ??
    Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  const client = createFilesApi(send);
  const uploaded = await client.upload(
    "demo",
    new File([text], "synthetic-long.txt", { type: "text/plain" }),
  );
  runtime.update((state) => {
    for (const pending of Object.values(state.fileProcessing ?? {})) pending.at = 0;
  });
  expect((await client.list("demo"))[0]?.status).toBe("ready");
  return { client, uploaded, send, reconnect: () => createFilesApi(send) };
}

test("mock upload identity stays consistent across completion, list, workspace and review edits", async () => {
  const text = "Synthetic original with an unconfirmed date";
  const f = await fixture(text);
  const before = await f.client.review("demo", f.uploaded.id);
  const listed = (await f.reconnect().list("demo"))[0];
  const workspace = workspaceViewSchema.parse(
    await (await f.send("/api/v2/cases/demo/workspace")).json(),
  );
  expect(f.uploaded.revision).toBe(1);
  expect(listed?.revision).toBe(before.file.revision);
  expect(workspace.files[0]?.revision).toBe(before.file.revision);
  expect(listed?.uploadContentHash).toBe(f.uploaded.uploadContentHash);
  const progress = await f.client.saveReview(
    "demo",
    f.uploaded.id,
    {
      expectedRevision: before.file.revision,
      edits: [
        { observationId: before.observations[0]?.value.id ?? "missing", text, included: false },
      ],
    },
    before.workspaceRevision,
  );
  const after = await f.reconnect().review("demo", f.uploaded.id);
  const current = (await f.client.list("demo"))[0];
  expect(progress.revision).toBe(2);
  expect(after.file.revision).toBe(progress.revision);
  expect(current?.revision).toBe(progress.revision);
  expect(current?.uploadContentHash).toBe(listed?.uploadContentHash);
  expect(after.observations[0]?.value.included).toBe(false);
  expect(after.observations[0]?.original).toEqual(before.observations[0]?.original);
  expect(await (await f.client.original("demo", f.uploaded.id)).text()).toBe(text);
});

for (const text of [
  "a".repeat(5000),
  "a".repeat(5001),
  "a".repeat(20000),
  "a".repeat(4999) + "😀".repeat(2501),
]) {
  test(`mock uploaded text is fully reviewable at ${[...text].length} code points`, async () => {
    const f = await fixture(text);
    const view = await f.client.review("demo", f.uploaded.id);
    expect(view.observations.length).toBe(Math.ceil([...text].length / 5000));
    expect(view.observations.map((row) => row.value.text).join("")).toBe(text);
    expect(view.observations.map((row) => row.original.text).join("")).toBe(text);
    expect(new Set(view.observations.map((row) => row.value.id)).size).toBe(
      view.observations.length,
    );
    for (const [index, row] of view.observations.entries()) {
      expect(row.ordinal).toBe(index);
      expect([...row.value.text].length).toBeLessThanOrEqual(5000);
      expect(row.value.text).not.toContain("�");
    }
    expect(await (await f.client.original("demo", f.uploaded.id)).text()).toBe(text);
    expect((await f.reconnect().review("demo", f.uploaded.id)).observations).toEqual(
      view.observations,
    );
  });
}

test("mock chunk edits and exclusions persist while original observations and bytes stay unchanged", async () => {
  const text = `${"a".repeat(5000)}${"b".repeat(5000)}c`;
  const f = await fixture(text);
  const before = await f.client.review("demo", f.uploaded.id);
  const progress = await f.client.saveReview(
    "demo",
    f.uploaded.id,
    {
      expectedRevision: before.file.revision,
      edits: [
        {
          observationId: before.observations[0]?.value.id ?? "missing",
          text: "Synthetic corrected first chunk",
          included: true,
        },
        {
          observationId: before.observations[1]?.value.id ?? "missing",
          text: before.observations[1]?.value.text ?? "missing",
          included: false,
        },
      ],
    },
    before.workspaceRevision,
  );
  expect(progress.status).toBe("ready");
  const after = await f.reconnect().review("demo", f.uploaded.id);
  expect(after.observations.map((row) => row.original)).toEqual(
    before.observations.map((row) => row.original),
  );
  expect(after.observations[0]?.value).toMatchObject({
    text: "Synthetic corrected first chunk",
    userEdited: true,
  });
  expect(after.observations[1]?.value.included).toBe(false);
  expect(after.observations[2]).toEqual(before.observations[2]);
  expect((await f.client.list("demo"))[0]?.extractedText).toBe(
    "Synthetic corrected first chunk\nc",
  );
  expect(await (await f.client.original("demo", f.uploaded.id)).text()).toBe(text);
});
