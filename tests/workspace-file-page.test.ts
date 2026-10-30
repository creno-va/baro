import { expect, test } from "bun:test";
import { createWorkspaceApi } from "../src/client/api/workspace";
import { assistantMessage, summary, workspace } from "./fixtures/contracts/v2";

const metadata = (id: string, status = "ready") => ({
  id,
  name: `${id}.pdf`,
  revision: 2,
  declaredMediaType: "application/pdf",
  byteLength: 25_842,
  status,
  createdAt: workspace.createdAt,
  failure: null,
  ...(status === "queued"
    ? { processing: { status: "running", phase: "extracting", updatedAt: workspace.updatedAt } }
    : {}),
});

test("files page reads only the exact workspace, metadata and final workspace without summary or ready bodies", async () => {
  const calls: string[] = [];
  const client = createWorkspaceApi(async (path) => {
    calls.push(path);
    if (path.endsWith("/workspace")) return Response.json(workspace);
    if (path.endsWith("/files"))
      return Response.json([metadata("ready-original"), metadata("accepted-video", "queued")]);
    throw new Error("Synthetic global summary/body read must not run");
  });
  for (let i = 0; i < 2; i++) {
    calls.length = 0;
    const view = await client.getFiles(workspace.id);
    expect(calls.map((path) => path.split("/").at(-1))).toEqual([
      "workspace",
      "files",
      "workspace",
    ]);
    expect(view.case).toMatchObject({
      id: workspace.id,
      revision: workspace.workspaceRevision,
      stage: "active",
    });
    expect(view.files).toHaveLength(2);
    expect(view.files[0]).toMatchObject({
      status: "ready",
      extractedText: "",
      coverage: "자료 확인에서 처리 범위를 확인할 수 있어요.",
    });
    expect(view.files[1]).toMatchObject({
      status: "processing",
      processing: { phase: "extracting" },
    });
  }
});

for (const change of ["revision", "case", "deleted", "session", "role"] as const)
  test(`files page discards metadata when the final boundary changes: ${change}`, async () => {
    const calls: string[] = [];
    let reads = 0;
    const client = createWorkspaceApi(async (path) => {
      calls.push(path);
      if (path.endsWith("/files")) return Response.json([metadata("private-original")]);
      if (path.endsWith("/workspace")) {
        if (++reads === 1) return Response.json(workspace);
        if (change === "revision")
          return Response.json({
            ...workspace,
            workspaceRevision: workspace.workspaceRevision + 1,
          });
        if (change === "case") return Response.json({ ...workspace, id: "other-case" });
        const status = change === "session" ? 401 : change === "role" ? 403 : 404;
        return Response.json(
          { error: { code: change === "role" ? "ROLE_REQUIRED" : "NOT_FOUND" } },
          { status },
        );
      }
      throw new Error("Unexpected synthetic route");
    });
    await expect(client.getFiles(workspace.id)).rejects.toBeInstanceOf(Error);
    expect(calls).toHaveLength(3); // No recovery loop or extra IO.
  });

test("files page case changes never reuse another case's files or global snapshot", async () => {
  const client = createWorkspaceApi(async (path) => {
    const id = path.split("/")[4];
    if (path.endsWith("/workspace")) return Response.json({ ...workspace, id });
    if (path.endsWith("/files")) return Response.json([metadata(`${id}-original`)]);
    throw new Error("Unexpected synthetic route");
  });
  expect((await client.getFiles("first-case")).files.map((file) => file.id)).toEqual([
    "first-case-original",
  ]);
  expect((await client.getFiles("second-case")).files.map((file) => file.id)).toEqual([
    "second-case-original",
  ]);
  expect((await client.getFiles("first-case")).files.map((file) => file.id)).toEqual([
    "first-case-original",
  ]);
});

test("files metadata pagination preserves order and final workspace fence without loading ready bodies", async () => {
  const paths: string[] = [];
  const client = createWorkspaceApi(async (path) => {
    paths.push(path);
    if (path.endsWith("/workspace")) return Response.json(workspace);
    if (path.endsWith("/files"))
      return Response.json(Array.from({ length: 20 }, (_, i) => metadata(`file-${i}`)));
    if (path.endsWith("/files?afterId=file-19")) return Response.json([metadata("file-last")]);
    throw new Error("Unexpected synthetic route");
  });
  expect((await client.getFiles(workspace.id)).files).toHaveLength(21);
  expect(paths).toHaveLength(4);
  expect(paths.at(-1)).toContain("/workspace");
});

test("files-page retry preserves exact ACK and both metadata checks without opening other ready bodies", async () => {
  const { createFilesApi } = await import("../src/client/api/files");
  let lists = 0,
    writes = 0,
    accepted = 0;
  const client = createFilesApi(async (path, init) => {
    if (path.endsWith("/workspace")) return Response.json({ workspaceRevision: 4 });
    if (path.endsWith("/files")) {
      lists++;
      return Response.json([
        metadata("other-ready"),
        metadata("selected", lists === 1 ? "failed" : "queued"),
      ]);
    }
    if (path.endsWith("/selected/retry")) {
      writes++;
      expect(JSON.parse(String(init?.body))).toMatchObject({
        fileRevision: 2,
        expectedRevision: 4,
      });
      expect(init?.method).toBe("POST");
      return Response.json(metadata("selected", "queued"), { status: 202 });
    }
    throw new Error("Unexpected ready body read");
  });
  const result = await client.retry(
    workspace.id,
    "selected",
    () => {
      expect(lists).toBe(1);
      accepted++;
    },
    { metadataOnly: true },
  );
  expect(result.id).toBe("selected");
  expect(lists).toBe(2);
  expect(writes).toBe(1);
  expect(accepted).toBe(1);
});

test("files-page upload keeps reservation, original bytes and exact ACK readback without ready body reads", async () => {
  const { createFilesApi } = await import("../src/client/api/files");
  const original = new File(["synthetic upload bytes"], "new.txt", { type: "text/plain" });
  let lists = 0,
    reservations = 0,
    parts = 0,
    completes = 0;
  const client = createFilesApi(async (path, init) => {
    if (path.endsWith("/workspace")) return Response.json({ workspaceRevision: 4 });
    if (path.endsWith("/files") && init?.method === "POST") {
      reservations++;
      expect(new Headers(init.headers).get("if-match")).toBe("4");
      return Response.json({
        schemaVersion: "2",
        fileId: "selected",
        uploadSession: "upload-selected",
        chunkBytes: 8388608,
        reservedBytes: original.size,
        expiresAt: "2026-12-01T00:00:00.000Z",
      });
    }
    if (path.endsWith("/files")) {
      lists++;
      return Response.json([
        metadata("other-ready"),
        ...(lists > 1 ? [metadata("selected", completes ? "queued" : "uploading")] : []),
      ]);
    }
    if (path.endsWith("/parts/0")) {
      parts++;
      expect(new Headers(init?.headers).get("x-upload-session")).toBe("upload-selected");
      expect(await new Response(init?.body).text()).toBe(await original.text());
      return Response.json({ accepted: true });
    }
    if (path.endsWith("/complete")) {
      completes++;
      expect(JSON.parse(String(init?.body))).toMatchObject({
        expectedRevision: 4,
        uploadSession: "upload-selected",
        manifest: { byteLength: original.size },
      });
      return Response.json({ accepted: true });
    }
    throw new Error("Unexpected ready body read");
  });
  expect((await client.upload(workspace.id, original, undefined, { metadataOnly: true })).id).toBe(
    "selected",
  );
  expect([lists, reservations, parts, completes]).toEqual([2, 1, 1, 1]);
});

test("explicit evidence view reads bounded references with the same final workspace fence", async () => {
  const calls: string[] = [];
  const ref = {
    kind: "user_material",
    fileId: "used-original",
    fileRevision: 2,
    position: { kind: "document", page: 1, paragraph: null, table: null },
  } as const;
  const client = createWorkspaceApi(async (path) => {
    calls.push(path);
    if (path.endsWith("/workspace")) return Response.json(workspace);
    if (path.endsWith("/files"))
      return Response.json([metadata("used-original"), metadata("unused-original")]);
    if (path.endsWith("/summary")) return Response.json(summary);
    if (path.includes("/messages?"))
      return Response.json({
        items: [{ ...assistantMessage, references: [ref] }],
        nextCursor: null,
      });
    throw new Error("Unexpected body or unrelated collection read");
  });
  const view = await client.getFiles(workspace.id, { evidence: true });
  expect(view.messages[0]?.references).toEqual([ref]);
  expect(view.facts).toEqual(summary.facts);
  expect(view.files).toHaveLength(2);
  expect(calls).toHaveLength(5);
  expect(calls.at(-1)).toContain("/workspace");
});
