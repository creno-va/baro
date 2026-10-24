import { ApiError } from "@baro/api-client";
import { mobileAuthAttemptIdSchema } from "@baro/contracts/mobile-auth";
import { randomUUID } from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { createNativeDeletionCleanup } from "../platform/account/deletion-cleanup";
import { createNativeDeletion } from "../platform/auth/deletion";
import { createNativeSocialAuthorization } from "../platform/auth/social";
import { getDeletionAttemptStore, newNativeProof } from "./auth-attempt";
import { readMobileConfig } from "./config";
import { getMobileCredentials } from "./credentials";
import { resetPrivateFiles } from "./files";
import { getNativeLogin } from "./login";
import { getMobileAuthClient } from "./mobile-auth";
import { getSessionModel } from "./session";

const changed = () =>
  new ApiError("UNAUTHENTICATED", "삭제할 계정이 변경됐어요. 현재 계정을 다시 확인해 주세요.");
export function createNativeDeletionCoordinator() {
  const config = readMobileConfig(),
    { scope, credentials } = getMobileCredentials(),
    attempts = getDeletionAttemptStore();
  const cleanup = createNativeDeletionCleanup({
    scope,
    credentials,
    session: () => getSessionModel().getSnapshot(),
    resetPrivateFiles,
    cancelLogin: (options) => getNativeLogin().cancel(options),
  });
  const authorize = createNativeSocialAuthorization({
    config,
    credentials,
    fetch: (url, init) => fetch(url, init),
  });
  const native = createNativeDeletion({
    config,
    client: getMobileAuthClient(),
    attempts,
    now: Date.now,
    newId: randomUUID,
    proof: newNativeProof,
    begin(ownerId) {
      const state = getSessionModel().getSnapshot();
      if (!["ready", "consent"].includes(state.phase) || state.session?.user?.id !== ownerId)
        throw changed();
      scope.invalidate();
      const generation = scope.snapshot();
      return {
        ensureCurrent: () => {
          if (!scope.isCurrent(generation)) throw changed();
        },
      };
    },
    authorize: async (input, ensureCurrent) => {
      if (!ensureCurrent) throw changed();
      const response = await authorize(input, ensureCurrent);
      ensureCurrent();
      const attemptId = mobileAuthAttemptIdSchema.parse(
        new URL(input.callbackURL).searchParams.get("attemptId"),
      );
      const pending = (await attempts.list()).find((record) => record.attemptId === attemptId);
      ensureCurrent();
      if (!pending || pending.state !== "pending" || pending.provider !== input.provider)
        throw changed();
      cleanup.bind(attemptId, pending.ownerId);
      return response;
    },
    openBrowser: async (url, returnURL) => {
      const result = await WebBrowser.openAuthSessionAsync(url, returnURL, {
        preferEphemeralSession: true,
      });
      return result.type === "success"
        ? { type: "success", url: result.url }
        : { type: "cancelled" };
    },
    cleanup: (record) => cleanup.cleanup(record),
  });
  return {
    ...native,
    async clearAnonymousDevice(attemptId: string) {
      const record = (await attempts.list()).find((value) => value.attemptId === attemptId);
      if (!record || record.state !== "accepted") throw changed();
      await cleanup.clearAnonymous(record);
      await attempts.markCleanup(attemptId, "complete");
    },
  };
}
let coordinator: ReturnType<typeof createNativeDeletionCoordinator> | undefined;
export function getNativeDeletion() {
  coordinator ??= createNativeDeletionCoordinator();
  return coordinator;
}
