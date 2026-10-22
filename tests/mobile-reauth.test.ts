import { expect, test } from "bun:test";
import { ApiError } from "@baro/api-client";
import type { ClientSession } from "@baro/contracts/session";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import { createPendingAuthStore } from "../apps/mobile/src/platform/auth/attempt";
import { createNativeLogin } from "../apps/mobile/src/platform/auth/login";
import { createReauthenticationStore } from "../apps/mobile/src/platform/auth/reauthentication";

const attemptId = "15a64c18-fd51-4f83-8205-4c917a245e6b",
  receipt = { ownerTag: "a".repeat(64), startedAt: 900 };
const callback = `baro-preview://auth/callback?attemptId=${attemptId}&code=${"b".repeat(43)}`;
const owner = (id = "a"): ClientSession => ({
  user: { id, name: "합성 계정", accountType: "lawyer" },
  needsConsent: false,
});
function fixture() {
  const disk = new Map<string, string>([["unsettled_operation", "preserve"]]);
  let failProof = false,
    session = owner(),
    currentTag = receipt.ownerTag,
    newCookie = false,
    resets = 0,
    prepares = 0,
    exchanges = 0;
  let mode: "normal" | "lost-before-cookie" | "lost-after-cookie" = "normal",
    cancelBrowser = false,
    swapAfterProof = false;
  const storage = {
    getItemAsync: async (key: string) => disk.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      if (key === "auth_proof" && failProof) throw new Error("SYNTHETIC_LOCKED");
      disk.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      disk.delete(key);
    },
  };
  const attempts = createPendingAuthStore({ key: "auth_attempt", storage, now: () => 1000 }),
    proof = createReauthenticationStore({ key: "auth_proof", storage });
  const dependencies: Parameters<typeof createNativeLogin>[0] = {
    config: resolveMobileConfig({ environment: "preview" }),
    attempts,
    now: () => 1000,
    newId: () => attemptId,
    proof: async () => ({ verifier: "a".repeat(43), challenge: "c".repeat(43) }),
    resetCredentials: async () => {
      resets++;
      session = { user: null, needsConsent: false };
    },
    authorize: async ({ callbackURL }) => {
      expect(new URL(callbackURL).searchParams.get("purpose")).toBe("reauthenticate");
      expect(callbackURL.includes("ownerTag")).toBe(false);
      return { url: "https://synthetic.invalid/authorize" };
    },
    openBrowser: async () =>
      cancelBrowser ? { type: "cancelled" } : { type: "success", url: callback },
    dismissBrowser: () => {},
    exchange: async (input) => {
      exchanges++;
      expect(input.purpose).toBe("reauthenticate");
      if (newCookie) throw new ApiError("UNAUTHENTICATED", "합성 사용된 code");
      if (mode === "lost-before-cookie") throw new ApiError("UNAVAILABLE", "합성 전송 유실");
      newCookie = true;
      if (mode === "lost-after-cookie") throw new ApiError("UNAVAILABLE", "합성 본문 유실");
      return { status: "accepted" };
    },
    readSession: async () => session,
    setAccountType: async () => {
      throw new Error("REAUTH_MUST_NOT_CHANGE_ROLE");
    },
    reauthentication: {
      proof,
      access: async () => ({ ownerTag: currentTag }),
      prepare: async (_input, ownerId) => {
        prepares++;
        expect(ownerId).toBe("a");
        return receipt;
      },
      verify: async () => {
        if (!newCookie) throw new ApiError("UNAUTHENTICATED", "합성 이전 세션 거절");
        if (swapAfterProof) session = owner("b");
        return receipt;
      },
    },
  };
  return {
    disk,
    proof,
    attempts,
    dependencies,
    create: () => createNativeLogin(dependencies),
    stats: () => ({ resets, prepares, exchanges }),
    session: () => session,
    mode(value: typeof mode) {
      mode = value;
    },
    failProof(value: boolean) {
      failProof = value;
    },
    cancelBrowser() {
      cancelBrowser = true;
    },
    swapAfterProof() {
      swapAfterProof = true;
    },
    setTag(value: string) {
      currentTag = value;
    },
  };
}
test("reauthentication persists exact server proof without changing role, exposing owner metadata in URL or clearing case operations", async () => {
  const f = fixture(),
    login = f.create();
  expect(await login.start("google", "lawyer", "reauthenticate")).toMatchObject({
    type: "verified",
    session: owner(),
    reauthentication: receipt,
  });
  expect(await f.proof.load()).toEqual({ ...receipt, attemptId });
  expect(await f.attempts.load()).toBeNull();
  expect(f.stats()).toEqual({ resets: 0, prepares: 1, exchanges: 1 });
  expect(f.disk.get("unsettled_operation")).toBe("preserve");
});
test("an ambiguous body is recoverable only with the exact new-session proof, never an existing logged-in session", async () => {
  const before = fixture();
  before.mode("lost-before-cookie");
  await expect(before.create().start("google", "lawyer", "reauthenticate")).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(await before.proof.load()).toBeNull();
  expect(before.session()).toEqual(owner());
  const after = fixture();
  after.mode("lost-after-cookie");
  expect(await after.create().start("google", "lawyer", "reauthenticate")).toMatchObject({
    type: "verified",
  });
  expect(await after.proof.load()).toEqual({ ...receipt, attemptId });
});
test("cold completion after cookie save and a failed proof write verifies the consumed attempt against the new session", async () => {
  const f = fixture();
  f.failProof(true);
  await expect(f.create().start("google", "lawyer", "reauthenticate")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect((await f.attempts.load())?.purpose).toBe("reauthenticate");
  f.failProof(false);
  expect(await f.create().complete(callback)).toMatchObject({
    type: "verified",
    reauthentication: receipt,
  });
  expect(await f.attempts.load()).toBeNull();
  expect(f.stats().resets).toBe(0);
});
test("a browser cancellation preserves the old session, whereas explicit sign-out always clears the jar and proof", async () => {
  const f = fixture();
  f.cancelBrowser();
  const login = f.create();
  expect(await login.start("google", "lawyer", "reauthenticate")).toEqual({ type: "cancelled" });
  expect(f.session()).toEqual(owner());
  expect(await f.proof.load()).toBeNull();
  await login.cancel({ signOut: true });
  expect(f.stats().resets).toBe(1);
  expect(f.session().user).toBeNull();
  expect(f.disk.get("unsettled_operation")).toBe("preserve");
});
test("cancellation before proof generation does not clear the original credentials or dispatch a preparation", async () => {
  const f = fixture();
  let entered = () => {},
    release = () => {};
  const ready = new Promise<void>((done) => {
      entered = done;
    }),
    hold = new Promise<void>((done) => {
      release = done;
    });
  const make = f.dependencies.proof;
  f.dependencies.proof = async () => {
    entered();
    await hold;
    return make();
  };
  const login = f.create(),
    starting = login.start("google", "lawyer", "reauthenticate").catch((error: unknown) => error);
  await ready;
  await login.cancel();
  release();
  expect(await starting).toBeInstanceOf(ApiError);
  expect(f.stats()).toEqual({ resets: 0, prepares: 0, exchanges: 0 });
  expect(f.session()).toEqual(owner());
});
test("an owner change during proof verification cannot persist a marker or publish a verified result", async () => {
  const f = fixture();
  f.swapAfterProof();
  await expect(f.create().start("google", "lawyer", "reauthenticate")).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(await f.proof.load()).toBeNull();
  expect(f.stats().resets).toBe(0);
});

test("proof persistence rejects corrupt data and silent writes/deletes, then recovers without clearing other operations", async () => {
  const disk = new Map<string, string>([["other_operation", "preserve"]]);
  let ignoreWrite = true,
    ignoreDelete = false;
  const proof = createReauthenticationStore({
    key: "auth_proof",
    storage: {
      getItemAsync: async (key) => disk.get(key) ?? null,
      setItemAsync: async (key, value) => {
        if (!ignoreWrite) disk.set(key, value);
      },
      deleteItemAsync: async (key) => {
        if (!ignoreDelete) disk.delete(key);
      },
    },
  });
  await expect(proof.put({ ...receipt, attemptId })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  ignoreWrite = false;
  await proof.put({ ...receipt, attemptId });
  ignoreDelete = true;
  await expect(proof.clear()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  disk.set(
    "auth_proof",
    JSON.stringify({ ...receipt, attemptId, privateDetail: "SYNTHETIC_PRIVATE" }),
  );
  await expect(proof.load()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  ignoreDelete = false;
  await proof.clear();
  expect(await proof.load()).toBeNull();
  expect(disk.get("other_operation")).toBe("preserve");
});
