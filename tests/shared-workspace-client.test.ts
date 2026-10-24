import { expect, test } from "bun:test";
import {
  ApiError,
  type CaseOperationStorage,
  createWorkspaceClient,
  type WorkspaceTransport,
} from "@baro/api-client";
import { createSessionBoundClient, createSessionScope } from "@baro/client-core";
import {
  assistantMessage,
  citation,
  intake,
  job,
  precedent,
  summary,
  workspace,
} from "./fixtures/contracts/v2";

const message = { expectedRevision: 3, text: "합성 질문입니다.", selectedFileIds: [] };
test("a wrapped held method retains its implementation until the account changes", async () => {
  const scope = createSessionScope();
  let instances = 0;
  const client = createSessionBoundClient(scope, () => {
    const owner = ++instances;
    return { get: async () => owner };
  });
  const original = client.get;
  client.get = async () => (await original()) + 10;
  expect(await client.get()).toBe(11);
  scope.invalidate();
  expect(await original()).toBe(2);
  expect(await client.get()).toBe(2);
  const fresh = client.get;
  client.get = async () => (await fresh()) + 20;
  expect(await client.get()).toBe(22);
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(
  options: {
    scope?: ReturnType<typeof createSessionScope>;
    coalesceWrites?: "credential-scope";
    listFiles?: () => Promise<[]>;
    jobStorage?: CaseOperationStorage;
    request?: WorkspaceTransport;
    messages?: unknown[];
  } = {},
) {
  const scope = options.scope ?? createSessionScope();
  const requests: { path: string; init: RequestInit | undefined }[] = [];
  const request: WorkspaceTransport = async (path, init) => {
    requests.push({ path, init });
    if (options.request) return options.request(path, init);
    if (init?.method === "POST")
      return Response.json(
        { operationId: job.operationId, jobId: job.id, status: "queued", retryAfter: 2 },
        { status: 202 },
      );
    if (path.endsWith("/workspace")) return Response.json(workspace);
    if (path.endsWith("/intake")) return Response.json(intake);
    if (path.endsWith("/summary")) return Response.json(summary);
    if (path.endsWith("/workspace-jobs/latest")) return Response.json(job);
    if (path.includes("/messages?"))
      return Response.json({ items: options.messages ?? [], nextCursor: null });
    if (path.endsWith("/actions") || path.endsWith("/timeline"))
      return Response.json({ items: [], nextCursor: null });
    throw new Error("UNEXPECTED_SYNTHETIC_PATH");
  };
  const client = createWorkspaceClient({
    request,
    scope,
    ...(options.coalesceWrites ? { coalesceWrites: options.coalesceWrites } : {}),
    newKey: () => crypto.randomUUID(),
    listFiles: options.listFiles ?? (async () => []),
    ...(options.jobStorage ? { jobStorage: options.jobStorage } : {}),
  });
  return { client, scope, requests };
}

test("displayed statute labels distinguish articles without changing source identities or HTTP data", async () => {
  const citations = [
    { ...citation, id: "source-598", sourceId: "article-598", title: "민법", article: "제598조" },
    { ...citation, id: "source-603", sourceId: "article-603", title: "민법", article: "제603조" },
    {
      ...citation,
      id: "already-named",
      sourceId: "article-named",
      title: "민법 제600조",
      article: "제600조",
    },
    { ...precedent, title: "판례의 기존 제목" },
  ];
  const input = {
    ...assistantMessage,
    citations,
    references: citations.map((c) => ({ kind: "official_source" as const, citationId: c.id })),
  };
  const original = JSON.stringify(input);
  const view = await fixture({ messages: [input] }).client.get(workspace.id);
  const projected = view.messages[0]?.citations ?? [];
  expect(projected.map((c) => c.title)).toEqual([
    "민법 · 제598조",
    "민법 · 제603조",
    "민법 제600조",
    "판례의 기존 제목",
  ]);
  expect(projected.map(({ id, url }) => ({ id, url }))).toEqual(
    citations.map(({ id, url }) => ({ id, url })),
  );
  for (const item of projected) expect(Object.keys(item).sort()).toEqual(["id", "title", "url"]);
  expect(JSON.stringify(input)).toBe(original);
  expect(view.messages[0]?.references).toEqual(input.references);
});

test("an owner change aborts pending metadata and rejects the old projection", async () => {
  const entered = deferred<void>(),
    pending = deferred<[]>();
  const f = fixture({
    listFiles: async () => {
      entered.resolve();
      return pending.promise;
    },
  });
  const result = f.client.get(workspace.id);
  const failed = result.catch((error: unknown) => error);
  await entered.promise;
  const firstSignal = f.requests[0]?.init?.signal;
  f.scope.transition("synthetic-other-owner");
  expect(firstSignal?.aborted).toBe(true);
  pending.resolve([]);
  expect(await failed).toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.requests.some(({ path }) => path.includes("workspace-jobs"))).toBe(false);
  const count = f.requests.length;
  await expect(f.client.sendMessage(workspace.id, message)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(f.requests).toHaveLength(count);
  expect((await fixture({ scope: f.scope }).client.get(workspace.id)).case.id).toBe(workspace.id);
});

test("mutation identities replay within one instance and remain separate across accounts", async () => {
  const keys: string[] = [];
  const request: WorkspaceTransport = async (_path, init) => {
    keys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
    throw new ApiError("UNAVAILABLE", "합성 응답 유실", true);
  };
  const a = fixture({ request }),
    b = fixture({ request });
  await expect(a.client.sendMessage(workspace.id, message)).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  await expect(a.client.sendMessage(workspace.id, message)).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  await expect(b.client.sendMessage(workspace.id, message)).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(keys[0]).toBe(keys[1]);
  expect(keys[0]).not.toBe(keys[2]);
});

test("parallel identical writes share one admission before asynchronous job persistence", async () => {
  const entered = deferred<void>(),
    release = deferred<void>();
  const records = new Map<string, string>();
  const f = fixture({
    coalesceWrites: "credential-scope",
    jobStorage: {
      getItem: async (key) => records.get(key) ?? null,
      setItem: async (key, value) => {
        entered.resolve();
        await release.promise;
        records.set(key, value);
      },
      removeItem: async (key) => {
        records.delete(key);
      },
    },
  });
  const first = f.client.sendMessage(workspace.id, message);
  const second = f.client.sendMessage(workspace.id, { ...message });
  await entered.promise;
  expect(f.requests.filter(({ init }) => init?.method === "POST")).toHaveLength(1);
  release.resolve();
  const results = await Promise.all([first, second]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]?.messages.at(-1)?.status).toBe("pending");
  expect([...records.values()]).toEqual([job.id]);
  expect(JSON.stringify([...records])).not.toContain(message.text);
});

test("unavailable recovery storage does not hide the server's authoritative latest job", async () => {
  const f = fixture({
    jobStorage: {
      getItem: async () => {
        throw new Error("SYNTHETIC_LOCKED_STORAGE");
      },
      setItem: async () => {
        throw new Error("SYNTHETIC_LOCKED_STORAGE");
      },
      removeItem: async () => {
        throw new Error("SYNTHETIC_LOCKED_STORAGE");
      },
    },
  });
  expect((await f.client.get(workspace.id)).messages.at(-1)?.id).toBe(`job:${job.id}`);
  expect(f.requests.some(({ path }) => path.endsWith("/workspace-jobs/latest"))).toBe(true);
});

test("a feature abort cancels the old view without changing the session", async () => {
  const scope = createSessionScope(),
    controller = new AbortController();
  controller.abort();
  let calls = 0;
  const client = createWorkspaceClient({
    scope,
    signal: controller.signal,
    newKey: () => crypto.randomUUID(),
    listFiles: async () => [],
    request: async () => {
      calls++;
      return Response.json(workspace);
    },
  });
  await expect(client.get(workspace.id)).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(0);
  expect(scope.snapshot()).toBe(0);
});
