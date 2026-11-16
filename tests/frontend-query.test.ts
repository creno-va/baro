import { describe, expect, test } from "bun:test";
import type { SessionView } from "@baro/client-core";
import { QueryObserver } from "@tanstack/react-query";
import { createWebQueryClient, queryKeys } from "../src/client/query/client";
import { createWebSessionController } from "../src/client/query/resources";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const account = (id: string, needsConsent = false): SessionView => ({
  user: { id, name: "합성 사용자", accountType: "customer" },
  needsConsent,
});
function fixture(readSession: () => Promise<SessionView>) {
  const client = createWebQueryClient();
  let invalidations = 0;
  const controller = createWebSessionController({
    client,
    readSession,
    invalidateTransport: () => invalidations++,
    signOut: async () => {},
  });
  return { client, controller, invalidations: () => invalidations };
}

describe("new web session and query ownership", () => {
  test("concurrent verification shares pending reads but settled permissions are read again", async () => {
    let reads = 0;
    const response = deferred<SessionView>();
    const { client, controller } = fixture(() => {
      reads++;
      return response.promise;
    });
    const first = controller.refresh();
    expect(controller.refresh()).toBe(first);
    await Promise.resolve();
    expect(reads).toBe(1);
    response.resolve(account("owner-a"));
    await first;
    const initialOwner = controller.getSnapshot().owner;
    await controller.refresh();
    expect(reads).toBe(2);
    expect(controller.getSnapshot().owner).toBe(initialOwner);
    client.clear();
  });

  test("a revoked session cannot be reopened by its delayed successful verification", async () => {
    const pending = deferred<SessionView>();
    const { client, controller, invalidations } = fixture(() => pending.promise);
    const first = controller.refresh();
    controller.invalidate(true);
    expect(controller.getSnapshot()).toMatchObject({
      owner: null,
      ready: true,
      session: { user: null },
    });
    pending.resolve(account("old-owner"));
    await first;
    expect(controller.getSnapshot().session?.user).toBeNull();
    expect(invalidations()).toBe(1);
    client.clear();
  });

  test("logout clears private cache and same-account login receives a different scope", async () => {
    const { client, controller } = fixture(async () => account("owner-a"));
    await controller.refresh();
    const oldOwner = controller.getSnapshot().owner;
    client.setQueryData(queryKeys.files(oldOwner, "case-a"), ["private old attachment"]);
    controller.invalidate(true);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    await controller.refresh();
    const newOwner = controller.getSnapshot().owner;
    expect(newOwner).not.toBe(oldOwner);
    expect(client.getQueryData(queryKeys.files(newOwner, "case-a"))).toBeUndefined();
    client.clear();
  });

  test("account or consent changes remove all old private resources", async () => {
    let next = account("owner-a");
    const { client, controller } = fixture(async () => next);
    await controller.refresh();
    const firstOwner = controller.getSnapshot().owner;
    client.setQueryData(queryKeys.workspace(firstOwner, "case-a"), "private owner a");
    next = account("owner-b");
    await controller.refresh();
    expect(controller.getSnapshot().session?.user?.id).toBe("owner-b");
    expect(controller.getSnapshot().owner).not.toBe(firstOwner);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    const secondOwner = controller.getSnapshot().owner;
    client.setQueryData(queryKeys.report(secondOwner, "case-b"), "private report");
    next = account("owner-b", true);
    await controller.refresh();
    expect(controller.getSnapshot().session?.needsConsent).toBe(true);
    expect(controller.getSnapshot().owner).not.toBe(secondOwner);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    client.clear();
  });

  test("authorization outages revoke data without claiming anonymous login", async () => {
    let unavailable = false;
    const error = new Error("synthetic session outage");
    const { client, controller } = fixture(async () => {
      if (unavailable) throw error;
      return account("owner-a");
    });
    await controller.refresh();
    client.setQueryData(queryKeys.cases(controller.getSnapshot().owner), ["private case"]);
    unavailable = true;
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      owner: null,
      session: undefined,
      ready: true,
      error,
    });
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    client.clear();
  });

  test("ordinary focus verification preserves a verified view and its query scope", async () => {
    let next: Promise<SessionView> = Promise.resolve(account("owner-a"));
    const { client, controller } = fixture(() => next);
    await controller.refresh();
    const before = controller.getSnapshot();
    const check = deferred<SessionView>();
    next = check.promise;
    const pending = controller.refresh();
    expect(controller.getSnapshot()).toBe(before);
    check.resolve(account("owner-a"));
    await pending;
    expect(controller.getSnapshot().owner).toBe(before.owner);
    client.clear();
  });

  test("a successful same-owner focus check refreshes active resources only after authorization", async () => {
    const events: string[] = [];
    let next: Promise<SessionView> = Promise.resolve(account("owner-a"));
    const { client, controller } = fixture(async () => {
      const value = await next;
      events.push("authorized");
      return value;
    });
    await controller.refresh();
    const key = queryKeys.workspace(controller.getSnapshot().owner, "case-a");
    let resourceReads = 0;
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: async () => {
        events.push("resource");
        return ++resourceReads;
      },
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    const before = resourceReads;
    const permission = deferred<SessionView>();
    next = permission.promise;
    const refresh = controller.refresh();
    await Promise.resolve();
    expect(resourceReads).toBe(before);
    permission.resolve(account("owner-a"));
    await refresh;
    expect(resourceReads).toBe(before + 1);
    expect(events.slice(-2)).toEqual(["authorized", "resource"]);
    unsubscribe();
    client.clear();
  });

  test("an unavailable focus authorization clears data without refetching active resources", async () => {
    let unavailable = false;
    const { client, controller } = fixture(async () => {
      if (unavailable) throw new Error("synthetic session outage");
      return account("owner-a");
    });
    await controller.refresh();
    let resourceReads = 0;
    const observer = new QueryObserver(client, {
      queryKey: queryKeys.workspace(controller.getSnapshot().owner, "case-a"),
      queryFn: async () => ++resourceReads,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    const before = resourceReads;
    unavailable = true;
    await controller.refresh();
    expect(resourceReads).toBe(before);
    expect(controller.getSnapshot().owner).toBeNull();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    unsubscribe();
    client.clear();
  });

  test("revocation cancels a private read and late response cannot populate the cache", async () => {
    const { client, controller } = fixture(async () => account("owner-a"));
    await controller.refresh();
    const key = queryKeys.workspace(controller.getSnapshot().owner, "case-a");
    const pending = deferred<string>();
    let aborted = false;
    const read = client.fetchQuery({
      queryKey: key,
      queryFn: ({ signal }) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return pending.promise;
      },
    });
    const result = read.catch(() => undefined);
    controller.invalidate(true);
    pending.resolve("previous account's private response");
    await result;
    expect(aborted).toBe(true);
    expect(client.getQueryData(key)).toBeUndefined();
    client.clear();
  });

  test("mutations make one attempt and an access rejection requests revalidation", async () => {
    let attempts = 0;
    let accessFailures = 0;
    const client = createWebQueryClient(() => accessFailures++);
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => {
        attempts++;
        throw { code: "UNAUTHENTICATED" };
      },
    });
    await expect(mutation.execute(undefined)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(attempts).toBe(1);
    expect(accessFailures).toBe(1);
    client.clear();
  });
});
