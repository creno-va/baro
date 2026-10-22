import { expect, test } from "bun:test";
import {
  ApiError,
  createAccountClient,
  createPrecedentsClient,
  type DomainRequest,
  type DomainRequestInit,
  type OperationRequest,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import search from "./fixtures/legal/research/synthetic-search.json";

const tag = "a".repeat(64);
const access = {
  ownerTag: tag,
  recentOAuth: true,
  authenticatedAt: "2026-10-22T00:00:01.000Z",
  providers: ["google"],
};
function account(
  request: DomainRequest,
  options: { marker?: unknown; mock?: boolean; onDeleted?: () => void } = {},
) {
  const scope = createSessionScope();
  let reauth = 0;
  return {
    scope,
    reauth: () => reauth,
    api: createAccountClient({
      request,
      scope,
      newKey: () => crypto.randomUUID(),
      readReauthentication: async () => options.marker,
      reauthenticate: async () => {
        reauth++;
      },
      ...(options.mock ? { allowMockDeletion: true } : {}),
      ...(options.onDeleted ? { onDeleted: options.onDeleted } : {}),
    }),
  };
}

test("delete readiness requires matching local attempt plus actual server OAuth freshness", async () => {
  for (const [marker, recentOAuth, expected] of [
    [null, true, false],
    [{ ownerTag: tag, startedAt: Date.parse(access.authenticatedAt) - 1000 }, true, true],
    [{ ownerTag: "b".repeat(64), startedAt: 1 }, true, false],
    [{ ownerTag: tag, startedAt: Date.parse(access.authenticatedAt) + 1 }, true, false],
    [{ ownerTag: tag, startedAt: 1 }, false, false],
  ] as const) {
    const f = account(async <T>() => ({ ...access, recentOAuth }) as T, { marker });
    expect((await f.api.deletionAccess()).canDelete).toBe(expected);
  }
  const real = account(async <T>() => ({ ...access, mock: true }) as T);
  await expect(real.api.deletionAccess()).rejects.toThrow();
  const fixture = account(async <T>() => ({ ...access, mock: true }) as T, { mock: true });
  expect((await fixture.api.deletionAccess()).canDelete).toBe(true);
});

test("ambiguous case deletion keeps its key; accepted deletion invalidates private work even if cleanup fails", async () => {
  const writes: DomainRequestInit[] = [];
  let fail = true;
  const f = account(
    async <T>(_path: string, init = {}) => {
      writes.push(init);
      if (fail) {
        fail = false;
        throw new ApiError("UNAVAILABLE", "합성", true);
      }
      return undefined as T;
    },
    {
      onDeleted: () => {
        throw new Error("SYNTHETIC_CACHE_CLEANUP_FAILURE");
      },
    },
  );
  await expect(f.api.deleteCase("synthetic_case", "DELETE")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(f.scope.snapshot()).toBe(0);
  await f.api.deleteCase("synthetic_case", "DELETE");
  expect(writes[0]?.headers?.["idempotency-key"]).toBe(writes[1]?.headers?.["idempotency-key"]);
  expect(f.scope.snapshot()).toBe(1);
  await expect(f.api.usage()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(writes).toHaveLength(2);
});

test("account deletion binds the fresh owner tag and cannot notify on an ambiguous acknowledgement", async () => {
  const writes: DomainRequestInit[] = [];
  let notifications = 0;
  let accepted = false;
  const f = account(
    async <T>(path: string, init = {}) => {
      if (path.endsWith("/deletion")) return access as T;
      writes.push(init);
      return { status: accepted ? "accepted" : "unknown" } as T;
    },
    {
      onDeleted: () => {
        notifications++;
      },
    },
  );
  await f.api.deletionAccess();
  await expect(f.api.deleteAccount("DELETE")).rejects.toThrow();
  expect(f.scope.snapshot()).toBe(0);
  expect(notifications).toBe(0);
  accepted = true;
  await f.api.deleteAccount("DELETE");
  expect(writes[1]?.headers?.["x-baro-deletion-owner"]).toBe(tag);
  expect(notifications).toBe(1);
  expect(f.scope.snapshot()).toBe(1);
});

test("reauthentication only invokes the existing three-provider port and stale reads are discarded", async () => {
  let release!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  const f = account(async <T>(_path: string, init = {}) => {
    signal = (init as DomainRequestInit).signal;
    return new Promise<T>((done) => {
      release = (value) => done(value as T);
    });
  });
  await f.api.reauthenticate("naver");
  expect(f.reauth()).toBe(1);
  const pending = f.api.deletionAccess();
  f.scope.invalidate();
  release(access);
  expect(signal?.aborted).toBe(true);
  await expect(pending).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(f.api.reauthenticate("google")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.reauth()).toBe(1);
});

test("precedent research validates canonical body and preserves exact revision/topic request", async () => {
  const requests: { operation: string; body: unknown }[] = [];
  const request: OperationRequest = async <T>(operation: string, _input: unknown, options = {}) => {
    requests.push({
      operation,
      body: (options as import("@baro/api-client").OperationRequestOptions).body,
    });
    return search as T;
  };
  const client = createPrecedentsClient({ request, scope: createSessionScope() });
  const body = {
    expectedRevision: search.workspaceRevision,
    summaryRevision: search.summaryRevision,
    topics: search.topics as ["lease"],
  };
  await client.search("synthetic_case", body);
  expect(requests).toEqual([{ operation: "precedents.search", body }]);
  await expect(client.search("synthetic_case", { ...body, topics: [] })).rejects.toThrow();
  expect(requests).toHaveLength(1);
});

test("precedent result and further retrieval cannot cross an account or feature cancellation", async () => {
  const scope = createSessionScope();
  let release!: (value: unknown) => void;
  let calls = 0;
  const request: OperationRequest = async <T>() => {
    calls++;
    return new Promise<T>((done) => {
      release = (value) => done(value as T);
    });
  };
  const client = createPrecedentsClient({ scope, request });
  const pending = client.context("synthetic_case");
  scope.invalidate();
  release({});
  await expect(pending).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(client.context("synthetic_case")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(calls).toBe(1);
  const controller = new AbortController();
  controller.abort();
  const fresh = createPrecedentsClient({ scope, request });
  await expect(fresh.context("synthetic_case", controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(calls).toBe(1);
});

for (const kind of ["case", "account"] as const)
  test(`parallel ${kind} deletions share one server acknowledgement and invalidation`, async () => {
    let release!: (value: unknown) => void;
    let calls = 0,
      notifications = 0;
    const f = account(
      async <T>() => {
        calls++;
        return new Promise<T>((done) => {
          release = (value) => done(value as T);
        });
      },
      {
        onDeleted: () => {
          notifications++;
        },
      },
    );
    const remove = () =>
      kind === "case"
        ? f.api.deleteCase("synthetic_case", "DELETE")
        : f.api.deleteAccount("DELETE");
    const first = remove(),
      second = remove();
    expect(calls).toBe(1);
    release({ status: "accepted" });
    await Promise.all([first, second]);
    expect(notifications).toBe(1);
    expect(f.scope.snapshot()).toBe(1);
  });

test("an unexpected successful case payload is not accepted as deletion", async () => {
  const f = account(async <T>() => ({ status: "unknown" }) as T);
  await expect(f.api.deleteCase("synthetic_case", "DELETE")).rejects.toThrow();
  expect(f.scope.snapshot()).toBe(0);
});
