import { expect, test } from "bun:test";
import { createAccountClient } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { deletionAccessSchema } from "@baro/contracts/deletion";
import { splitSetCookieHeader } from "better-auth/cookies";
import { Hono } from "hono";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import { createSessionModel, type SessionModel } from "../apps/mobile/src/features/session/model";
import {
  createPendingAuthStore,
  parseNativeAuthReturn,
} from "../apps/mobile/src/platform/auth/attempt";
import { createNativeCredentials } from "../apps/mobile/src/platform/auth/credentials";
import { createNativeLogin } from "../apps/mobile/src/platform/auth/login";
import { createReauthenticationStore } from "../apps/mobile/src/platform/auth/reauthentication";
import { signOutNative } from "../apps/mobile/src/platform/auth/sign-out";
import { createNativeTransport } from "../apps/mobile/src/platform/auth/transport";
import { createMobileApi } from "../apps/mobile/src/platform/http";
import { api } from "../src/server/api";
import type { ApiEnvironment } from "../src/server/api/errors";
import { nativeAuthChallenge } from "../src/server/auth/native-codes";
import { createOAuthFixture, responseCookies } from "./helpers/oauth";

for (const provider of ["google", "naver", "kakao"] as const)
  test(`${provider}: native models complete the actual Hono/SQL callback, warm handoff, role, consent and logout`, async () => {
    const f = await createOAuthFixture(provider);
    try {
      const app = new Hono<ApiEnvironment>().route("/api", api);
      const config = resolveMobileConfig({
        environment: "local",
        apiBaseUrl: f.env.BETTER_AUTH_URL,
      });
      const scope = createSessionScope(),
        disk = new Map<string, string>();
      disk.set("synthetic_unresolved_case_key", "opaque-key");
      const storage = {
        getItemAsync: async (key: string) => disk.get(key) ?? null,
        setItemAsync: async (key: string, value: string) => {
          disk.set(key, value);
        },
        deleteItemAsync: async (key: string) => {
          disk.delete(key);
        },
      };
      const credentials = createNativeCredentials({
        scope,
        namespace: "baro_local_auth",
        storage,
        manageStorage: (value) => value,
        // Native SDK cookie encoding/chunking is covered by the actual SDK Jest
        // suite. This non-native adapter retains the real signed server cookie.
        codec: {
          header: (value) =>
            value ? ((JSON.parse(value) as { cookie?: string }).cookie ?? "") : "",
          merge: (header, previous) => {
            const map = new Map<string, string>();
            const cookie = previous
              ? ((JSON.parse(previous) as { cookie?: string }).cookie ?? "")
              : "";
            for (const entry of cookie.split(/;\s*/)) {
              const at = entry.indexOf("=");
              if (at > 0) map.set(entry.slice(0, at), entry.slice(at + 1));
            }
            for (const entry of splitSetCookieHeader(header)) {
              const first = entry.split(";")[0] ?? "",
                at = first.indexOf("=");
              if (at <= 0) continue;
              const name = first.slice(0, at),
                value = first.slice(at + 1);
              if (!value) map.delete(name);
              else map.set(name, value);
            }
            return JSON.stringify({
              cookie: [...map].map(([name, value]) => `${name}=${value}`).join("; "),
            });
          },
        },
      });
      let loseExchangeBody = false,
        lostBodies = 0;
      const nativeFetch = async (url: string, init: RequestInit) => {
        const response = await app.request(url, init, f.env);
        if (loseExchangeBody && new URL(url).pathname === "/api/mobile/auth/exchange") {
          loseExchangeBody = false;
          lostBodies++;
          // Real SQL consumes the grant and the real transport durably saves
          // Set-Cookie, then JSON reading fails as it can on a dropped stream.
          return new Proxy(response, {
            get(target, key) {
              if (key === "json")
                return async () => {
                  throw new Error("SYNTHETIC_DROPPED_BODY");
                };
              const value = Reflect.get(target, key, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        }
        return response;
      };
      const transport = createNativeTransport({ config, credentials, fetch: nativeFetch });
      const client = createMobileApi({
        config,
        scope,
        transport,
        fetch: nativeFetch,
        newKey: () => crypto.randomUUID(),
      });
      const attempts = createPendingAuthStore({
        key: "baro_local_auth_attempt",
        storage,
        now: Date.now,
      });
      const reauthentication = createReauthenticationStore({
        key: "baro_local_reauth_proof",
        storage,
      });
      const readSession = () => {
        client.session.invalidate();
        return client.session.get();
      };
      let model: SessionModel,
        incoming: Promise<void> = Promise.resolve();
      let grants = 0;
      const login = createNativeLogin({
        config,
        attempts,
        now: Date.now,
        newId: () => crypto.randomUUID(),
        proof: async () => ({
          verifier: "a".repeat(43),
          challenge: await nativeAuthChallenge("a".repeat(43)),
        }),
        resetCredentials: () => credentials.reset(),
        dismissBrowser: () => {},
        authorize: async (input) => {
          const response = await transport("/api/auth/sign-in/social", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...input, disableRedirect: true }),
          });
          expect(response.status).toBe(200);
          return (await response.json()) as { url: string };
        },
        openBrowser: async (url, returnURL) => {
          model.pause();
          const proxy = await app.request(url, {}, f.env);
          expect(proxy.status).toBe(302);
          const authorization = new URL(new URL(url).searchParams.get("authorizationURL") ?? "");
          const callback = await f.callback(
            authorization.searchParams.get("state") ?? "",
            responseCookies(proxy),
          );
          const raw = callback.headers.get("location") ?? "";
          expect(raw.startsWith(returnURL)).toBe(true);
          await model.resume();
          // The OS link and AuthSession both deliver this return. They must share
          // the grant and the model must not publish an older anonymous read.
          incoming = model.receiveReturn(raw);
          return { type: "success", url: raw };
        },
        exchange: (body) => {
          grants++;
          return client.request({ path: "/api/mobile/auth/exchange", method: "POST", body });
        },
        readSession,
        setAccountType: (role) => client.session.setAccountType(role),
        reauthentication: {
          proof: reauthentication,
          prepare: (body, ownerId) =>
            client.request({
              path: "/api/mobile/auth/reauth/prepare",
              method: "POST",
              body,
              expectedOwner: ownerId,
            }),
          verify: (body) =>
            client.request({ path: "/api/mobile/auth/reauth/verify", method: "POST", body }),
          access: async () =>
            deletionAccessSchema.parse(await client.request({ path: "/api/me/deletion" })),
        },
      });
      model = createSessionModel({
        scope,
        login,
        readSession,
        getConsent: () => client.session.getConsent(),
        saveConsent: (input) => client.session.saveConsent(input),
        openPolicy: async () => {},
        readReauthentication: async (ownerId) => {
          const account = createAccountClient({
            scope,
            newKey: () => crypto.randomUUID(),
            request: (path, init = {}) => client.request({ ...init, path, expectedOwner: ownerId }),
            readReauthentication: () => reauthentication.load(),
            reauthenticate: async (provider) => {
              await model.reauthenticate(provider);
            },
          });
          const access = await account.deletionAccess();
          return { providers: access.providers, verified: access.canDelete };
        },
        ownsReturn: async (raw) => {
          const returned = parseNativeAuthReturn(raw, config),
            pending = await attempts.load();
          return Boolean(returned && pending?.attemptId === returned.attemptId);
        },
        signOut: () =>
          signOutNative({
            config,
            scope,
            credentials,
            cancelLogin: () => login.cancel({ signOut: true }),
            fetch: nativeFetch,
          }),
      });
      await model.refresh();
      model.selectRole("lawyer");
      await model.signIn(provider);
      await incoming;
      expect(grants).toBe(1);
      expect(f.exchanges()).toBe(1);
      expect(model.getSnapshot()).toMatchObject({
        phase: "consent",
        role: "lawyer",
        session: { needsConsent: true },
      });
      await model.acceptConsent({ policies: true, over14: true });
      expect(model.getSnapshot()).toMatchObject({
        phase: "ready",
        role: "lawyer",
        session: { needsConsent: false },
      });
      await model.loadReauthentication();
      expect(model.getSnapshot().reauthentication).toMatchObject({
        providers: [provider],
        verified: false,
      });
      loseExchangeBody = provider === "naver";
      await model.reauthenticate(provider);
      await incoming;
      expect(model.getSnapshot()).toMatchObject({
        phase: "ready",
        role: "lawyer",
        reauthentication: { verified: true },
      });
      expect(grants).toBe(2);
      expect(f.exchanges()).toBe(2);
      expect(lostBodies).toBe(provider === "naver" ? 1 : 0);
      expect(await reauthentication.load()).not.toBeNull();
      const cookie = await credentials.capture().cookie();
      await model.signOut();
      expect(model.getSnapshot()).toMatchObject({ phase: "anonymous", error: null });
      expect(await credentials.capture().cookie()).toBe("");
      expect(await attempts.load()).toBeNull();
      expect(await reauthentication.load()).toBeNull();
      const old = await app.request("/api/me/session", { headers: { cookie } }, f.env);
      expect(((await old.json()) as { user: unknown }).user).toBeNull();
      expect(disk.get("synthetic_unresolved_case_key")).toBe("opaque-key");
    } finally {
      f.database.close();
    }
  });
