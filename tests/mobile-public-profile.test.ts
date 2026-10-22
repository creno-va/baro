import { expect, test } from "bun:test";
import { ApiError, type LawyerView } from "@baro/api-client";
import { emptySelfProfile } from "@baro/contracts/v2/self-profile";
import { Hono } from "hono";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import {
  createPublicProfileModel,
  publicProfileUrl,
} from "../apps/mobile/src/features/directory/profile";
import { createMobileApi } from "../apps/mobile/src/platform/http";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createDirectoryApi } from "../src/server/api/v2/directory";
import { createLawyersApi } from "../src/server/api/v2/lawyers";
import { saveAccountType } from "../src/server/auth/account-type";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

function profile(id = "public_a"): LawyerView {
  return {
    ...emptySelfProfile(id, "합성 변호사"),
    published: true,
    phone: "+82 2-1234-5678",
    email: "synthetic+public@example.invalid",
    website: "https://contact.baro.site/public",
    photoAssetId: "photo_a",
    photoUrl: `/api/v2/lawyers/self-service/${id}/assets/photo_a`,
    portfolio: [
      {
        id: "portfolio_a",
        title: "합성 공개 자료",
        assetId: "asset_a",
        url: `/api/v2/lawyers/self-service/${id}/assets/asset_a`,
      },
    ],
  };
}
const apiOrigin = "https://preview.baro.site";
function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (value: T) => resolve(value),
  };
}

test("public contacts use only literal validated fields and exact public asset paths", () => {
  const p = profile();
  expect(publicProfileUrl(p, { kind: "phone" }, apiOrigin)).toBe("tel:+82212345678");
  expect(publicProfileUrl(p, { kind: "email" }, apiOrigin)).toBe(
    "mailto:synthetic%2Bpublic%40example.invalid",
  );
  expect(publicProfileUrl(p, { kind: "website" }, apiOrigin)).toBe(p.website);
  expect(publicProfileUrl(p, { kind: "portfolio", id: "portfolio_a" }, apiOrigin)).toBe(
    `${apiOrigin}${p.portfolio[0]?.url}`,
  );
  for (const url of [
    "//evil.invalid/asset",
    "/api/v2/me/lawyer/assets/secret",
    "/api/v2/lawyers/self-service/other/assets/photo_a",
    "/api/v2/lawyers/self-service/public_a/assets/../secret",
    "/api/v2/lawyers/self-service/public_a/assets/photo_a?token=secret",
    "data:image/jpeg;base64,YQ==",
    "javascript:alert(1)",
    "file:///private/file",
  ]) {
    expect(() => publicProfileUrl({ ...p, photoUrl: url }, { kind: "photo" }, apiOrigin)).toThrow();
  }
  for (const url of [
    "https://contact.baro.site/?token=secret",
    "https://contact.baro.site/?caseId=private",
    "https://user:secret@contact.baro.site/",
    "http://contact.baro.site/",
    "https://127.0.0.1/",
    "tel:+82212345678",
  ]) {
    expect(() =>
      publicProfileUrl({ ...p, website: url }, { kind: "website" }, apiOrigin),
    ).toThrow();
  }
  expect(() =>
    publicProfileUrl({ ...p, phone: "02-1234-5678;123" }, { kind: "phone" }, apiOrigin),
  ).toThrow();
  expect(() =>
    publicProfileUrl(
      { ...p, email: "user@example.invalid?body=private" },
      { kind: "email" },
      apiOrigin,
    ),
  ).toThrow();
});

test("new detail or stop fences ignored-abort responses and never opens a previous profile", async () => {
  const reads: {
      id: string;
      signal: AbortSignal;
      pending: ReturnType<typeof deferred<LawyerView>>;
    }[] = [],
    opened: string[] = [];
  const model = createPublicProfileModel({
    apiOrigin,
    get: (id, signal) => {
      const pending = deferred<LawyerView>();
      reads.push({ id, signal, pending });
      return pending.promise;
    },
    openUrl: async (url) => {
      opened.push(url);
    },
  });
  const first = model.load("public_a"),
    next = model.load("public_b");
  expect(reads[0]?.signal.aborted).toBe(true);
  reads[1]?.pending.resolve(profile("public_b"));
  await next;
  reads[0]?.pending.resolve(profile());
  await first;
  expect(model.getSnapshot().profile?.id).toBe("public_b");
  const contact = model.open({ kind: "phone" });
  expect(model.getSnapshot().profile).toBeNull();
  model.stop();
  reads[2]?.pending.resolve(profile("public_b"));
  await contact;
  expect(opened).toEqual([]);
  expect(model.getSnapshot()).toMatchObject({ phase: "idle", profile: null, opening: false });
});

test("every explicit contact rereads authority; withdrawal or failure removes contact data and cannot launch", async () => {
  let reads = 0,
    fail = false;
  const opened: string[] = [];
  const model = createPublicProfileModel({
    apiOrigin,
    get: async () => {
      reads++;
      if (fail) throw new ApiError("NOT_FOUND", "공개 철회");
      return { ...profile(), phone: reads === 1 ? "02-1111-2222" : "02-3333-4444" };
    },
    openUrl: async (url) => {
      opened.push(url);
    },
  });
  await model.load("public_a");
  expect(opened).toEqual([]);
  await model.open({ kind: "phone" });
  expect(reads).toBe(2);
  expect(opened).toEqual(["tel:0233334444"]);
  fail = true;
  await model.open({ kind: "phone" });
  expect(model.getSnapshot()).toMatchObject({ phase: "error", profile: null });
  await model.open({ kind: "website" });
  expect(reads).toBe(3);
  expect(opened).toHaveLength(1);
});

test("unpublished/mismatched/invalid profile rejects before display; OS errors are safe and retry remains explicit", async () => {
  let value = profile();
  const model = createPublicProfileModel({
    apiOrigin,
    get: async () => value,
    openUrl: async () => {
      throw new Error("file:///private/native/stack secret");
    },
  });
  await model.load("../private");
  expect(model.getSnapshot().profile).toBeNull();
  value = { ...profile(), published: false };
  await model.load("public_a");
  expect(model.getSnapshot().phase).toBe("error");
  value = profile("other");
  await model.load("public_a");
  expect(model.getSnapshot().profile).toBeNull();
  value = profile();
  await model.load("public_a");
  await model.open({ kind: "website" });
  expect(model.getSnapshot()).toMatchObject({ phase: "ready", opening: false });
  expect(model.getSnapshot().actionError).not.toContain("secret");
  expect(model.getSnapshot().actionError).not.toContain("file:");
});

test("real shared client keeps anonymous profile reads and 404 fallback independent of locked credentials and auth generations", async () => {
  const calls: { path: string; init: RequestInit }[] = [];
  let missing = false;
  const api = createMobileApi({
    config: resolveMobileConfig({ environment: "preview" }),
    newKey: () => crypto.randomUUID(),
    transport: async () => {
      throw new Error("LOCKED_CREDENTIAL_STORAGE");
    },
    fetch: async (path, init) => {
      calls.push({ path, init });
      if (missing)
        return Response.json(
          { error: { code: "NOT_FOUND", message: "공개 철회", retryable: false } },
          { status: 404 },
        );
      api.scope.invalidate();
      return Response.json(profile());
    },
  });
  const model = createPublicProfileModel({
    apiOrigin,
    get: (id, signal) => api.lawyers.get(id, signal),
    openUrl: async () => {
      throw new Error("not called");
    },
  });
  await model.load("public_a");
  expect(model.getSnapshot().profile?.id).toBe("public_a");
  missing = true;
  await model.load("public_a");
  expect(model.getSnapshot()).toMatchObject({ phase: "error", profile: null });
  expect(calls.map((call) => new URL(call.path).pathname)).toEqual([
    "/api/v2/lawyers/self-service/public_a",
    "/api/v2/lawyers/self-service/public_a",
    "/api/v2/lawyers/public_a",
  ]);
  for (const { init } of calls) {
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect(new Headers(init.headers).get("cookie")).toBeNull();
    expect(new Headers(init.headers).get("authorization")).toBeNull();
  }
});

test("native profile action observes actual Hono/encrypted SQL publication withdrawal after viewing", async () => {
  const db = await createTestDatabase();
  try {
    const owner = await seedTestSession(db, { consent: true });
    await saveAccountType(db.binding, owner.userId, "lawyer");
    const env: Env = {
      ...owner.env,
      APPLICATION_COST_LIMITS_ENABLED: "false",
      MONTHLY_BUDGET_CAP_ENABLED: "false",
      CASE_DATA_KEY_V1: btoa("a".repeat(32)).replace(/=+$/, ""),
    };
    const app = new Hono<ApiEnvironment>()
      .route("/api/v2/me", createLawyersApi())
      .route("/api/v2/lawyers", createDirectoryApi());
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
              cookie: owner.cookie,
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
      name: "합성 공개인",
      introduction: "합성 공개 소개",
      officeName: "합성 사무소",
      address: "합성 주소",
      region: "seoul",
      practiceAreas: ["civil"],
      phone: "02-1234-5678",
    });
    const published = await api.lawyers.publishMine(true, saved),
      opened: string[] = [];
    const model = createPublicProfileModel({
      apiOrigin: env.BETTER_AUTH_URL,
      get: (id, signal) => api.lawyers.get(id, signal),
      openUrl: async (url) => {
        opened.push(url);
      },
    });
    await model.load(saved.id);
    expect(model.getSnapshot().profile?.phone).toBe("02-1234-5678");
    await api.lawyers.publishMine(false, published);
    await model.open({ kind: "phone" });
    expect(opened).toEqual([]);
    expect(model.getSnapshot()).toMatchObject({ phase: "error", profile: null });
    expect(
      (await api.directory.listPage({ region: "seoul", practiceArea: "civil" })).items,
    ).toEqual([]);
  } finally {
    db.close();
  }
});
