import { expect, test } from "bun:test";
import {
  ApiError,
  createLawyerAssetsClient,
  createLawyersClient,
  type DomainRequest,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { Hono } from "hono";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import { createProfileModel } from "../apps/mobile/src/features/profile/model";
import type { SessionState } from "../apps/mobile/src/features/session/model";
import { createNativeCredentials } from "../apps/mobile/src/platform/auth/credentials";
import { createNativeTransport } from "../apps/mobile/src/platform/auth/transport";
import { createMobileApi } from "../apps/mobile/src/platform/http";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createDirectoryApi } from "../src/server/api/v2/directory";
import { createLawyersApi } from "../src/server/api/v2/lawyers";
import { saveAccountType } from "../src/server/auth/account-type";
import { signedSessionCookie, testEnvironment } from "./helpers/d1";
import { selfAssetFixture } from "./helpers/lawyer-self-assets";
import { seedTestSession } from "./helpers/session";

async function until(ready: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (ready()) return;
    await new Promise((done) => setTimeout(done, 1));
  }
  throw new Error("SYNTHETIC_HTTP_PROFILE_DID_NOT_ADVANCE");
}
async function fixture() {
  const f = await selfAssetFixture();
  await saveAccountType(f.db.binding, f.actor.ownerId, "lawyer");
  f.db.sqlite
    .query("UPDATE session SET expires_at=? WHERE user_id=?")
    .run(Date.now() + 3600000, f.actor.ownerId);
  const token = (
    f.db.sqlite.query("SELECT token FROM session WHERE user_id=?").get(f.actor.ownerId) as {
      token: string;
    }
  ).token;
  const peer = await seedTestSession(f.db, { consent: true });
  await saveAccountType(f.db.binding, peer.userId, "lawyer");
  const env = {
    ...testEnvironment(f.db.binding),
    APPLICATION_COST_LIMITS_ENABLED: "false",
    MONTHLY_BUDGET_CAP_ENABLED: "false",
    CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
    CASE_PRIVATE_R2: f.bucketPort,
  };
  const app = new Hono<ApiEnvironment>()
    .route("/api/v2/me", createLawyersApi({ selfAssetDecoder: f.processing.openSanitized }))
    .route("/api/v2/lawyers", createDirectoryApi({ selfAssetDecoder: f.processing.openSanitized }));
  const scope = createSessionScope(),
    stored = new Map<string, string>();
  const credentials = createNativeCredentials({
    scope,
    namespace: "baro_local_auth",
    storage: {
      getItemAsync: async (key) => stored.get(key) ?? null,
      setItemAsync: async (key, value) => {
        stored.set(key, value);
      },
    },
    manageStorage: (value) => value,
    codec: {
      header: (value) => (value ? (JSON.parse(value).cookie as string) : ""),
      merge: (cookie) => JSON.stringify({ cookie }),
    },
  });
  const cookie = await signedSessionCookie(token, env.BETTER_AUTH_SECRET);
  await credentials.capture().accept(cookie);
  let loseSave = false;
  const calls: { path: string; method: string; status: number }[] = [],
    downloaded: Uint8Array[] = [];
  const config = resolveMobileConfig({ environment: "local", apiBaseUrl: env.BETTER_AUTH_URL });
  const transport = createNativeTransport({
    config,
    credentials,
    fetch: async (url, init) => {
      const response = await app.request(new URL(url).pathname + new URL(url).search, init, env);
      calls.push({
        path: new URL(url).pathname,
        method: init.method ?? "GET",
        status: response.status,
      });
      if (loseSave && init.method === "PUT" && url.endsWith("/self-profile") && response.ok)
        throw new ApiError("UNAVAILABLE", "합성 저장 ACK 유실", true);
      return response;
    },
  });
  const api = createMobileApi({
    config,
    scope,
    transport,
    newKey: () => crypto.randomUUID(),
    fetch: async (path, init) => app.request(path, init, env),
  });
  const request: DomainRequest = (path, options = {}) =>
    api.request({ ...options, path, expectedOwner: f.actor.ownerId });
  let session: SessionState = {
    phase: "ready",
    busy: false,
    role: "lawyer",
    error: null,
    consent: null,
    session: {
      user: { id: f.actor.ownerId, name: "합성 변호사", accountType: "lawyer" },
      needsConsent: false,
    },
  };
  const listeners = new Set<() => void>();
  const model = createProfileModel({
    session: {
      getSnapshot: () => session,
      subscribe: (notify) => {
        listeners.add(notify);
        return () => {
          listeners.delete(notify);
        };
      },
      refresh: async () => {},
    },
    createClient: () => ({
      profile: createLawyersClient({ scope, request }),
      assets: createLawyerAssetsClient({
        scope,
        request,
        newKey: () => crypto.randomUUID(),
        fingerprintText: async () => "a".repeat(64),
        open: async () => {
          throw new Error("NATIVE_SOURCE_PORT_PROVED_SEPARATELY");
        },
        uploadContent: async () => {
          throw new Error("NO_JS_UPLOAD");
        },
        download: async (path) => {
          // Explicit HTTP fixture port; this proves signed API/sanitized content, not native device IO.
          const response = await transport(path, {
            method: "GET",
            headers: { "x-baro-expected-owner": f.actor.ownerId },
          });
          if (!response.ok) throw new ApiError("NOT_FOUND", "합성 읽기 거절");
          const bytes = new Uint8Array(await response.arrayBuffer());
          downloaded.push(bytes);
          const value = {
            size: bytes.length,
            sha256: "a".repeat(64),
            mimeType: response.headers.get("content-type") ?? "",
          };
          return { value, discard: async () => {} };
        },
      }),
    }),
    select: async () => null,
    release: async () => {},
    discard: async () => {},
    present: async (_value, _mode, _input, ensure) => {
      ensure();
    },
    newId: () => crypto.randomUUID(),
  });
  const stop = model.start();
  await until(() => !!model.getSnapshot().profile && !model.getSnapshot().busy);
  return {
    ...f,
    model,
    stop,
    downloaded,
    calls,
    env,
    app,
    peer,
    credentials,
    loseSave: () => {
      loseSave = true;
    },
    consent: () => {
      session = {
        ...session,
        phase: "consent",
        session: { user: session.session?.user ?? null, needsConsent: true },
      };
      for (const notify of listeners) notify();
    },
  };
}
test("native profile model + captured-cookie transport + signed Hono/SQL saves, resolves lost ACK, attaches only sanitized ready asset, publishes/withdraws then detaches/deletes", async () => {
  const f = await fixture();
  try {
    f.model.attach(f.params.assetId);
    expect(f.model.getSnapshot().draft?.photoAssetId).toBeUndefined();
    for (const [key, value] of Object.entries({
      name: "합성 변호사",
      introduction: "합성 소개",
      officeName: "합성 사무소",
      address: "합성 주소",
      email: "synthetic@example.invalid",
    }))
      f.model.field(key as "name", value);
    f.model.region("seoul");
    f.model.practice("civil");
    f.loseSave();
    await f.model.save();
    expect(f.model.getSnapshot().uncertain).toBe("save");
    await f.model.refresh();
    expect(f.model.getSnapshot().uncertain).toBeNull();
    expect(f.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    expect(
      await f.processing.sanitize(f.params, f.lease, new AbortController().signal),
    ).toMatchObject({ status: "ready" });
    await f.model.refresh();
    await f.model.preview(f.params.assetId);
    expect(f.downloaded[0]).toEqual(f.output);
    f.model.attach(f.params.assetId);
    await f.model.save();
    await f.model.refresh();
    expect(f.model.getSnapshot().profile?.photoAssetId).toBe(f.params.assetId);
    f.model.requestPublication(true);
    f.model.publicationConsent(true);
    await f.model.confirmAction();
    const id = f.model.getSnapshot().profile?.id,
      publicPath = `/api/v2/lawyers/self-service/${id}/assets/${f.params.assetId}`;
    expect(f.model.getSnapshot().profile?.published).toBe(true);
    expect(
      new Uint8Array(await (await f.app.request(publicPath, {}, f.env)).arrayBuffer()),
    ).toEqual(f.output);
    f.model.requestRemove(f.params.assetId);
    expect(f.model.getSnapshot().confirm).toBeNull();
    f.model.requestPublication(false);
    await f.model.confirmAction();
    expect((await f.app.request(publicPath, {}, f.env)).status).toBe(404);
    await f.model.preview(f.params.assetId);
    expect(f.downloaded.at(-1)).toEqual(f.output);
    f.model.removePhoto();
    await f.model.save();
    await f.model.refresh();
    f.model.requestRemove(f.params.assetId);
    f.model.confirmation("DELETE");
    await f.model.confirmAction();
    expect(f.model.getSnapshot().assets).toEqual([]);
    expect(f.model.getSnapshot().uncertain).toBeNull();
    expect(f.calls.filter((c) => c.method === "DELETE").map((c) => c.status)).toEqual([202]);
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_tombstones WHERE target_kind='asset' AND target_id=?")
        .get(f.params.assetId),
    ).toEqual({ n: 1 });
  } finally {
    f.stop();
  }
});
test("server consent, role and expected-owner checks still reject writes/reads despite an initially ready native screen", async () => {
  const f = await fixture();
  try {
    await f.processing.sanitize(f.params, f.lease, new AbortController().signal);
    f.db.sqlite
      .query("UPDATE user_consents SET privacy_version='stale' WHERE user_id=?")
      .run(f.actor.ownerId);
    f.model.field("name", "거절될 수정");
    await f.model.save();
    expect(f.calls.at(-1)?.status).toBe(403);
    expect(f.model.getSnapshot().canWrite).toBe(false);
    f.consent();
    await f.model.refresh();
    await until(() => !!f.model.getSnapshot().profile && !f.model.getSnapshot().busy);
    await f.model.preview(f.params.assetId);
    expect(f.downloaded.at(-1)).toEqual(f.output);
    await saveAccountType(f.db.binding, f.actor.ownerId, "customer");
    await f.model.refresh();
    expect(f.model.getSnapshot().profile).toBeNull();
    expect(f.model.getSnapshot().draft).toBeNull();
    await f.credentials.capture().accept(f.peer.cookie);
    // A still-captured feature owner is a denial hint even when native credentials now belong to a peer.
    await expect(
      f.app.request(
        "/api/v2/me/lawyer/self-profile",
        { headers: { cookie: f.peer.cookie, "x-baro-expected-owner": f.actor.ownerId } },
        f.env,
      ),
    ).resolves.toHaveProperty("status", 401);
  } finally {
    f.stop();
  }
});
