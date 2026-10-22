import { expect, test } from "bun:test";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import {
  createPendingAuthStore,
  NATIVE_AUTH_ATTEMPT_TTL_MS,
  nativeCallbackURL,
  type PendingAuthAttempt,
  parseNativeAuthReturn,
} from "../apps/mobile/src/platform/auth/attempt";
import { createNativeProof, encodeProofBytes } from "../apps/mobile/src/platform/auth/proof";

const config = resolveMobileConfig({ environment: "preview" });
const attempt: PendingAuthAttempt = {
  attemptId: "15a64c18-fd51-4f83-8205-4c917a245e6b",
  verifier: "a".repeat(43),
  createdAt: 1000,
  accountType: "customer",
  provider: "google",
  purpose: "login",
};
function fixture() {
  const disk = new Map<string, string>();
  let now = 1000;
  const storage = {
    getItemAsync: async (key: string) => disk.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      disk.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      disk.delete(key);
    },
  };
  const store = createPendingAuthStore({
    key: "baro_preview_auth_attempt",
    now: () => now,
    storage,
  });
  return {
    disk,
    storage,
    store,
    setNow: (value: number) => {
      now = value;
    },
  };
}

test("a pending attempt survives a process restart and an old cancellation cannot erase a new verifier", async () => {
  const f = fixture();
  await f.store.put(attempt);
  const restarted = createPendingAuthStore({
    key: "baro_preview_auth_attempt",
    now: () => 1001,
    storage: f.storage,
  });
  expect(await restarted.load()).toEqual(attempt);
  const fresh = {
    ...attempt,
    attemptId: "8ab4833d-b89b-4555-95f7-33f03ea46d6b",
    provider: "kakao" as const,
  };
  await f.store.put(fresh);
  await f.store.clear(attempt.attemptId);
  expect(await f.store.load()).toEqual(fresh);
  await f.store.clear(fresh.attemptId);
  expect(await f.store.load()).toBeNull();
});

test("expired, future and malformed pending proof is removed without becoming an auth result", async () => {
  for (const age of [NATIVE_AUTH_ATTEMPT_TTL_MS, -1]) {
    const f = fixture();
    await f.store.put(attempt);
    f.setNow(attempt.createdAt + age);
    expect(await f.store.load()).toBeNull();
    expect(f.disk.size).toBe(0);
  }
  for (const value of [
    "not json",
    JSON.stringify({ ...attempt, verifier: "invalid" }),
    JSON.stringify({ ...attempt, accountType: ["customer"] }),
    JSON.stringify({ ...attempt, narrative: "SYNTHETIC_PRIVATE_FACT" }),
  ]) {
    const f = fixture();
    f.disk.set("baro_preview_auth_attempt", value);
    expect(await f.store.load()).toBeNull();
    expect(f.disk.size).toBe(0);
  }
});

test("required pending storage readback and deletion errors are safe and never reported as success", async () => {
  const f = fixture();
  const silent = createPendingAuthStore({
    key: "baro_preview_auth_attempt",
    now: () => 1000,
    storage: { ...f.storage, setItemAsync: async () => {} },
  });
  await expect(silent.put(attempt)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  const thrown = createPendingAuthStore({
    key: "baro_preview_auth_attempt",
    now: () => 1000,
    storage: {
      ...f.storage,
      getItemAsync: async () => {
        throw new Error(`SYNTHETIC_PRIVATE_${attempt.verifier}`);
      },
    },
  });
  const error = await thrown.load().catch((value: unknown) => value);
  expect(error).toMatchObject({ code: "UNAVAILABLE" });
  expect(String(error)).not.toContain(attempt.verifier);
  await f.store.put(attempt);
  const sticky = createPendingAuthStore({
    key: "baro_preview_auth_attempt",
    now: () => 1000,
    storage: { ...f.storage, deleteItemAsync: async () => {} },
  });
  await expect(sticky.clear(attempt.attemptId)).rejects.toMatchObject({ code: "UNAVAILABLE" });
});

test("callback construction exposes only challenge/nonce and strict parsing rejects foreign or extra credential fields", () => {
  const start = new URL(nativeCallbackURL(config, attempt.attemptId, "b".repeat(43)));
  expect(start.origin).toBe("null");
  expect(start.searchParams.get("challenge")).toBe("b".repeat(43));
  expect(start.href).not.toContain(attempt.verifier);
  const returned = `${start.protocol}//auth/callback?attemptId=${attempt.attemptId}&code=${"c".repeat(43)}`;
  expect(parseNativeAuthReturn(returned, config)).toEqual({
    type: "success",
    attemptId: attempt.attemptId,
    code: "c".repeat(43),
  });
  expect(
    parseNativeAuthReturn(
      `baro-preview://auth/callback?error=oauth&attemptId=${attempt.attemptId}`,
      config,
    ),
  ).toEqual({ type: "error", attemptId: attempt.attemptId });
  for (const raw of [
    returned.replace("baro-preview:", "baro:"),
    returned.replace("//auth/", "//foreign/"),
    returned.replace("/callback?", "/other?"),
    returned.replace("//auth/", "//user:pass@auth/"),
    `${returned}#fragment`,
    `${returned}&cookie=synthetic`,
    `${returned}&token=synthetic`,
    `${returned}&code=${"d".repeat(43)}`,
    `${returned}&challenge=${"d".repeat(43)}`,
    "baro-preview://auth/callback?error=oauth",
    "not-a-url",
    "x".repeat(1025),
  ])
    expect(parseNativeAuthReturn(raw, config)).toBeNull();
});

test("native entropy/S256 encoding matches independent bytes and the PKCE reference challenge", async () => {
  for (let index = 0; index < 32; index++) {
    const bytes = Uint8Array.from({ length: 32 }, (_, offset) => (index * 31 + offset) % 256);
    expect(encodeProofBytes(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
  }
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const result = await createNativeProof({
    randomBytes: async () => Uint8Array.from(Buffer.from(verifier, "base64url")),
    sha256: async (value) =>
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  });
  expect(result).toEqual({ verifier, challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" });
  for (const length of [0, 31, 33])
    await expect(
      createNativeProof({
        randomBytes: async () => new Uint8Array(length),
        sha256: async () => new Uint8Array(32),
      }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
});
