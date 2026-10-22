import { expect, test } from "bun:test";
import {
  ApiError,
  createLawyerAssetsClient,
  createLawyersClient,
  type DomainRequest,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { EXPECTED_PROFILE_HEADER, emptySelfProfile } from "@baro/contracts/v2/self-profile";
import { Hono } from "hono";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import { createMobileApi } from "../apps/mobile/src/platform/http";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createDirectoryApi } from "../src/server/api/v2/directory";
import { createLawyersApi } from "../src/server/api/v2/lawyers";
import { saveAccountType } from "../src/server/auth/account-type";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createSelfProfileService } from "../src/server/modules/lawyers/self-profile";
import { publicLawyer } from "./fixtures/contracts/v2";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (value: T) => resolve(value),
  };
}
const hash = async (value: string | Uint8Array<ArrayBuffer>) =>
  Buffer.from(
    await crypto.subtle.digest(
      "SHA-256",
      typeof value === "string" ? new TextEncoder().encode(value) : value,
    ),
  ).toString("hex");
const source = {
  name: "합성 비공개 사진.png",
  type: "image/png",
  size: 3,
  bytes: new Uint8Array([1, 2, 3]),
};
const uploadedAsset = {
  id: "asset_a",
  revision: 2,
  kind: "image",
  status: "uploaded",
  byteLength: 3,
  originalHash: "a".repeat(64),
  sanitizedDerivative: null,
  currentJobId: null,
  failure: null,
};
function uploadFixture(
  options: { beforeWrite?: () => Promise<void>; beforePut?: () => Promise<void> } = {},
) {
  const records = new Map<string, string>(),
    keys: string[] = [];
  let owner = "profile_a",
    fail = "",
    closed = 0,
    reservations = 0,
    puts = 0,
    uploaded = false,
    dropStorage = false;
  const reserved = {
    assetId: "asset_a",
    revision: 1,
    value: { request: { mediaType: "image/png" } },
  };
  const request: DomainRequest = async <T>(path: string, init = {}) => {
    const options: import("@baro/api-client").DomainRequestInit = init;
    if (path.endsWith("/profile")) return { profileId: owner, revision: 1 } as T;
    if (options.method === "POST") {
      reservations++;
      expect(options.headers?.[EXPECTED_PROFILE_HEADER]).toBe("profile_a");
      keys.push(options.headers?.["idempotency-key"] ?? "");
      if (fail === "reserve") {
        fail = "";
        throw new ApiError("UNAVAILABLE", "합성 응답 유실", true);
      }
      return reserved as T;
    }
    return (uploaded ? uploadedAsset : reserved.value) as T;
  };
  function client(scope = createSessionScope()) {
    const api = createLawyerAssetsClient<typeof source, string>({
      scope,
      request,
      persistence: "required",
      newKey: () => crypto.randomUUID(),
      fingerprintText: hash,
      storage: {
        getItem: (key, legacy) => records.get(key) ?? (legacy ? records.get(legacy) : null) ?? null,
        setItem: async (key, value) => {
          await options.beforeWrite?.();
          if (!dropStorage) records.set(key, value);
        },
        removeItem: (key, legacy) => {
          records.delete(key);
          if (legacy) records.delete(legacy);
        },
      },
      open: async (value) => ({
        fingerprint: () => hash(value.bytes),
        body: async () => ({ body: value.bytes, byteLength: value.size }),
        close: () => {
          closed++;
        },
      }),
      uploadContent: async () => {
        puts++;
        await options.beforePut?.();
        uploaded = true;
        if (fail === "content") {
          fail = "";
          throw new ApiError("UNAVAILABLE", "합성 응답 유실", true);
        }
        return { assetId: "asset_a", revision: 2, value: uploadedAsset };
      },
      download: async () => ({ value: "synthetic-handle", discard: () => {} }),
    });
    return { api, scope };
  }
  return {
    client,
    request,
    records,
    keys,
    fail: (value: string) => {
      fail = value;
    },
    owner: (value: string) => {
      owner = value;
    },
    drop: () => {
      dropStorage = true;
    },
    counts: () => ({ closed, reservations, puts }),
  };
}

test("native-shaped byte sources recover uncertain reservations/content after a new scope without duplicate upload", async () => {
  for (const stage of ["reserve", "content"]) {
    const f = uploadFixture();
    f.fail(stage);
    await expect(f.client().api.upload("profile_a", source, "portfolio")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(f.records.size).toBe(1);
    expect(JSON.stringify([...f.records])).not.toContain(source.name);
    expect((await f.client().api.upload("profile_a", source, "portfolio")).status).toBe("uploaded");
    expect(new Set(f.keys).size).toBe(1);
    expect(f.counts().puts).toBe(1);
    expect(f.records.size).toBe(0);
    expect(f.counts().closed).toBe(2);
  }
});

test("required recovery storage detects silent writes before reservation and keeps uncertain operations on owner change", async () => {
  const missing = uploadFixture();
  missing.drop();
  await expect(missing.client().api.upload("profile_a", source, "portfolio")).rejects.toMatchObject(
    { code: "UNAVAILABLE" },
  );
  expect(missing.counts()).toMatchObject({ reservations: 0, puts: 0, closed: 1 });
  const f = uploadFixture();
  f.fail("reserve");
  const first = f.client();
  await expect(first.api.upload("profile_a", source, "portfolio")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  first.scope.invalidate();
  f.owner("profile_b");
  await expect(f.client().api.upload("profile_a", source, "portfolio")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(f.records.size).toBe(1);
  expect(f.counts().reservations).toBe(1);
});

test("old profile requests cannot join new ambient-cookie callers or publish stale data after scope invalidation", async () => {
  const gate = deferred<unknown>(),
    scope = createSessionScope();
  let calls = 0,
    owner = "a";
  const client = createLawyersClient({
    scope,
    request: async <T>() => {
      calls++;
      if (owner === "b") throw new ApiError("NOT_FOUND", "합성 다른 계정");
      return gate.promise as Promise<T>;
    },
  });
  const old = client.getMine();
  void old.catch(() => {});
  owner = "b";
  await expect(client.getMine()).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(calls).toBe(2);
  scope.invalidate();
  gate.resolve(emptySelfProfile("a"));
  await expect(old).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
});

test("every upload retry checks its current owner before joining an older pending upload", async () => {
  const started = deferred<void>(),
    gate = deferred<void>();
  const f = uploadFixture({
    beforePut: async () => {
      started.resolve();
      await gate.promise;
    },
  });
  const client = f.client();
  const old = client.api.upload("profile_a", source, "portfolio");
  void old.catch(() => {});
  await started.promise;
  f.owner("profile_b");
  await expect(client.api.upload("profile_a", source, "portfolio")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  client.scope.invalidate();
  gate.resolve();
  await expect(old).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.counts()).toEqual({ closed: 2, reservations: 1, puts: 1 });
  expect(f.records.size).toBe(1);
});

test("a pending storage write from an obsolete generation cannot overwrite a new generation's recovery key", async () => {
  const writing = deferred<void>(),
    gate = deferred<void>();
  let first = true;
  const f = uploadFixture({
      beforeWrite: async () => {
        if (first) {
          first = false;
          writing.resolve();
          await gate.promise;
        }
      },
    }),
    scope = createSessionScope();
  const old = f.client(scope).api.upload("profile_a", source, "portfolio");
  void old.catch(() => {});
  await writing.promise;
  scope.invalidate();
  const current = f.client(scope).api.upload("profile_a", source, "portfolio");
  gate.resolve();
  await expect(old).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect((await current).status).toBe("uploaded");
  expect(f.counts().reservations).toBe(1);
  expect(f.records.size).toBe(0);
});

test("a browser legacy uncertain record keeps its original key and is removed only after acknowledgement", async () => {
  const f = uploadFixture(),
    key = crypto.randomUUID();
  const identity = JSON.stringify([
    "profile_a",
    "portfolio",
    source.name,
    source.type,
    source.size,
    await hash(source.bytes),
  ]);
  f.records.set(`baro-lawyer-upload-v1:${identity}`, JSON.stringify({ key, expectedRevision: 1 }));
  expect((await f.client().api.upload("profile_a", source, "portfolio")).status).toBe("uploaded");
  expect(f.keys).toEqual([key]);
  expect(f.records.size).toBe(0);
});

test("public profile fallback is only for missing self-service profiles and does not require the credential scope", async () => {
  let calls = 0,
    status = "missing";
  const scope = createSessionScope();
  const client = createLawyersClient({
    scope,
    request: async () => {
      throw new Error("PRIVATE_STORE_MUST_NOT_BE_USED");
    },
    publicRequest: async <T>(path: string) => {
      calls++;
      if (path.includes("self-service"))
        throw new ApiError(status === "missing" ? "NOT_FOUND" : "UNAVAILABLE", "합성 실패");
      return publicLawyer as T;
    },
  });
  scope.invalidate();
  expect((await client.get(publicLawyer.id)).verificationStatus).toBe("verified");
  expect(calls).toBe(2);
  status = "unavailable";
  await expect(client.get(publicLawyer.id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(calls).toBe(3);
});

test("an obsolete private download is discarded even if cleanup fails", async () => {
  const f = uploadFixture(),
    scope = createSessionScope(),
    gate = deferred<void>();
  let discarded = false;
  const client = createLawyerAssetsClient<typeof source, string>({
    scope,
    request: f.request,
    newKey: () => crypto.randomUUID(),
    fingerprintText: hash,
    open: async () => {
      throw new Error("UNUSED");
    },
    uploadContent: async () => {
      throw new Error("UNUSED");
    },
    download: async () => {
      await gate.promise;
      return {
        value: "private-handle",
        discard() {
          discarded = true;
          throw new Error("SYNTHETIC_PRIVATE_DIAGNOSTIC");
        },
      };
    },
  });
  const old = client.blob("profile_a", "asset_a", true);
  void old.catch(() => {});
  scope.invalidate();
  gate.resolve();
  await expect(old).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(discarded).toBe(true);
});

test("native profile composition uses real Hono/SQL for save/publication/withdrawal and rejects foreign profile writes", async () => {
  const db = await createTestDatabase();
  try {
    const a = await seedTestSession(db, { consent: true }),
      b = await seedTestSession(db, { consent: true });
    await saveAccountType(db.binding, a.userId, "lawyer");
    await saveAccountType(db.binding, b.userId, "lawyer");
    const env: Env = {
      ...a.env,
      APPLICATION_COST_LIMITS_ENABLED: "false",
      MONTHLY_BUDGET_CAP_ENABLED: "false",
      CASE_DATA_KEY_V1: btoa("a".repeat(32)).replace(/=+$/, ""),
    };
    const app = new Hono<ApiEnvironment>()
      .route("/api/v2/me", createLawyersApi())
      .route("/api/v2/lawyers", createDirectoryApi());
    let cookie = a.cookie;
    const api = createMobileApi({
      config: resolveMobileConfig({ environment: "local", apiBaseUrl: env.BETTER_AUTH_URL }),
      newKey: () => crypto.randomUUID(),
      transport: async (path, init) =>
        app.request(
          path,
          {
            ...init,
            headers: {
              ...Object.fromEntries(new Headers(init.headers)),
              cookie,
              origin: env.BETTER_AUTH_URL,
            },
          },
          env,
        ),
      fetch: async (path, init) => app.request(path, init, env),
    });
    const mine = await api.lawyers.getMine();
    const saved = await api.lawyers.saveMine({
      ...mine,
      name: "합성 변호사",
      introduction: "합성 소개",
      officeName: "합성 사무소",
      address: "합성 주소",
      region: "seoul",
      practiceAreas: ["civil"],
      email: "synthetic@example.invalid",
    });
    const published = await api.lawyers.publishMine(true, saved);
    expect((await api.lawyers.get(saved.id)).verificationStatus).toBe("self_declared");
    expect((await api.lawyers.listPage()).items.some((p) => p.id === saved.id)).toBe(true);
    await api.lawyers.publishMine(false, published);
    await expect(api.lawyers.get(saved.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    cookie = b.cookie;
    await expect(api.lawyers.saveMine(saved)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await api.lawyers.getMine()).id).not.toBe(saved.id);
  } finally {
    db.close();
  }
});

test("reservation profile hint only denies: actual two-account cookie switch cannot create another owner's operation", async () => {
  const db = await createTestDatabase();
  try {
    const a = await seedTestSession(db, { consent: true }),
      b = await seedTestSession(db, { consent: true });
    await saveAccountType(db.binding, a.userId, "lawyer");
    await saveAccountType(db.binding, b.userId, "lawyer");
    const env: Env = {
      ...a.env,
      APPLICATION_COST_LIMITS_ENABLED: "false",
      MONTHLY_BUDGET_CAP_ENABLED: "false",
      CASE_DATA_KEY_V1: btoa("a".repeat(32)).replace(/=+$/, ""),
    };
    const core = createV2Core(db.binding, await createCaseDataCipher(env), {
      applicationCostLimitsEnabled: false,
    });
    const service = createSelfProfileService(core),
      pa = await service.getMine(a.userId),
      pb = await service.getMine(b.userId);
    const app = new Hono<ApiEnvironment>().route(
      "/api/v2/me",
      createLawyersApi({ dependencies: async () => ({ testOnlyUnmeteredStorage: true }) }),
    );
    const send = (cookie: string, hint: string) =>
      app.request(
        "/api/v2/me/lawyer/portfolio-assets",
        {
          method: "POST",
          headers: {
            cookie,
            origin: env.BETTER_AUTH_URL,
            "content-type": "application/json",
            "if-match": "1",
            "idempotency-key": crypto.randomUUID(),
            [EXPECTED_PROFILE_HEADER]: hint,
          },
          body: JSON.stringify({
            purpose: "portfolio",
            name: "synthetic.png",
            byteLength: 3,
            mediaType: "image/png",
          }),
        },
        env,
      );
    expect((await send(b.cookie, pa.id)).status).toBe(404);
    expect((await send(a.cookie, pb.id)).status).toBe(404);
    expect((await send("", pa.id)).status).toBe(401);
    expect((await send(a.cookie, "%invalid")).status).toBe(404);
    expect(db.sqlite.query("SELECT count(*) n FROM v2_operations").get()).toEqual({ n: 0 });
    expect((await send(a.cookie, pa.id)).status).toBe(201);
    expect(db.sqlite.query("SELECT owner_id FROM v2_assets").all()).toEqual([
      { owner_id: a.userId },
    ]);
  } finally {
    db.close();
  }
});
