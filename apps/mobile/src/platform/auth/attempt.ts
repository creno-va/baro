import { ApiError } from "@baro/api-client";
import type { AccountType, MobileProvider } from "@baro/client-core";
import {
  type MobileReauthReceipt,
  mobileAuthAttemptIdSchema,
  mobileAuthReturnSchema,
  mobileAuthStartSchema,
  mobileAuthVerifierSchema,
  mobileReauthReceiptSchema,
} from "@baro/contracts/mobile-auth";
import type { MobileConfig } from "../../../config/environment";

export const NATIVE_AUTH_ATTEMPT_TTL_MS = 10 * 60_000;
export interface PendingAuthAttempt {
  attemptId: string;
  verifier: string;
  createdAt: number;
  accountType: AccountType;
  provider: MobileProvider;
  contractVersion?: 2;
  purpose: "login" | "reauthenticate";
  reauthentication?: MobileReauthReceipt;
}
export type NativeAuthReturn =
  | { type: "success"; attemptId: string; code: string }
  | { type: "error"; attemptId: string };

export const nativeCallbackBase = (config: MobileConfig) => `${config.scheme}://auth/callback`;
export function nativeCallbackURL(
  config: MobileConfig,
  attemptId: string,
  challenge: string,
  purpose?: "reauthenticate",
) {
  const input = mobileAuthStartSchema.parse({
    attemptId,
    challenge,
    ...(purpose ? { purpose } : {}),
  });
  const url = new URL(nativeCallbackBase(config));
  url.searchParams.set("attemptId", input.attemptId);
  url.searchParams.set("challenge", input.challenge);
  if (input.purpose) url.searchParams.set("purpose", input.purpose);
  return url.href;
}
/** Parse before any routing, diagnostics or exchange. Never accept cookie/token URL fields. */
export function parseNativeAuthReturn(raw: string, config: MobileConfig): NativeAuthReturn | null {
  try {
    if (raw.length > 1024) return null;
    const url = new URL(raw),
      expected = new URL(nativeCallbackBase(config));
    if (
      url.protocol !== expected.protocol ||
      url.hostname !== expected.hostname ||
      url.pathname !== expected.pathname ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      return null;
    for (const key of url.searchParams.keys())
      if (url.searchParams.getAll(key).length !== 1) return null;
    const input = Object.fromEntries(url.searchParams);
    const success = mobileAuthReturnSchema.safeParse(input);
    if (success.success) return { type: "success", ...success.data };
    if (
      Object.keys(input).length === 2 &&
      input.error === "oauth" &&
      mobileAuthAttemptIdSchema.safeParse(input.attemptId).success
    )
      return { type: "error", attemptId: mobileAuthAttemptIdSchema.parse(input.attemptId) };
    return null;
  } catch {
    return null;
  }
}

function parseAttempt(input: unknown): PendingAuthAttempt | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const expectedKeys = ["accountType", "attemptId", "createdAt", "provider", "purpose", "verifier"];
  if (value.purpose === "reauthenticate") expectedKeys.push("reauthentication");
  if (value.contractVersion === 2) expectedKeys.push("contractVersion");
  if (
    Object.keys(value).sort().join(",") !== expectedKeys.sort().join(",") ||
    !mobileAuthAttemptIdSchema.safeParse(value.attemptId).success ||
    !mobileAuthVerifierSchema.safeParse(value.verifier).success ||
    typeof value.createdAt !== "number" ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0 ||
    (value.accountType !== "customer" && value.accountType !== "lawyer") ||
    (value.provider !== "google" &&
      value.provider !== "naver" &&
      value.provider !== "kakao" &&
      !(value.provider === "apple" && value.contractVersion === 2)) ||
    (value.purpose !== "login" && value.purpose !== "reauthenticate")
  )
    return null;
  if (
    value.purpose === "reauthenticate" &&
    !mobileReauthReceiptSchema.safeParse(value.reauthentication).success
  )
    return null;
  return value as unknown as PendingAuthAttempt;
}
const unavailable = () =>
  new ApiError("UNAVAILABLE", "로그인 시도를 기기에 저장하지 못했어요. 다시 시도해 주세요.", true);
export function createPendingAuthStore(dependencies: {
  key: string;
  now: () => number;
  storage: {
    getItemAsync(key: string): Promise<string | null>;
    setItemAsync(key: string, value: string): Promise<void>;
    deleteItemAsync(key: string): Promise<void>;
  };
}) {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(dependencies.key))
    throw new Error("MOBILE_AUTH_ATTEMPT_KEY_INVALID");
  let pending: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>) => {
    const task = pending.then(operation).catch(() => {
      throw unavailable();
    });
    pending = task.catch(() => {});
    return task;
  };
  const validAge = (attempt: PendingAuthAttempt) => {
    const age = dependencies.now() - attempt.createdAt;
    return age >= 0 && age < NATIVE_AUTH_ATTEMPT_TTL_MS;
  };
  const read = async () => {
    const raw = await dependencies.storage.getItemAsync(dependencies.key);
    if (!raw) return null;
    try {
      return parseAttempt(JSON.parse(raw));
    } catch {
      return null;
    }
  };
  const remove = async () => {
    await dependencies.storage.deleteItemAsync(dependencies.key);
    if ((await dependencies.storage.getItemAsync(dependencies.key)) !== null) throw unavailable();
  };
  return {
    load: () =>
      serial(async () => {
        const attempt = await read();
        if (!attempt || !validAge(attempt)) {
          await remove();
          return null;
        }
        return { ...attempt };
      }),
    put: (input: PendingAuthAttempt) =>
      serial(async () => {
        const attempt = parseAttempt(input);
        if (!attempt || !validAge(attempt)) throw unavailable();
        const value = JSON.stringify(attempt);
        await dependencies.storage.setItemAsync(dependencies.key, value);
        if ((await dependencies.storage.getItemAsync(dependencies.key)) !== value)
          throw unavailable();
      }),
    clear: (attemptId: string) =>
      serial(async () => {
        const current = await read();
        // A cancelled older browser cannot erase a newer login's verifier.
        if (current?.attemptId === attemptId) await remove();
      }),
  };
}
export type PendingAuthStore = ReturnType<typeof createPendingAuthStore>;
