import { ApiError } from "@baro/api-client";
import type { AccountType, Provider } from "@baro/client-core";
import {
  type MobileAuthExchange,
  type MobileReauthPrepare,
  type MobileReauthReceipt,
  mobileAuthExchangeResponseSchema,
  mobileReauthReceiptSchema,
} from "@baro/contracts/mobile-auth";
import type { ClientSession } from "@baro/contracts/session";
import type { MobileConfig } from "../../../config/environment";
import {
  nativeCallbackBase,
  nativeCallbackURL,
  type PendingAuthStore,
  parseNativeAuthReturn,
} from "./attempt";
import type { ReauthenticationStore } from "./reauthentication";

export type NativeLoginResult =
  | { type: "verified"; session: ClientSession; reauthentication?: MobileReauthReceipt }
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
  reauthentication?: {
    prepare(input: MobileReauthPrepare, ownerId: string): Promise<unknown>;
    verify(input: { attemptId: string; verifier: string }): Promise<unknown>;
    access(): Promise<{ ownerTag: string }>;
    proof: ReauthenticationStore;
  };
}) {
  let version = 0;
  let activeAttemptId: string | undefined;
  let activePurpose: "login" | "reauthenticate" | undefined;
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
    if (!attempt || attempt.attemptId !== returned.attemptId) return { type: "ignored" };
    activeAttemptId = attempt.attemptId;
    activePurpose = attempt.purpose;
    const identity = `${captured}:${returned.attemptId}`;
    const previous = completions.get(identity);
    if (previous) return previous;
    const task = (async (): Promise<NativeLoginResult> => {
      if (returned.type === "error") {
        await dependencies.attempts.clear(attempt.attemptId);
        ensure(captured);
        if (attempt.purpose === "login") await dependencies.resetCredentials();
        else await dependencies.reauthentication?.proof.clear();
        ensure(captured);
        throw unavailable();
      }
      if (attempt.purpose === "reauthenticate") {
        const reauth = dependencies.reauthentication,
          prepared = attempt.reauthentication;
        if (!reauth || !prepared) throw unavailable();
        const original = await dependencies.readSession();
        ensure(captured);
        if (!original.user) throw cancelled();
        const access = await reauth.access();
        ensure(captured);
        if (access.ownerTag !== prepared.ownerTag) throw cancelled();
        try {
          mobileAuthExchangeResponseSchema.parse(
            await dependencies.exchange({
              attemptId: attempt.attemptId,
              code: returned.code,
              verifier: attempt.verifier,
              purpose: "reauthenticate",
            }),
          );
        } catch (error) {
          ensure(captured);
          if (
            !(error instanceof ApiError) ||
            !["UNAVAILABLE", "UNAUTHENTICATED"].includes(error.code)
          )
            throw safe(error);
          // A consumed code is recoverable only through this attempt's exact signed new OAuth session.
        }
        const receipt = mobileReauthReceiptSchema.parse(
          await reauth.verify({ attemptId: attempt.attemptId, verifier: attempt.verifier }),
        );
        ensure(captured);
        if (receipt.ownerTag !== prepared.ownerTag || receipt.startedAt !== prepared.startedAt)
          throw cancelled();
        const session = await dependencies.readSession();
        ensure(captured);
        if (session.user?.id !== original.user.id) throw cancelled();
        await reauth.proof.put({ ...receipt, attemptId: attempt.attemptId });
        ensure(captured);
        await dependencies.attempts.clear(attempt.attemptId);
        ensure(captured);
        activeAttemptId = undefined;
        activePurpose = undefined;
        acceptedAttempt = null;
        const result: NativeLoginResult = { type: "verified", session, reauthentication: receipt };
        verifiedReturn = { version: captured, attemptId: attempt.attemptId, result };
        return result;
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
      activePurpose = undefined;
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
    async start(
      provider: Provider,
      accountType: AccountType,
      purpose?: "reauthenticate",
    ): Promise<NativeLoginResult> {
      const captured = ++version;
      acceptedAttempt = null;
      verifiedReturn = undefined;
      dependencies.dismissBrowser();
      activePurpose = purpose ?? "login";
      try {
        if (!purpose) await dependencies.resetCredentials();
        await dependencies.reauthentication?.proof.clear();
        ensure(captured);
        const previous = await dependencies.attempts.load();
        ensure(captured);
        if (previous) await dependencies.attempts.clear(previous.attemptId);
        ensure(captured);
        const proof = await dependencies.proof();
        ensure(captured);
        const attemptId = dependencies.newId();
        activeAttemptId = attemptId;
        let receipt: MobileReauthReceipt | undefined;
        if (purpose) {
          if (!dependencies.reauthentication) throw unavailable();
          const current = await dependencies.readSession();
          ensure(captured);
          if (!current.user) throw cancelled();
          receipt = mobileReauthReceiptSchema.parse(
            await dependencies.reauthentication.prepare(
              { attemptId, challenge: proof.challenge, provider },
              current.user.id,
            ),
          );
          ensure(captured);
        }
        await dependencies.attempts.put({
          attemptId,
          verifier: proof.verifier,
          createdAt: dependencies.now(),
          provider,
          accountType,
          purpose: purpose ?? "login",
          ...(receipt ? { reauthentication: receipt } : {}),
        });
        ensure(captured);
        acceptedAttempt = attemptId;
        const callbackURL = nativeCallbackURL(
          dependencies.config,
          attemptId,
          proof.challenge,
          purpose,
        );
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
          if (!purpose) await dependencies.resetCredentials();
          await dependencies.reauthentication?.proof.clear();
          ensure(captured);
          activeAttemptId = undefined;
          activePurpose = undefined;
          return { type: "cancelled" };
        }
        return await complete(returned.url);
      } catch (error) {
        ensure(captured);
        throw safe(error);
      }
    },
    async cancel(options: { signOut?: true } = {}) {
      const captured = ++version;
      acceptedAttempt = null;
      verifiedReturn = undefined;
      const attemptId = activeAttemptId;
      const purpose = activePurpose;
      activeAttemptId = undefined;
      activePurpose = undefined;
      dependencies.dismissBrowser();
      try {
        const pending = attemptId
          ? Promise.resolve({ attemptId, purpose })
          : dependencies.attempts.load();
        await Promise.all([
          options.signOut
            ? dependencies.resetCredentials()
            : (async () => {
                const attempt = await pending;
                ensure(captured);
                if ((purpose ?? attempt?.purpose) !== "reauthenticate")
                  await dependencies.resetCredentials();
              })(),
          dependencies.reauthentication?.proof.clear(),
          (async () => {
            const attempt = await pending;
            ensure(captured);
            if (attempt) await dependencies.attempts.clear(attempt.attemptId);
          })(),
        ]);
      } catch (error) {
        throw safe(error);
      }
    },
  };
}
