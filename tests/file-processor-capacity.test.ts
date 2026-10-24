import { expect, test } from "bun:test";
import {
  createProcessorCapacity,
  type ProcessorCapacityHolder,
  sameCapacityHolder,
  waitForProcessorCapacity,
} from "../src/server/modules/file-processing/container-capacity";
import { createProcessorLifecycle } from "../src/server/modules/file-processing/container-lifecycle";

function fixture() {
  let holder: ProcessorCapacityHolder | null = null;
  const state = {
    now: 0,
    stopped: [] as string[],
    stoppedTokens: [] as string[],
    stopFails: false,
  };
  const port = {
    read: async () => holder,
    replace: async (
      previous: ProcessorCapacityHolder | null,
      next: ProcessorCapacityHolder | null,
    ) => {
      if (!sameCapacityHolder(previous, holder)) return false;
      holder = next;
      return true;
    },
    now: () => state.now,
    stop: async (instance: string, token: string) => {
      state.stopped.push(instance);
      state.stoppedTokens.push(token);
      if (state.stopFails) throw new Error("synthetic cleanup unavailable");
    },
  };
  return { port, state, read: () => holder, capacity: createProcessorCapacity(port) };
}

test("one physical slot survives reconstruction and stale releases cannot free a newer unit", async () => {
  const f = fixture();
  const results = await Promise.all([
    f.capacity.claim("probe", "one"),
    f.capacity.claim("extract", "two"),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const first = f.read();
  if (!first) throw new Error("missing synthetic holder");
  const reconstructed = createProcessorCapacity(f.port);
  expect(await reconstructed.claim("different", "three")).toBe(false);
  await reconstructed.release(first.instance, "stale-token");
  expect(f.read()).toEqual(first);
  await reconstructed.release(first.instance, first.token);
  expect(await reconstructed.claim("different", "three")).toBe(true);
  await f.capacity.release(first.instance, first.token);
  expect(f.read()?.instance).toBe("different");
});

test("deadline alone never frees capacity; abandoned native work must be stopped first", async () => {
  const f = fixture();
  expect(await f.capacity.claim("abandoned", "one")).toBe(true);
  f.state.now = 265_000;
  f.state.stopFails = true;
  await expect(f.capacity.claim("next", "two")).rejects.toThrow();
  expect(f.read()?.instance).toBe("abandoned");
  f.state.stopFails = false;
  expect(await f.capacity.claim("next", "two")).toBe(true);
  expect(f.state.stopped).toEqual(["abandoned", "abandoned"]);
  expect(f.state.stoppedTokens).toEqual(["one", "one"]);
});

test("concurrent recovery cannot overwrite a newly admitted unit", async () => {
  const f = fixture();
  await f.capacity.claim("abandoned", "one");
  f.state.now = 265_001;
  const results = await Promise.all([
    f.capacity.claim("next-a", "two"),
    f.capacity.claim("next-b", "three"),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(["next-a", "next-b"]).toContain(f.read()?.instance ?? "missing");
});

test("overlapping upload probe and extraction wait for stream cleanup without a second start", async () => {
  const f = fixture();
  let running = 0,
    maximumRunning = 0,
    starts = 0;
  const make = (instance: string) => {
    const token = `${instance}-token`;
    return createProcessorLifecycle({
      isRevoked: async () => false,
      persistRevoked: async () => {},
      start: async (signal) => {
        await waitForProcessorCapacity(() => f.capacity.claim(instance, token), signal, 1);
        starts++;
        maximumRunning = Math.max(maximumRunning, ++running);
      },
      destroy: async () => {
        if (f.read()?.instance === instance) running--;
        await f.capacity.release(instance, token);
      },
      fetch: async () => Response.json({ ready: true }),
    });
  };
  const probe = make("probe"),
    extract = make("extract");
  const first = await probe.fetch(new Request("https://internal/ready"));
  const second = extract.fetch(new Request("https://internal/ready"));
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(starts).toBe(1);
  await first.text();
  const response = await second;
  expect(response.status).toBe(200);
  expect(starts).toBe(2);
  await response.text();
  expect(maximumRunning).toBe(1);
  expect(running).toBe(0);
  expect(f.read()).toBeNull();
});

test("a queued revoked request never starts or dispatches private bytes", async () => {
  const f = fixture();
  await f.capacity.claim("busy", "one");
  let starts = 0,
    dispatches = 0,
    entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const queued = createProcessorLifecycle({
    isRevoked: async () => false,
    persistRevoked: async () => {},
    start: async (signal) => {
      await waitForProcessorCapacity(async () => {
        entered();
        return f.capacity.claim("queued", "two");
      }, signal);
      starts++;
    },
    destroy: () => f.capacity.release("queued", "two"),
    fetch: async () => {
      dispatches++;
      return new Response("private");
    },
  });
  const response = queued.fetch(new Request("https://internal/ready"));
  await waiting;
  await queued.revoke();
  expect((await response).status).toBe(503);
  expect(starts).toBe(0);
  expect(dispatches).toBe(0);
  expect(f.read()?.instance).toBe("busy");
});

test("cancellation during a late claim is refused even if the slot was acquired", async () => {
  const signal = new AbortController();
  await expect(
    waitForProcessorCapacity(async () => {
      signal.abort();
      return true;
    }, signal.signal),
  ).rejects.toThrow("ABORTED");
});
