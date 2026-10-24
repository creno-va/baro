import { ApiError } from "@baro/api-client";
import type { SessionScope } from "@baro/client-core";
import type { ClientSession } from "@baro/contracts/session";
import type { NativeCredentials } from "../auth/credentials";
import type { DeletionAttemptRecord } from "../auth/deletion-attempt";
import { createAccountCleanup } from "./cleanup";

type Accepted = Extract<DeletionAttemptRecord, { state: "accepted" }>;
const unavailable = () =>
  new ApiError(
    "UNAVAILABLE",
    "기기의 이전 로그인 상태를 안전하게 정리하지 못했어요. 현재 계정을 확인해 주세요.",
    true,
  );

/** A warm authorization can retire only its own unchanged cookie writer. No receipt reads a new jar. */
export function createNativeDeletionCleanup(dependencies: {
  scope: SessionScope;
  credentials: Pick<NativeCredentials, "revision" | "isRevisionCurrent">;
  session(): { phase: string; session: ClientSession | null };
  resetPrivateFiles(): Promise<void>;
  /** Must start its credential reset synchronously, as NativeLogin.cancel(signOut) does. */
  cancelLogin(options: { signOut: true }): Promise<void>;
}) {
  const bindings = new Map<string, { ownerId: string; revision: number }>();
  const runCleanup = (ensureCurrent: () => void, onReset?: (revision: number) => void) => {
    let observedReset = false;
    const cleanup = createAccountCleanup({
      resetPrivateFiles: dependencies.resetPrivateFiles,
      cancelLogin(options) {
        ensureCurrent();
        const previous = dependencies.credentials.revision();
        const task = dependencies.cancelLogin(options);
        const next = dependencies.credentials.revision();
        if (next === previous + 1) {
          observedReset = true;
          onReset?.(next);
        }
        return task;
      },
    });
    return async (ownerId: string) => {
      await cleanup({ ownerId, ensureCurrent });
      if (!observedReset) throw unavailable();
    };
  };
  return {
    bind(attemptId: string, ownerId: string) {
      const state = dependencies.session();
      if (
        !["ready", "consent"].includes(state.phase) ||
        state.session?.user?.id !== ownerId ||
        (bindings.size >= 4 && !bindings.has(attemptId))
      )
        throw unavailable();
      bindings.set(attemptId, { ownerId, revision: dependencies.credentials.revision() });
    },
    async cleanup(record: Accepted): Promise<"complete" | "skipped"> {
      const state = dependencies.session(),
        owner = state.session?.user?.id;
      if (owner && owner !== record.ownerId) {
        bindings.delete(record.attemptId);
        return "skipped";
      }
      const binding = bindings.get(record.attemptId);
      if (
        state.phase === "authorizing" ||
        !binding ||
        binding.ownerId !== record.ownerId ||
        !dependencies.credentials.isRevisionCurrent(binding.revision)
      )
        throw unavailable();
      const generation = dependencies.scope.snapshot();
      const ensureCurrent = () => {
        if (
          !dependencies.scope.isCurrent(generation) ||
          !dependencies.credentials.isRevisionCurrent(binding.revision)
        )
          throw unavailable();
      };
      let ownResetRevision: number | undefined;
      const cleanup = runCleanup(ensureCurrent, (revision) => {
        ownResetRevision = revision;
      });
      try {
        await cleanup(record.ownerId);
        bindings.delete(record.attemptId);
        return "complete";
      } catch {
        // Permit retry of our own failed reset/file cleanup, never the reset of
        // a replacement login that overtook us before cancelLogin was called.
        if (
          ownResetRevision !== undefined &&
          dependencies.credentials.isRevisionCurrent(ownResetRevision)
        )
          bindings.set(record.attemptId, { ownerId: record.ownerId, revision: ownResetRevision });
        throw unavailable();
      }
    },
    /** Only an explicit user action after a verified anonymous session; never receipt-driven. */
    async clearAnonymous(record: Accepted) {
      const state = dependencies.session();
      if (state.phase !== "anonymous" || state.session?.user) throw unavailable();
      const generation = dependencies.scope.snapshot(),
        revision = dependencies.credentials.revision();
      const ensureCurrent = () => {
        const current = dependencies.session();
        if (
          current.phase !== "anonymous" ||
          current.session?.user ||
          !dependencies.scope.isCurrent(generation) ||
          !dependencies.credentials.isRevisionCurrent(revision)
        )
          throw unavailable();
      };
      try {
        await runCleanup(ensureCurrent)(record.ownerId);
        bindings.delete(record.attemptId);
      } catch {
        throw unavailable();
      }
    },
  };
}
