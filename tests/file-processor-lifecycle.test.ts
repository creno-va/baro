import { expect, test } from "bun:test";
import { createProcessorLifecycle } from "../src/server/modules/file-processing/container-lifecycle";
import {
  isNamedNativeRuntime,
  namedProcessorPort,
  nativeJobId,
} from "../src/server/modules/file-processing/native-identity";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function ingress() {
  return new Request("https://internal/ready");
}
function fixture() {
  const state = {
    revoked: false,
    running: false,
    starts: 0,
    requests: 0,
    destroys: 0,
    failDestroy: false,
    failWrite: false,
  };
  const port = {
    isRevoked: async () => state.revoked,
    persistRevoked: async () => {
      if (state.failWrite) throw new Error("synthetic durable storage failure");
      state.revoked = true;
    },
    start: async (_signal: AbortSignal) => {
      state.starts++;
      state.running = true;
    },
    destroy: async () => {
      state.destroys++;
      if (state.failDestroy) throw new Error("synthetic native destruction failure");
      state.running = false;
    },
    fetch: async (_request: Request) => {
      state.requests++;
      return Response.json({ ready: true });
    },
  };
  return { state, port, lifecycle: createProcessorLifecycle(port) };
}

test("each sequential unit destroys leftover plaintext, serializes its response and remains reusable", async () => {
  const f = fixture();
  f.state.running = true; // A process surviving a reconstructed Durable Object.
  for (let unit = 0; unit < 2; unit++) {
    const response = await f.lifecycle.fetch(ingress());
    expect(response.status).toBe(200);
    expect((await f.lifecycle.fetch(ingress())).status).toBe(409);
    expect(f.state.running).toBe(true);
    await response.json();
    expect(f.state.running).toBe(false);
  }
  expect(f.state.starts).toBe(2);
  expect(f.state.destroys).toBe(4);
});

test("revoke waits for late startup, blocks raw dispatch and survives a Durable Object restart", async () => {
  const f = fixture(),
    entered = deferred(),
    release = deferred();
  f.port.start = async () => {
    entered.resolve();
    await release.promise; // Simulate startup ignoring cancellation until it completes.
    f.state.starts++;
    f.state.running = true;
  };
  const response = f.lifecycle.fetch(ingress());
  await entered.promise;
  let acknowledged = false;
  const revocation = f.lifecycle.revoke().then(() => {
    acknowledged = true;
  });
  await Promise.resolve();
  expect(f.state.revoked).toBe(true);
  expect(acknowledged).toBe(false);
  expect((await f.lifecycle.fetch(ingress())).status).toBe(410);
  release.resolve();
  await revocation;
  expect((await response).status).toBe(503);
  expect(f.state.running).toBe(false);
  expect(f.state.requests).toBe(0);
  const restarted = createProcessorLifecycle(f.port);
  expect((await restarted.fetch(ingress())).status).toBe(503);
  expect(f.state.starts).toBe(1);
  expect(f.state.requests).toBe(0);
});

test("revocation during durable-state read cannot be overtaken by the earlier fetch", async () => {
  const f = fixture(),
    entered = deferred(),
    release = deferred();
  f.port.isRevoked = async () => {
    entered.resolve();
    await release.promise;
    return false;
  };
  const response = f.lifecycle.fetch(ingress());
  await entered.promise;
  const revoke = f.lifecycle.revoke();
  release.resolve();
  await revoke;
  expect((await response).status).toBe(503);
  expect(f.state.starts).toBe(0);
  expect(f.state.requests).toBe(0);
});

test("late response bytes are refused after revoke and no new unit can start", async () => {
  const f = fixture(),
    entered = deferred(),
    release = deferred();
  f.port.fetch = async () =>
    new Response(
      new ReadableStream(
        {
          async pull(controller) {
            entered.resolve();
            await release.promise;
            controller.enqueue(new TextEncoder().encode("private"));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: { "content-type": "application/json" } },
    );
  const response = await f.lifecycle.fetch(ingress());
  if (!response.body) throw new Error("Synthetic response missing");
  const read = response.body.getReader().read();
  await entered.promise;
  await f.lifecycle.revoke();
  release.resolve();
  await expect(read).rejects.toThrow("PROCESSOR_UNAVAILABLE");
  expect(f.state.running).toBe(false);
  expect((await f.lifecycle.fetch(ingress())).status).toBe(410);
});

test("failed persistence or destruction never acknowledges revoke; retry and restart retain the fence", async () => {
  const f = fixture();
  f.state.failWrite = true;
  await expect(f.lifecycle.revoke()).rejects.toThrow();
  expect((await f.lifecycle.fetch(ingress())).status).toBe(410);
  f.state.failWrite = false;
  f.state.failDestroy = true;
  await expect(f.lifecycle.revoke()).rejects.toThrow();
  expect(f.state.revoked).toBe(true);
  const restarted = createProcessorLifecycle(f.port);
  expect((await restarted.fetch(ingress())).status).toBe(503);
  expect(f.state.starts).toBe(0);
  f.state.failDestroy = false;
  await restarted.revoke();
  expect(f.state.running).toBe(false);
});

test("failed unit cleanup cannot overlap another start and stop can retry it", async () => {
  const f = fixture();
  const response = await f.lifecycle.fetch(ingress());
  f.state.failDestroy = true;
  await expect(response.text()).rejects.toThrow();
  expect((await f.lifecycle.fetch(ingress())).status).toBe(409);
  f.state.failDestroy = false;
  await f.lifecycle.stop();
  await (await f.lifecycle.fetch(ingress())).text();
  expect(f.state.starts).toBe(2);
  expect(f.state.running).toBe(false);
});

test("native identity resolves the retained attempt name and never creates a random instance", async () => {
  for (const kind of ["file", "asset", "probe"] as const) {
    const id = `${nativeJobId(kind)}-2`,
      names: string[] = [];
    let stopped = false;
    const binding = {
      idFromName: (name: string) => {
        names.push(name);
        return name;
      },
      get: (name: string) => ({
        fetch: async () => Response.json({ name }),
        stopProcessing: async () => {
          stopped = true;
        },
      }),
      newUniqueId: () => {
        throw new Error("Untracked native instance");
      },
    } as unknown as Env["FILE_PROCESSOR"];
    const port = namedProcessorPort(binding, id);
    expect(await (await port.fetch(ingress())).text()).toBe(JSON.stringify({ name: id }));
    await port.stop();
    expect(stopped).toBe(true);
    expect(names).toEqual([id]);
    expect(isNamedNativeRuntime(id)).toBe(true);
  }
  expect(isNamedNativeRuntime(`file-processing-${crypto.randomUUID()}-1`)).toBe(false);
  expect(isNamedNativeRuntime(`${crypto.randomUUID()}-1`)).toBe(false);
});
