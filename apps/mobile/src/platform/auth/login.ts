import { ApiError } from "@baro/api-client";
import type { AccountType, Provider } from "@baro/client-core";
import {
  type MobileAuthExchange,
  mobileAuthExchangeResponseSchema,
} from "@baro/contracts/mobile-auth";
import type { ClientSession } from "@baro/contracts/session";
import type { MobileConfig } from "../../../config/environment";
import {
  nativeCallbackBase,
  nativeCallbackURL,
  type PendingAuthStore,
  parseNativeAuthReturn,
} from "./attempt";

export type NativeLoginResult =
  | { type: "verified"; session: ClientSession }
  | { type: "cancelled" }
  | { type: "ignored" };
const unavailable = () =>
  new ApiError("UNAVAILABLE", "로그인을 마치지 못했어요. 다시 시도해 주세요.", true);
const cancelled = () =>
  new ApiError("UNAUTHENTICATED", "로그인 시도가 변경됐어요. 다시 시작해 주세요.");

/** System browser and SDK IO are ports; cached identity never completes a login. */
export function createNativeLogin(dependencies: {
  config: MobileConfig;
  attempts: PendingAuthStore;
  now: () => number;
  newId: () => string;
  proof: () => Promise<{ verifier: string; challenge: string }>;
  resetCredentials: () => Promise<void>;
  authorize: (input: {
    provider: Provider;
    callbackURL: string;
    errorCallbackURL: string;
  }) => Promise<{ url: string; oauthState?: string }>;
  openBrowser: (
    url: string,
    returnURL: string,
  ) => Promise<{ type: "success"; url: string } | { type: "cancelled" }>;
  dismissBrowser: () => void;
  exchange: (input: MobileAuthExchange) => Promise<unknown>;
  readSession: () => Promise<ClientSession>;
  setAccountType: (accountType: AccountType) => Promise<unknown>;
}) {
  let version = 0;
  let activeAttemptId: string | undefined;
  // undefined allows recovery after a cold start; null explicitly retires all
  // stored returns while a replacement/cancellation is being persisted.
  let acceptedAttempt: string | null | undefined;
  let verifiedReturn: { version: number; attemptId: string; result: NativeLoginResult } | undefined;
  const readVerifiedReturn = () => verifiedReturn;
  const completions = new Map<string, Promise<NativeLoginResult>>();
  const ensure = (captured: number) => {
    if (captured !== version) throw cancelled();
  };
  const safe = (error: unknown) => (error instanceof ApiError ? error : unavailable());
  const complete = async (raw: string): Promise<NativeLoginResult> => {
    const returned = parseNativeAuthReturn(raw, dependencies.config);
    if (!returned) return { type: "ignored" };
    if (acceptedAttempt !== undefined && acceptedAttempt !== returned.attemptId)
      return { type: "ignored" };
    const captured = version;
    const attempt = await dependencies.attempts.load();
    ensure(captured);
    if (acceptedAttempt !== undefined && acceptedAttempt !== returned.attemptId)
      return { type: "ignored" };
    if (!attempt || attempt.attemptId !== returned.attemptId || attempt.purpose !== "login")
      return { type: "ignored" };
    activeAttemptId = attempt.attemptId;
    const identity = `${captured}:${returned.attemptId}`;
    const previous = completions.get(identity);
    if (previous) return previous;
    const task = (async (): Promise<NativeLoginResult> => {
      if (returned.type === "error") {
        await dependencies.attempts.clear(attempt.attemptId);
        ensure(captured);
        await dependencies.resetCredentials();
        ensure(captured);
        throw unavailable();
      }
      let session: ClientSession | undefined;
      try {
        mobileAuthExchangeResponseSchema.parse(
          await dependencies.exchange({
            attemptId: attempt.attemptId,
            code: returned.code,
            verifier: attempt.verifier,
          }),
        );
      } catch (error) {
        ensure(captured);
        // A response may be lost after the one-use grant's cookie was durably
        // saved. Verify that session rather than automatically replaying a code.
        if (!(error instanceof ApiError) || error.code !== "UNAVAILABLE") throw safe(error);
        session = await dependencies.readSession();
        if (!session.user) throw error;
      }
      ensure(captured);
      session ??= await dependencies.readSession();
      ensure(captured);
      if (!session.user) throw cancelled();
      const owner = session.user.id;
      await dependencies.setAccountType(attempt.accountType);
      ensure(captured);
      const verified = await dependencies.readSession();
      ensure(captured);
      if (verified.user?.id !== owner || verified.user.accountType !== attempt.accountType)
        throw cancelled();
      await dependencies.attempts.clear(attempt.attemptId);
      ensure(captured);
      if (activeAttemptId === attempt.attemptId) activeAttemptId = undefined;
      acceptedAttempt = null;
      const result: NativeLoginResult = { type: "verified", session: verified };
      verifiedReturn = { version: captured, attemptId: attempt.attemptId, result };
      return result;
    })().catch((error: unknown) => {
      throw safe(error);
    });
    completions.set(identity, task);
    void task
      .finally(() => {
        if (completions.get(identity) === task) completions.delete(identity);
      })
      .catch(() => {});
    return task;
  };
  return {
    complete,
    async start(provider: Provider, accountType: AccountType): Promise<NativeLoginResult> {
      const captured = ++version;
      acceptedAttempt = null;
      verifiedReturn = undefined;
      dependencies.dismissBrowser();
      try {
        await dependencies.resetCredentials();
        ensure(captured);
        const previous = await dependencies.attempts.load();
        ensure(captured);
        if (previous) await dependencies.attempts.clear(previous.attemptId);
        ensure(captured);
        const proof = await dependencies.proof();
        ensure(captured);
        const attemptId = dependencies.newId();
        activeAttemptId = attemptId;
        await dependencies.attempts.put({
          attemptId,
          verifier: proof.verifier,
          createdAt: dependencies.now(),
          provider,
          accountType,
          purpose: "login",
        });
        ensure(captured);
        acceptedAttempt = attemptId;
        const callbackURL = nativeCallbackURL(dependencies.config, attemptId, proof.challenge);
        const errorCallback = new URL(callbackURL);
        errorCallback.searchParams.set("error", "oauth");
        const authorization = await dependencies.authorize({
          provider,
          callbackURL,
          errorCallbackURL: errorCallback.href,
        });
        ensure(captured);
        const proxy = new URL("/api/auth/expo-authorization-proxy", dependencies.config.apiBaseUrl);
        proxy.searchParams.set("authorizationURL", authorization.url);
        if (authorization.oauthState)
          proxy.searchParams.set("oauthState", authorization.oauthState);
        // Android's listener matches a prefix. The returned URL drops challenge;
        // use the fixed base, then verify the exact nonce/code ourselves.
        const returned = await dependencies.openBrowser(
          proxy.href,
          nativeCallbackBase(dependencies.config),
        );
        ensure(captured);
        // Linking and AuthSession may deliver the same return in either order.
        // A browser dismiss must not erase a login already verified by Linking.
        const handoff = readVerifiedReturn();
        if (handoff?.version === captured && handoff.attemptId === attemptId) return handoff.result;
        if (returned.type === "cancelled") {
          const processing = completions.get(`${captured}:${attemptId}`);
          if (processing) return await processing;
          acceptedAttempt = null;
          await dependencies.attempts.clear(attemptId);
          ensure(captured);
          await dependencies.resetCredentials();
          ensure(captured);
          activeAttemptId = undefined;
          return { type: "cancelled" };
        }
        return await complete(returned.url);
      } catch (error) {
        ensure(captured);
        throw safe(error);
      }
    },
    async cancel() {
      const captured = ++version;
      acceptedAttempt = null;
      verifiedReturn = undefined;
      const attemptId = activeAttemptId;
      activeAttemptId = undefined;
      dependencies.dismissBrowser();
      try {
        await Promise.all([
          dependencies.resetCredentials(),
          (async () => {
            const pending = attemptId ? { attemptId } : await dependencies.attempts.load();
            ensure(captured);
            if (pending) await dependencies.attempts.clear(pending.attemptId);
          })(),
        ]);
      } catch (error) {
        throw safe(error);
      }
    },
  };
}
