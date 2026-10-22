import { expect, test } from "bun:test";
import {
  createWorkspaceClient,
  type WorkspaceAcknowledgement,
  type WorkspaceTransport,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { createCaseOperationStorage } from "../apps/mobile/src/platform/storage/case-operations";
import { createWorkspaceRecovery } from "../packages/api-client/src/workspace-recovery";
import { intake, job, summary, workspace } from "./fixtures/contracts/v2";

const fingerprint = async (input: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))).toString(
    "hex",
  );
const input = {
  expectedRevision: 3,
  text: "공개하지 않는 합성 사건 내용입니다.",
  selectedFileIds: [],
};
const route = `/api/v2/cases/${workspace.id}/messages`;
function store() {
  const records = new Map<string, string>();
  let mode = "";
  let hold: Promise<void> | undefined, entered: (() => void) | undefined;
  const storage = createCaseOperationStorage({
    namespace: "baro_preview_case_operations",
    fingerprint,
    storage: {
      get: async (key) => {
        if (mode === "locked") throw new Error("PRIVATE_SYNTHETIC_DIAGNOSTIC");
        return records.get(key) ?? null;
      },
      set: async (key, value) => {
        entered?.();
        await hold;
        if (mode !== "silent") records.set(key, value);
      },
      remove: async (key) => {
        if (mode !== "retain") records.delete(key);
      },
    },
  });
  return {
    records,
    storage,
    mode: (value: string) => {
      mode = value;
    },
    holdWrite: (value: Promise<void>, onWrite: () => void) => {
      hold = value;
      entered = onWrite;
    },
  };
}
function recovery(f: ReturnType<typeof store>, scope = createSessionScope(), ownerId = "owner_a") {
  const generation = scope.snapshot();
  return createWorkspaceRecovery({
    scope,
    newKey: () => crypto.randomUUID(),
    recovery: { ownerId, storage: f.storage, fingerprint },
    ensureCurrent: () => {
      if (!scope.isCurrent(generation)) throw new Error("OBSOLETE_SCOPE");
    },
  });
}
test("durable workspace identity survives client recreation without storing a body; owner/revision changes cannot share a key", async () => {
  const f = store(),
    first = recovery(f);
  const a = await first.prepare(route, input),
    b = await recovery(f).prepare(route, input);
  expect(a.body).toBe(b.body);
  const key = new Headers(a.headers).get("idempotency-key");
  expect(new Headers(b.headers).get("idempotency-key")).toBe(key);
  expect(new Headers(b.headers).get("x-baro-expected-owner")).toBe("owner_a");
  expect(JSON.stringify([...f.records])).not.toContain(input.text);
  expect(
    new Headers((await recovery(f, undefined, "owner_b").prepare(route, input)).headers).get(
      "idempotency-key",
    ),
  ).not.toBe(key);
  expect(
    new Headers((await recovery(f).prepare(route, { ...input, expectedRevision: 4 })).headers).get(
      "idempotency-key",
    ),
  ).not.toBe(key);
  await first.complete(a);
  expect(f.records.size).toBe(2);
});
test("concurrent same-scope recovery prepares allocate once and stale queued IO cannot authorize an old client", async () => {
  const f = store(),
    scope = createSessionScope(),
    a = recovery(f, scope),
    b = recovery(f, scope);
  const [one, two] = await Promise.all([a.prepare(route, input), b.prepare(route, input)]);
  expect(new Headers(one.headers).get("idempotency-key")).toBe(
    new Headers(two.headers).get("idempotency-key"),
  );
  scope.invalidate();
  await expect(a.complete(one)).rejects.toThrow("OBSOLETE_SCOPE");
  expect(f.records.size).toBe(1);
});
test("required silent/locked/corrupt storage prevents dispatch; cleanup failure keeps a replayable acknowledged key", async () => {
  const f = store();
  f.mode("silent");
  await expect(recovery(f).prepare(route, input)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  f.mode("locked");
  await expect(recovery(f).prepare(route, input)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  f.mode("");
  const r = recovery(f),
    init = await r.prepare(route, input);
  f.mode("retain");
  await r.complete(init);
  expect(f.records.size).toBe(1);
  expect(
    new Headers((await recovery(f).prepare(route, input)).headers).get("idempotency-key"),
  ).toBe(new Headers(init.headers).get("idempotency-key"));
  f.records.set([...f.records.keys()][0] ?? "", "PRIVATE_UNEXPECTED_TEXT");
  await expect(recovery(f).prepare(route, input)).rejects.toMatchObject({ code: "UNAVAILABLE" });
});

test("a new generation waits for an obsolete native write and restores its durable key", async () => {
  const f = store(),
    scope = createSessionScope();
  let release!: () => void, writing!: () => void;
  const entered = new Promise<void>((done) => {
    writing = done;
  });
  f.holdWrite(
    new Promise<void>((done) => {
      release = done;
    }),
    writing,
  );
  const old = recovery(f, scope).prepare(route, input);
  void old.catch(() => {});
  await entered;
  scope.invalidate();
  const fresh = recovery(f, scope).prepare(route, input);
  release();
  await expect(old).rejects.toThrow("OBSOLETE_SCOPE");
  const prepared = await fresh;
  expect(new Headers(prepared.headers).get("idempotency-key")).toBe(
    [...f.records.values()][0] ?? null,
  );
  expect(f.records.size).toBe(1);
});
function clientFixture() {
  const f = store(),
    receipts: WorkspaceAcknowledgement[] = [],
    writes: RequestInit[] = [];
  let lost = "",
    malformed = false;
  const request: WorkspaceTransport = async (path, init = {}) => {
    if (init.method === "POST" || init.method === "PUT") {
      writes.push(init);
      if (lost === "post") {
        lost = "";
        throw new Error("SYNTHETIC_LOST_ACK");
      }
      if (malformed) return Response.json({ success: "unvalidated" });
      return Response.json(
        path.endsWith("/messages") || path.includes("/retry")
          ? { operationId: job.operationId, jobId: job.id, status: "queued", retryAfter: 2 }
          : { committedWorkspaceRevision: 3 },
      );
    }
    if (path.endsWith("/workspace")) {
      if (lost === "read") {
        lost = "";
        return Response.json({}, { status: 503 });
      }
      return Response.json(workspace);
    }
    if (path.endsWith("/intake")) return Response.json(intake);
    if (path.endsWith("/summary")) return Response.json(summary);
    if (path.endsWith("/workspace-jobs/latest")) return Response.json(null);
    if (path.includes("/messages?") || path.endsWith("/actions") || path.endsWith("/timeline"))
      return Response.json({ items: [], nextCursor: null });
    throw new Error("SYNTHETIC_UNKNOWN_PATH");
  };
  const make = () =>
    createWorkspaceClient({
      request,
      scope: createSessionScope(),
      newKey: () => crypto.randomUUID(),
      recovery: { ownerId: "owner_a", storage: f.storage, fingerprint },
      onAcknowledged: (r) => receipts.push(r),
      listFiles: async () => [],
    });
  return {
    ...f,
    receipts,
    writes,
    make,
    lost: (value: string) => {
      lost = value;
    },
    malformed: () => {
      malformed = true;
    },
  };
}
test("accepted chat is reported before a failed projection read; a fresh client replays its original body/key", async () => {
  for (const stage of ["post", "read"]) {
    const f = clientFixture();
    f.lost(stage);
    await expect(f.make().sendMessage(workspace.id, input)).rejects.toBeDefined();
    expect(f.receipts).toHaveLength(stage === "post" ? 0 : 1);
    expect(f.records.size).toBe(1);
    await f.make().sendMessage(workspace.id, input);
    expect(f.writes[0]?.body).toBe(f.writes[1]?.body);
    expect(new Headers(f.writes[0]?.headers).get("idempotency-key")).toBe(
      new Headers(f.writes[1]?.headers).get("idempotency-key"),
    );
    expect(f.records.size).toBe(0);
  }
});
test("unvalidated acknowledgements never clear native input or recovery metadata", async () => {
  const f = clientFixture();
  f.malformed();
  await expect(f.make().sendMessage(workspace.id, input)).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(f.receipts).toEqual([]);
  expect(f.records.size).toBe(1);
});
test("native key write failure occurs before any mutation HTTP and default web dispatch stays synchronous", async () => {
  const f = clientFixture();
  f.mode("silent");
  await expect(f.make().sendMessage(workspace.id, input)).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(f.writes).toHaveLength(0);
  let sent = false;
  const plain = createWorkspaceClient({
    scope: createSessionScope(),
    newKey: () => crypto.randomUUID(),
    listFiles: async () => [],
    request: async () => {
      sent = true;
      return Response.json({}, { status: 503 });
    },
  });
  const pending = plain.sendMessage(workspace.id, input);
  expect(sent).toBe(true);
  await expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE" });
});
