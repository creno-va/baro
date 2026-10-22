import { expect, test } from "bun:test";
import {
  createCaseDeletionClient,
  type DomainRequest,
  type DomainRequestInit,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";

function fixture(request: DomainRequest) {
  const records = new Map<string, string>(),
    scope = createSessionScope();
  let notices = 0;
  const create = (signal?: AbortSignal) =>
    createCaseDeletionClient({
      scope,
      request,
      newKey: () => crypto.randomUUID(),
      ...(signal ? { signal } : {}),
      recovery: {
        ownerId: "owner_a",
        fingerprint: async (value) =>
          Buffer.from(
            await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
          ).toString("hex"),
        storage: {
          getItem: (key) => records.get(key) ?? null,
          setItem: (key, value) => {
            records.set(key, value);
          },
          removeItem: (key) => {
            records.delete(key);
          },
        },
      },
      onDeleted: () => {
        notices++;
      },
    });
  return { create, records, scope, notices: () => notices };
}
test("a cancelled deletion cannot acknowledge or clear its key on a late response; the next live feature replays it", async () => {
  let release = () => {},
    first = true,
    started = () => {};
  const dispatched = new Promise<void>((done) => {
    started = done;
  });
  const hold = new Promise<void>((done) => {
      release = done;
    }),
    keys: string[] = [];
  const f = fixture(async <T>(_path: string, options: DomainRequestInit = {}) => {
    keys.push(options.headers?.["idempotency-key"] ?? "");
    started();
    if (first) {
      first = false;
      await hold;
    }
    return undefined as T;
  });
  const controller = new AbortController(),
    deleting = f.create(controller.signal).deleteCase("case_a", "DELETE", "1");
  await dispatched;
  controller.abort();
  release();
  await expect(deleting).rejects.toMatchObject({ name: "AbortError" });
  expect(f.notices()).toBe(0);
  expect(f.records.size).toBe(1);
  await f.create().deleteCase("case_a", "DELETE", "1");
  expect(keys[0]).toBe(keys[1]);
  expect(f.notices()).toBe(1);
  expect(f.records.size).toBe(0);
});
test("native v2 deletion rejects missing/invalid acknowledgement and never dispatches without exact confirmation", async () => {
  let calls = 0,
    result: unknown;
  const f = fixture(async <T>() => {
    calls++;
    return result as T;
  });
  const client = f.create();
  await expect(client.deleteCase("case_a", "delete")).rejects.toThrow();
  expect(calls).toBe(0);
  expect(f.records.size).toBe(0);
  for (result of [undefined, { status: "pending" }, { status: "accepted", unexpected: true }])
    await expect(client.deleteCase("case_a", "DELETE")).rejects.toThrow();
  expect(f.notices()).toBe(0);
  expect(f.records.size).toBe(1);
  result = { status: "accepted" };
  await client.deleteCase("case_a", "DELETE");
  expect(f.notices()).toBe(1);
  expect(f.records.size).toBe(0);
});
