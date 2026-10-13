import { expect, test } from "bun:test";
import { handleRuntimeDrill, type RuntimeDrillEnv } from "./isolated-runtime-control";
import { runtimeDrillNames } from "./isolated-runtime-drill";

function fixture() {
  const objects = new Map<string, string>();
  const instances = new Map<string, string>();
  let deleteFails = false;
  const env = {
    DRILL_ENVIRONMENT: "isolated-test",
    DRILL_RUN_ID: "123-1",
    RELEASE_SHA: "a".repeat(40),
    DRILL_TOKEN: "b".repeat(64),
    CASE_DATA_KEY_V1: Buffer.from("k".repeat(32)).toString("base64url"),
    DRILL_EXPIRES_AT: new Date(Date.now() + 600_000).toISOString(),
    DRILL_PHASE: "baseline",
    DRILL_BUCKET: {
      put: async (key: string, value: string, options?: { onlyIf?: unknown }) => {
        if (options?.onlyIf && objects.has(key)) return null;
        objects.set(key, value);
        return { key };
      },
      get: async (key: string) =>
        objects.has(key) ? { text: async () => objects.get(key) } : null,
      head: async (key: string) => (objects.has(key) ? { key } : null),
      delete: async (key: string) => {
        objects.delete(key);
      },
      list: async () => ({ objects: [...objects.keys()].map((key) => ({ key })) }),
    },
    ANALYSIS_WORKFLOW: {
      create: async ({ id, params }: { id: string; params: { mode: string } }) => {
        if (instances.has(id)) throw new Error("duplicate");
        instances.set(id, params.mode === "complete" ? "complete" : "waiting");
      },
      get: async (id: string) => ({
        status: async () => {
          if (!instances.has(id)) throw new Error("instance.not_found");
          return { status: instances.get(id) };
        },
        delete: async () => {
          if (deleteFails) throw new Error("sensitive platform diagnostic");
          if (!instances.delete(id)) throw new Error("instance.not_found");
        },
      }),
    },
  } as unknown as RuntimeDrillEnv;
  const call = (path: string, headers: Record<string, string> = {}, body?: string) =>
    handleRuntimeDrill(
      new Request(`https://isolated.invalid/${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.DRILL_TOKEN}`, ...headers },
        ...(body === undefined ? {} : { body }),
      }),
      env,
    );
  return {
    env,
    objects,
    instances,
    call,
    failDeletion: () => {
      deleteFails = true;
    },
  };
}

test("isolated control rejects wrong scope, token, expired capability and supplied resource IDs before mutations", async () => {
  for (const mode of ["token", "scope", "expired", "query", "body"] as const) {
    const f = fixture();
    if (mode === "scope") f.env.DRILL_ENVIRONMENT = "production" as "isolated-test";
    if (mode === "expired") f.env.DRILL_EXPIRES_AT = new Date(Date.now() - 1).toISOString();
    const result = await f.call(
      mode === "query" ? "seed?worker=baro-production" : "seed",
      mode === "token" ? { authorization: "Bearer invalid" } : {},
      mode === "body" ? '{"id":"other"}' : undefined,
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(f.objects.size).toBe(0);
    expect(f.instances.size).toBe(0);
  }
  expect(() => runtimeDrillNames("baro-production", "1")).toThrow();
  expect(() => runtimeDrillNames("123", "../1")).toThrow();
});

test("lost response cannot reseed and the genuine product cleanup handles completed, active and late instances", async () => {
  const f = fixture();
  expect((await f.call("seed")).status).toBe(200);
  expect((await f.call("seed")).status).toBe(502);
  expect(f.instances.size).toBe(2);
  expect(await (await f.call("inspect")).json()).toMatchObject({
    recovered: true,
    rejectedBindings: 3,
  });
  expect(await (await f.call("delete")).json()).toMatchObject({
    completedAbsent: true,
    activeAbsent: true,
    targetAbsent: true,
    recovered: true,
  });
  expect(await (await f.call("late")).json()).toMatchObject({ lateAbsent: true });
  expect((await f.call("late")).status).toBe(502);
  expect(f.instances.size).toBe(0);
  expect(await (await f.call("cleanup")).json()).toMatchObject({ remainingObjects: 0 });
});

test("wrong recovery key and platform deletion failures never emit successful evidence or diagnostics", async () => {
  const f = fixture();
  await f.call("seed");
  const saved = f.env.CASE_DATA_KEY_V1;
  f.env.CASE_DATA_KEY_V1 = Buffer.from("z".repeat(32)).toString("base64url");
  expect((await f.call("recover")).status).toBe(502);
  f.env.CASE_DATA_KEY_V1 = saved;
  expect(await (await f.call("recover")).json()).toMatchObject({ recovered: true });
  f.failDeletion();
  const failed = await f.call("delete");
  expect(failed.status).toBe(502);
  expect((await failed.json()) as unknown).toEqual({ error: "DRILL_STEP_FAILED" });
  expect(f.instances.size).toBe(2);
  expect(f.objects.has("private/drill-target")).toBe(true);
});
