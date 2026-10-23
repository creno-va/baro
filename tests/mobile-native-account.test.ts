import { expect, test } from "bun:test";
import { ApiError, type JsonRequestOptions } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { createNativeAccountClient } from "../apps/mobile/src/platform/account/client";
import { createCaseOperationStorage } from "../apps/mobile/src/platform/storage/case-operations";
import { usage } from "./fixtures/contracts/v2";

const tag = "a".repeat(64),
  access = {
    ownerTag: tag,
    recentOAuth: true,
    authenticatedAt: "2026-10-23T00:00:00.000Z",
    providers: ["google"],
  };
const fingerprint = async (value: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString(
    "hex",
  );
function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve: () => resolve(),
  };
}
async function until(ready: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (ready()) return;
    await new Promise((done) => setTimeout(done, 1));
  }
  throw new Error("SYNTHETIC_LIFECYCLE_DID_NOT_ADVANCE");
}
function fixture() {
  const records = new Map<string, string>(),
    requests: JsonRequestOptions[] = [],
    notified: string[] = [];
  let scope = createSessionScope(),
    mode = "",
    server = access,
    marker: unknown = { ownerTag: tag, startedAt: Date.parse(access.authenticatedAt) - 1000 },
    reauth = 0,
    cleanupCount = 0,
    cleaned = 0;
  let acceptedWrite: Promise<void> | undefined,
    cleanupWait: Promise<void> | undefined,
    afterDelete: Promise<void> | undefined;
  const storage = createCaseOperationStorage({
    namespace: "baro_preview_case_operations",
    fingerprint,
    storage: {
      get: async (key) => {
        if (mode === "locked") throw new Error("PRIVATE_NATIVE_STACK");
        return records.get(key) ?? null;
      },
      set: async (key, value) => {
        if (JSON.parse(value).state === "accepted") await acceptedWrite;
        if (mode !== "silent") records.set(key, value);
      },
      remove: async (key) => {
        if (mode !== "retain") records.delete(key);
      },
    },
  });
  const client = (ownerId = "owner_a", feature = new AbortController()) =>
    createNativeAccountClient({
      scope,
      signal: feature.signal,
      ownerId,
      storage,
      fingerprint,
      newKey: () => crypto.randomUUID(),
      readReauthentication: async () => marker,
      reauthenticate: async () => {
        reauth++;
      },
      onAccepted: async (receipt) => {
        notified.push(receipt.ownerId);
        if (mode === "notify") throw new Error("PRIVATE_NATIVE_STACK");
      },
      cleanup: async ({ ensureCurrent }) => {
        cleanupCount++;
        await cleanupWait;
        ensureCurrent();
        if (mode === "cleanup") throw new Error("PRIVATE_NATIVE_STACK");
        cleaned++;
      },
      request: async <T>(options: JsonRequestOptions) => {
        requests.push(options);
        if (options.path.endsWith("/deletion")) return server as T;
        if (options.path.endsWith("/usage")) return usage as T;
        await afterDelete;
        if (mode === "drop") throw new ApiError("UNAVAILABLE", "합성 응답 유실", true);
        if (mode === "unknown") return { status: "unknown" } as T;
        if (mode === "owner-switch") scope.invalidate();
        return { status: "accepted" } as T;
      },
    });
  return {
    client,
    requests,
    records,
    notified,
    storage,
    scope: () => scope,
    counts: () => ({ cleanupCount, cleaned, reauth }),
    mode: (value: string) => {
      mode = value;
    },
    server: (value: typeof access) => {
      server = value;
    },
    marker: (value: unknown) => {
      marker = value;
    },
    renew: () => {
      scope = createSessionScope();
    },
    acceptedWrite: (value: Promise<void>) => {
      acceptedWrite = value;
    },
    cleanupWait: (value: Promise<void>) => {
      cleanupWait = value;
    },
    afterDelete: (value: Promise<void>) => {
      afterDelete = value;
    },
  };
}

test("literal confirmation and matching local/server reauthentication are mandatory before durable delete intent", async () => {
  const f = fixture();
  await expect(f.client().deleteAccount("delete")).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  expect(f.requests).toHaveLength(0);
  for (const marker of [
    null,
    { ownerTag: "b".repeat(64), startedAt: 0 },
    { ownerTag: tag, startedAt: Date.parse(access.authenticatedAt) + 1 },
  ]) {
    f.marker(marker);
    await expect(f.client().deleteAccount("DELETE")).rejects.toMatchObject({
      reason: "REAUTHENTICATION_REQUIRED",
    });
  }
  expect(f.requests.every((call) => call.path.endsWith("/deletion"))).toBe(true);
  expect(f.records.size).toBe(0);
  f.marker({ ownerTag: tag, startedAt: 0 });
  f.server({ ...access, recentOAuth: false });
  await expect(f.client().deleteAccount("DELETE")).rejects.toMatchObject({
    reason: "REAUTHENTICATION_REQUIRED",
  });
});

test("locked or silently lost persistence prevents DELETE and never exports native diagnostic values", async () => {
  for (const mode of ["locked", "silent"]) {
    const f = fixture();
    f.mode(mode);
    const error = await f
      .client()
      .deleteAccount("DELETE")
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(String(error)).not.toContain("PRIVATE_NATIVE");
    expect(f.requests.some((call) => call.method === "DELETE")).toBe(false);
  }
});

test("unknown ACK survives feature recreation and blocks ordinary resend; explicit fresh same-owner retry retains exact key/body", async () => {
  const f = fixture();
  f.mode("drop");
  const first = f.client();
  await expect(first.deleteAccount("DELETE")).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(await first.deletionState()).toBe("unconfirmed");
  const record = [...f.records.values()][0] ?? "";
  expect(record).not.toContain("owner_a");
  expect(JSON.parse(record).state).toBe("attempted");
  const deletes = () => f.requests.filter((call) => call.method === "DELETE");
  const next = f.client();
  await expect(next.deleteAccount("DELETE")).rejects.toMatchObject({ reason: "UNCONFIRMED" });
  expect(deletes()).toHaveLength(1);
  f.server({ ...access, ownerTag: "b".repeat(64) });
  await expect(next.retryUnconfirmed("DELETE")).rejects.toMatchObject({ reason: "OWNER_CHANGED" });
  expect(deletes()).toHaveLength(1);
  f.server(access);
  f.mode("");
  await expect(next.retryUnconfirmed("DELETE")).rejects.toMatchObject({
    reason: "REAUTHENTICATION_REQUIRED",
  });
  f.server({ ...access, authenticatedAt: "2026-10-23T00:00:01.000Z" });
  f.marker({ ownerTag: tag, startedAt: Date.parse("2026-10-23T00:00:00.500Z") });
  expect(await next.retryUnconfirmed("DELETE")).toEqual({
    status: "accepted",
    cleanupFailed: false,
  });
  expect(deletes()).toHaveLength(2);
  expect(deletes()[0]?.key).toBe(deletes()[1]?.key);
  expect(deletes()[0]?.body).toEqual({ confirmation: "DELETE" });
  expect(deletes()[1]?.headers?.["x-baro-deletion-owner"]).toBe(tag);
  expect(deletes().every((call) => call.expectedOwner === "owner_a")).toBe(true);
  expect(f.notified).toEqual(["owner_a"]);
  expect(f.records.size).toBe(0);
});

test("unknown status is not accepted and a peer owner's storage namespace never inherits an earlier intent", async () => {
  const f = fixture();
  f.mode("unknown");
  await expect(f.client().deleteAccount("DELETE")).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(f.notified).toEqual([]);
  expect(f.counts().cleaned).toBe(0);
  expect(await f.client("owner_b").deletionState()).toBe("none");
  await expect(f.client("owner_b").retryUnconfirmed("DELETE")).rejects.toMatchObject({
    reason: "NO_PENDING_REQUEST",
  });
  expect(f.records.size).toBe(1);
});

test("accepted ACK remains accepted when native cleanup or metadata removal fails, with opaque accepted facts retained", async () => {
  for (const mode of ["cleanup", "retain"]) {
    const f = fixture();
    f.mode(mode);
    expect(await f.client().deleteAccount("DELETE")).toEqual({
      status: "accepted",
      cleanupFailed: true,
    });
    expect(f.notified).toEqual(["owner_a"]);
    expect(f.scope().snapshot()).toBe(1);
    expect(JSON.parse([...f.records.values()][0] ?? "{}").state).toBe("accepted");
    f.renew();
    await expect(f.client().deleteAccount("DELETE")).rejects.toMatchObject({
      reason: "ALREADY_ACCEPTED",
    });
    expect(f.requests.filter((call) => call.method === "DELETE")).toHaveLength(1);
  }
});

test("late accepted response after owner transition cannot notify or cleanup, preserving unknown intent", async () => {
  const f = fixture();
  f.mode("owner-switch");
  await expect(f.client().deleteAccount("DELETE")).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(f.notified).toEqual([]);
  expect(f.counts().cleanupCount).toBe(0);
  expect(JSON.parse([...f.records.values()][0] ?? "{}").state).toBe("attempted");
});

test("a new auth generation during accepted metadata persistence cannot clear the peer's credentials", async () => {
  const f = fixture(),
    pause = deferred();
  f.acceptedWrite(pause.promise);
  const task = f.client().deleteAccount("DELETE");
  await until(() => !!f.notified.length);
  f.scope().invalidate();
  pause.resolve();
  expect(await task).toEqual({ status: "accepted", cleanupFailed: true });
  expect(f.counts().cleanupCount).toBe(0);
  expect(JSON.parse([...f.records.values()][0] ?? "{}").state).toBe("accepted");
});

test("consumer cleanup fence rejects an auth replacement after its own await", async () => {
  const f = fixture(),
    pause = deferred();
  f.cleanupWait(pause.promise);
  const task = f.client().deleteAccount("DELETE");
  await until(() => !!f.counts().cleanupCount);
  f.scope().invalidate();
  pause.resolve();
  expect(await task).toEqual({ status: "accepted", cleanupFailed: true });
  expect(f.counts().cleaned).toBe(0);
});

test("parallel confirmations share one intent and ACK; native usage preserves real reset/technical counters", async () => {
  const f = fixture(),
    client = f.client(),
    pause = deferred();
  const measured = await client.usage();
  expect(measured.resetAt).toBe(usage.resetAt);
  expect(measured.includesReservations).toBe(true);
  expect(measured.aiResponses.limit).toBe(200);
  f.afterDelete(pause.promise);
  const a = client.deleteAccount("DELETE"),
    b = client.deleteAccount("DELETE");
  await until(() => f.requests.some((call) => call.method === "DELETE"));
  pause.resolve();
  expect(await a).toEqual({ status: "accepted", cleanupFailed: false });
  expect(await b).toEqual({ status: "accepted", cleanupFailed: false });
  expect(f.requests.filter((call) => call.method === "DELETE")).toHaveLength(1);
  expect(f.notified).toHaveLength(1);
});

test("feature cancellation prevents reauthentication, usage and new deletion IO", async () => {
  const f = fixture(),
    controller = new AbortController(),
    client = f.client("owner_a", controller);
  controller.abort();
  await expect(client.reauthenticate("google")).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(client.usage()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(client.deleteAccount("DELETE")).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(f.requests).toEqual([]);
  expect(f.counts().reauth).toBe(0);
  expect(f.records.size).toBe(0);
});

test("each unconfirmed recheck requires a later actual server authentication and preserves the logical intent", async () => {
  const f = fixture();
  f.mode("drop");
  await expect(f.client().deleteAccount("DELETE")).rejects.toMatchObject({ code: "UNAVAILABLE" });
  f.server({ ...access, authenticatedAt: "2026-10-23T00:00:01.000Z" });
  f.marker({ ownerTag: tag, startedAt: Date.parse("2026-10-23T00:00:00.500Z") });
  await expect(f.client().retryUnconfirmed("DELETE")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  const writes = f.requests.filter((call) => call.method === "DELETE");
  expect(writes).toHaveLength(2);
  expect(writes[0]?.key).toBe(writes[1]?.key);
  expect(JSON.parse([...f.records.values()][0] ?? "{}").authenticatedAt).toBe(
    "2026-10-23T00:00:01.000Z",
  );
  await expect(f.client().retryUnconfirmed("DELETE")).rejects.toMatchObject({
    reason: "REAUTHENTICATION_REQUIRED",
  });
  expect(f.requests.filter((call) => call.method === "DELETE")).toHaveLength(2);
});

test("an asynchronous accepted notification failure cannot reverse ACK or skip native cleanup", async () => {
  const f = fixture();
  f.mode("notify");
  expect(await f.client().deleteAccount("DELETE")).toEqual({
    status: "accepted",
    cleanupFailed: true,
  });
  expect(f.notified).toEqual(["owner_a"]);
  expect(f.counts().cleaned).toBe(1);
  expect(f.records.size).toBe(0);
});
