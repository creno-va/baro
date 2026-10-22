import { expect, test } from "bun:test";
import { ApiError } from "@baro/api-client";
import type { AccountType } from "@baro/client-core";
import type { ClientSession } from "@baro/contracts/session";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import { createPendingAuthStore } from "../apps/mobile/src/platform/auth/attempt";
import { createNativeLogin } from "../apps/mobile/src/platform/auth/login";

const attemptId = "15a64c18-fd51-4f83-8205-4c917a245e6b";
const verifier = "a".repeat(43),
  code = "b".repeat(43),
  challenge = "c".repeat(43);
const callback = `baro-preview://auth/callback?attemptId=${attemptId}&code=${code}`;
const config = resolveMobileConfig({ environment: "preview" });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  let stored: string | null = null;
  const attempts = createPendingAuthStore({
    key: "baro_preview_auth_attempt",
    now: () => 1000,
    storage: {
      getItemAsync: async () => stored,
      setItemAsync: async (_key, value) => {
        stored = value;
      },
      deleteItemAsync: async () => {
        stored = null;
      },
    },
  });
  let session: ClientSession = { user: null, needsConsent: false };
  let exchanges = 0,
    roles = 0,
    resets = 0,
    reads = 0;
  const dependencies: Parameters<typeof createNativeLogin>[0] = {
    config,
    attempts,
    now: () => 1000,
    newId: () => attemptId,
    proof: async () => ({ verifier, challenge }),
    resetCredentials: async () => {
      resets++;
      session = { user: null, needsConsent: false };
    },
    authorize: async ({ provider, callbackURL, errorCallbackURL }) => {
      expect(await attempts.load()).toMatchObject({ attemptId, verifier, provider });
      expect(new URL(callbackURL).searchParams.get("challenge")).toBe(challenge);
      expect(callbackURL).not.toContain(verifier);
      expect(new URL(errorCallbackURL).searchParams.get("error")).toBe("oauth");
      return { url: `https://synthetic-provider.invalid/authorize?provider=${provider}` };
    },
    openBrowser: async (url, returnURL) => {
      expect(new URL(url).origin).toBe(config.apiBaseUrl);
      expect(new URL(url).pathname).toBe("/api/auth/expo-authorization-proxy");
      expect(returnURL).toBe("baro-preview://auth/callback");
      return { type: "success", url: callback };
    },
    dismissBrowser: () => {},
    exchange: async (input) => {
      exchanges++;
      expect(input).toEqual({ attemptId, code, verifier });
      session = {
        user: { id: "synthetic-owner", name: "합성", accountType: "customer" },
        needsConsent: true,
      };
      return { status: "accepted" };
    },
    readSession: async () => {
      reads++;
      return session;
    },
    setAccountType: async (accountType: AccountType) => {
      roles++;
      if (session.user) session = { ...session, user: { ...session.user, accountType } };
    },
  };
  return {
    dependencies,
    attempts,
    stats: () => ({ exchanges, roles, resets, reads }),
    setSession: (value: ClientSession) => {
      session = value;
    },
  };
}

test("all existing providers persist proof before browser IO and finish with fresh owner, role and consent state", async () => {
  for (const provider of ["google", "naver", "kakao"] as const) {
    const f = fixture(),
      login = createNativeLogin(f.dependencies);
    expect(await login.start(provider, "lawyer")).toEqual({
      type: "verified",
      session: {
        user: { id: "synthetic-owner", name: "합성", accountType: "lawyer" },
        needsConsent: true,
      },
    });
    expect(f.stats()).toEqual({ exchanges: 1, roles: 1, resets: 1, reads: 2 });
    expect(await f.attempts.load()).toBeNull();
    expect(await login.complete(callback)).toEqual({ type: "ignored" });
  }
});

test("cold and warm duplicate returns share one exchange; another nonce never starts an exchange", async () => {
  const f = fixture(),
    gate = deferred<unknown>(),
    entered = deferred<void>();
  await f.attempts.put({
    attemptId,
    verifier,
    createdAt: 1000,
    provider: "google",
    accountType: "customer",
    purpose: "login",
  });
  const exchange = f.dependencies.exchange;
  f.dependencies.exchange = async (input) => {
    entered.resolve();
    await gate.promise;
    return exchange(input);
  };
  const login = createNativeLogin(f.dependencies);
  const first = login.complete(callback);
  await entered.promise;
  const second = login.complete(callback);
  expect(
    await login.complete(callback.replace(attemptId, "8ab4833d-b89b-4555-95f7-33f03ea46d6b")),
  ).toEqual({ type: "ignored" });
  gate.resolve({});
  expect((await first).type).toBe("verified");
  expect((await second).type).toBe("verified");
  expect(f.stats().exchanges).toBe(1);
});

test("cancelling an open browser retires late completion and clears the persisted attempt", async () => {
  const f = fixture(),
    gate = deferred<{ type: "success"; url: string }>(),
    entered = deferred<void>();
  f.dependencies.openBrowser = async () => {
    entered.resolve();
    return gate.promise;
  };
  const login = createNativeLogin(f.dependencies);
  const pending = login.start("naver", "customer");
  void pending.catch(() => {});
  await entered.promise;
  await login.cancel();
  gate.resolve({ type: "success", url: callback });
  await expect(pending).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.stats().exchanges).toBe(0);
  expect(await f.attempts.load()).toBeNull();
  expect(await login.complete(callback)).toEqual({ type: "ignored" });
});

test("an ambiguous exchange only recovers through the actual session; invalid proof never grants recovery", async () => {
  for (const kind of ["UNAVAILABLE", "UNAUTHENTICATED"] as const) {
    const f = fixture(),
      original = f.dependencies.exchange;
    f.dependencies.exchange = async (input) => {
      await original(input);
      throw new ApiError(kind, "합성 응답 유실");
    };
    const login = createNativeLogin(f.dependencies);
    if (kind === "UNAVAILABLE")
      expect((await login.start("google", "customer")).type).toBe("verified");
    else
      await expect(login.start("google", "customer")).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
    expect(f.stats().exchanges).toBe(1);
    expect(f.stats().reads).toBe(kind === "UNAVAILABLE" ? 2 : 0);
  }
});

test("starting a replacement blocks the old return before proof generation and cold cancellation removes storage", async () => {
  const f = fixture();
  await f.attempts.put({
    attemptId,
    verifier,
    createdAt: 1000,
    provider: "google",
    accountType: "customer",
    purpose: "login",
  });
  await createNativeLogin(f.dependencies).cancel();
  expect(await f.attempts.load()).toBeNull();
  await f.attempts.put({
    attemptId,
    verifier,
    createdAt: 1000,
    provider: "google",
    accountType: "customer",
    purpose: "login",
  });
  const gate = deferred<{ verifier: string; challenge: string }>(),
    entered = deferred<void>();
  f.dependencies.proof = async () => {
    entered.resolve();
    return gate.promise;
  };
  const login = createNativeLogin(f.dependencies);
  const pending = login.start("kakao", "lawyer");
  void pending.catch(() => {});
  await entered.promise;
  expect(await login.complete(callback)).toEqual({ type: "ignored" });
  await login.cancel();
  gate.resolve({ verifier, challenge });
  await expect(pending).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.stats().exchanges).toBe(0);
});

test("storage failure and browser dismissal cannot reach an exchange", async () => {
  const locked = fixture();
  let authorizations = 0;
  locked.dependencies.authorize = async () => {
    authorizations++;
    return { url: "https://synthetic.invalid" };
  };
  locked.dependencies.attempts = {
    ...locked.attempts,
    put: async () => {
      throw new Error("SYNTHETIC_PRIVATE_STORAGE");
    },
  };
  const error = await createNativeLogin(locked.dependencies)
    .start("google", "customer")
    .catch((value: unknown) => value);
  expect(error).toMatchObject({ code: "UNAVAILABLE" });
  expect(String(error)).not.toContain("SYNTHETIC_PRIVATE_STORAGE");
  expect(authorizations).toBe(0);
  expect(locked.stats().exchanges).toBe(0);
  const dismissed = fixture();
  dismissed.dependencies.openBrowser = async () => ({ type: "cancelled" });
  expect(await createNativeLogin(dismissed.dependencies).start("google", "customer")).toEqual({
    type: "cancelled",
  });
  expect(dismissed.stats().exchanges).toBe(0);
  expect(await dismissed.attempts.load()).toBeNull();
});

test("cancellation during exchange cannot apply a role or publish a verified session", async () => {
  const f = fixture(),
    gate = deferred<void>(),
    entered = deferred<void>();
  const exchange = f.dependencies.exchange;
  f.dependencies.exchange = async (input) => {
    entered.resolve();
    await gate.promise;
    return exchange(input);
  };
  const login = createNativeLogin(f.dependencies);
  const pending = login.start("kakao", "lawyer");
  void pending.catch(() => {});
  await entered.promise;
  await login.cancel();
  gate.resolve();
  await expect(pending).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.stats().roles).toBe(0);
  expect(await f.attempts.load()).toBeNull();
});

test("an accepted exchange cannot grant login without the actual owner and exact role readback", async () => {
  for (const mode of ["anonymous", "changed-owner", "wrong-role"] as const) {
    const f = fixture();
    let reads = 0;
    f.dependencies.readSession = async () => {
      reads++;
      if (mode === "anonymous") return { user: null, needsConsent: false };
      return {
        user: {
          id: mode === "changed-owner" && reads > 1 ? "synthetic-other" : "synthetic-owner",
          name: "합성",
          accountType: mode === "wrong-role" ? "customer" : "lawyer",
        },
        needsConsent: true,
      };
    };
    await expect(createNativeLogin(f.dependencies).start("naver", "lawyer")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(await f.attempts.load()).not.toBeNull();
    if (mode === "anonymous") expect(f.stats().roles).toBe(0);
  }
});

test("a warm Linking completion wins before AuthSession dismissal without clearing the verified login", async () => {
  const f = fixture(),
    gate = deferred<{ type: "cancelled" }>(),
    entered = deferred<void>();
  f.dependencies.openBrowser = async () => {
    entered.resolve();
    return gate.promise;
  };
  const login = createNativeLogin(f.dependencies);
  const browser = login.start("google", "lawyer");
  await entered.promise;
  expect((await login.complete(callback)).type).toBe("verified");
  gate.resolve({ type: "cancelled" });
  expect((await browser).type).toBe("verified");
  expect(f.stats().resets).toBe(1);
  expect(f.stats().exchanges).toBe(1);
});
