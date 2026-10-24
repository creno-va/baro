import { ApiError, type MobileAuthClient } from "@baro/api-client";
import type { MobileProvider } from "@baro/client-core";
import {
  type MobileDeletionOutcome,
  mobileDeletionOutcomeSchema,
  mobileDeletionPrepareReceiptSchema,
  mobileDeletionStartSchema,
} from "@baro/contracts/mobile-deletion";
import type { MobileConfig } from "../../../config/environment";
import { nativeCallbackBase, parseNativeAuthReturn } from "./attempt";
import type {
  DeletionAttemptRecord,
  DeletionAttemptStore,
  DeletionProofRecord,
  PendingDeletionAttempt,
} from "./deletion-attempt";
import type { createNativeLogin } from "./login";

type AcceptedRecord = Extract<DeletionAttemptRecord, { state: "accepted" }>;
export type NativeDeletionResult =
  | {
      type: "accepted";
      attemptId: string;
      ownerId: string;
      outcome: MobileDeletionOutcome;
      cleanup: AcceptedRecord["cleanup"];
      localSaved: boolean;
    }
  | { type: "cancelled"; attemptId: string; ownerId: string }
  | { type: "inactive"; attemptId: string; ownerId: string; observedAt: string }
  | { type: "unknown"; attemptId: string }
  | { type: "ignored" };
const unavailable = () =>
  new ApiError("UNAVAILABLE", "삭제 상태를 확인하지 못했어요. 결과를 다시 확인해 주세요.", true);

/** No callback here grants a login. Only proof-bound receipts establish deletion/cancellation. */
export function createNativeDeletion(dependencies: {
  config: MobileConfig;
  client: MobileAuthClient;
  attempts: DeletionAttemptStore;
  now(): number;
  newId(): string;
  proof(): Promise<{ verifier: string; challenge: string }>;
  begin(ownerId: string): { ensureCurrent(): void };
  authorize: Parameters<typeof createNativeLogin>[0]["authorize"];
  openBrowser: Parameters<typeof createNativeLogin>[0]["openBrowser"];
  cleanup(record: AcceptedRecord): Promise<"complete" | "skipped">;
}) {
  let starting = false;
  const operations = new Map<string, Promise<NativeDeletionResult>>();
  const unknown = (attemptId: string): NativeDeletionResult => ({ type: "unknown", attemptId });
  const coalesce = (key: string, operation: () => Promise<NativeDeletionResult>) => {
    const previous = operations.get(key);
    if (previous) return previous;
    const task = operation();
    operations.set(key, task);
    void task
      .finally(() => {
        if (operations.get(key) === task) operations.delete(key);
      })
      .catch(() => {});
    return task;
  };
  const read = async (id: string) =>
    (await dependencies.attempts.list()).find((r) => r.attemptId === id);
  async function settled(
    record: Exclude<DeletionAttemptRecord, PendingDeletionAttempt>,
  ): Promise<NativeDeletionResult> {
    if (record.state === "cancelled")
      return { type: "cancelled", attemptId: record.attemptId, ownerId: record.ownerId };
    if (record.state === "inactive")
      return {
        type: "inactive",
        attemptId: record.attemptId,
        ownerId: record.ownerId,
        observedAt: record.observedAt,
      };
    return coalesce(`cleanup:${record.attemptId}`, async () => {
      let cleanup = record.cleanup,
        localSaved = true;
      if (cleanup === "pending" || cleanup === "failed") {
        try {
          cleanup = await dependencies.cleanup(record);
        } catch {
          cleanup = "failed";
        }
        try {
          await dependencies.attempts.markCleanup(record.attemptId, cleanup);
        } catch {
          localSaved = false;
          cleanup = "failed";
        }
      }
      return {
        type: "accepted",
        attemptId: record.attemptId,
        ownerId: record.ownerId,
        outcome: record.outcome,
        cleanup,
        localSaved,
      };
    });
  }
  async function accepted(
    record: DeletionProofRecord,
    input: unknown,
  ): Promise<NativeDeletionResult> {
    const outcome = mobileDeletionOutcomeSchema.parse(input);
    if (outcome.ownerTag !== record.ownerTag) throw unavailable();
    let saved: AcceptedRecord;
    try {
      saved = await dependencies.attempts.accept(record.attemptId, outcome);
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") return unknown(record.attemptId);
      // A valid server ACK stays accepted even if local persistence fails. Never clean another scope blindly.
      return {
        type: "accepted",
        attemptId: record.attemptId,
        ownerId: record.ownerId,
        outcome,
        cleanup: "failed",
        localSaved: false,
      };
    }
    return settled(saved);
  }
  async function inspect(record: DeletionProofRecord): Promise<NativeDeletionResult> {
    try {
      return await accepted(
        record,
        await dependencies.client.deletionStatus(
          { attemptId: record.attemptId, verifier: record.verifier },
          record.ownerTag,
        ),
      );
    } catch {
      return record.state === "inactive" ? settled(record) : unknown(record.attemptId);
    }
  }
  const status = (id: string) =>
    coalesce(`status:${id}`, async () => {
      const record = await read(id);
      if (!record) return { type: "ignored" };
      return record.state === "pending" || record.state === "inactive"
        ? inspect(record)
        : settled(record);
    });
  const reconcile = (id: string) =>
    coalesce(`reconcile:${id}`, async () => {
      const record = await read(id);
      if (!record) return { type: "ignored" };
      if (record.state !== "pending") return status(id);
      const result = await inspect(record);
      if (result.type !== "unknown" || !record.activity) return result;
      try {
        const observation = await dependencies.client.deletionActivity({
          attemptId: id,
          verifier: record.verifier,
          ownerTag: record.ownerTag,
          ...record.activity,
        });
        if (observation.status !== "inactive") return unknown(id);
        // Commit may have won the activity CAS race. Prefer its receipt while still valid.
        const final = await inspect(record);
        if (final.type !== "unknown") return final;
        const saved = await dependencies.attempts.observeInactive(id, observation);
        return saved.state === "pending" ? unknown(id) : settled(saved);
      } catch {
        return unknown(id);
      }
    });
  const cancel = (id: string) =>
    coalesce(`cancel:${id}`, async () => {
      const record = await read(id);
      if (!record) return { type: "ignored" };
      if (record.state !== "pending") return status(id);
      try {
        const result = await dependencies.client.cancelDeletion(
          { attemptId: id, verifier: record.verifier },
          record.ownerTag,
        );
        if (result.status === "accepted") return await accepted(record, result);
        if (result.status !== "cancelled") return unknown(id);
        const saved = await dependencies.attempts.cancel(id);
        return settled(saved);
      } catch {
        return unknown(id);
      }
    });
  const complete = async (raw: string): Promise<NativeDeletionResult> => {
    const returned = parseNativeAuthReturn(raw, dependencies.config);
    if (!returned) return { type: "ignored" };
    return coalesce(`return:${returned.attemptId}`, async () => {
      const record = await read(returned.attemptId);
      if (!record) return { type: "ignored" };
      if (record.state !== "pending") return status(record.attemptId);
      if (returned.type === "error") return inspect(record);
      try {
        return await accepted(
          record,
          await dependencies.client.exchangeDeletion(
            { attemptId: record.attemptId, verifier: record.verifier, code: returned.code },
            record.ownerTag,
          ),
        );
      } catch {
        // One used/lost code can recover only through the same verifier receipt. No auth exchange or delete replay.
        return inspect(record);
      }
    });
  };
  return {
    complete,
    status,
    reconcile,
    cancel,
    async start(
      provider: MobileProvider,
      confirmation: string,
      ownerId: string,
    ): Promise<NativeDeletionResult> {
      if (starting) throw new ApiError("CONFLICT", "진행 중인 삭제 확인을 먼저 마쳐 주세요.");
      if (confirmation !== "DELETE")
        throw new ApiError("VALIDATION_ERROR", "삭제 확인란에 DELETE를 입력해 주세요.");
      starting = true;
      let pending: PendingDeletionAttempt | undefined;
      try {
        const guard = dependencies.begin(ownerId),
          protocol = await dependencies.client.capabilities();
        guard.ensureCurrent();
        if (
          protocol.contractVersion !== 2 ||
          protocol.deletionActivity !== 1 ||
          !protocol.providers.some((p) => p === provider)
        )
          throw unavailable();
        const access = await dependencies.client.deletionAccess(protocol, ownerId);
        guard.ensureCurrent();
        if (!access.providers.some((p) => p === provider))
          throw new ApiError(
            "VALIDATION_ERROR",
            "삭제할 계정에 연결된 로그인 수단을 선택해 주세요.",
          );
        const proof = await dependencies.proof();
        guard.ensureCurrent();
        const record: PendingDeletionAttempt = {
          state: "pending",
          attemptId: dependencies.newId(),
          ownerId,
          ownerTag: access.ownerTag,
          provider,
          verifier: proof.verifier,
          createdAt: dependencies.now(),
        };
        await dependencies.attempts.preflight(record);
        guard.ensureCurrent();
        const prepared = mobileDeletionPrepareReceiptSchema.parse(
          await dependencies.client.prepareDeletion(
            protocol,
            {
              attemptId: record.attemptId,
              challenge: proof.challenge,
              provider,
              confirmation: "DELETE",
            },
            ownerId,
          ),
        );
        guard.ensureCurrent();
        if (prepared.ownerTag !== record.ownerTag) throw unavailable();
        const durable: PendingDeletionAttempt = {
          ...record,
          activity: { startedAt: prepared.startedAt, activityProof: prepared.activityProof },
        };
        await dependencies.attempts.put(durable);
        pending = durable;
        guard.ensureCurrent();
        const callback = new URL(nativeCallbackBase(dependencies.config));
        for (const [key, value] of Object.entries(
          mobileDeletionStartSchema.parse({
            attemptId: record.attemptId,
            challenge: proof.challenge,
            purpose: "delete-account",
          }),
        ))
          callback.searchParams.set(key, value);
        const errorCallback = new URL(callback);
        errorCallback.searchParams.set("error", "oauth");
        const authorization = await dependencies.authorize(
          { provider, callbackURL: callback.href, errorCallbackURL: errorCallback.href },
          guard.ensureCurrent,
        );
        guard.ensureCurrent();
        const proxy = new URL("/api/auth/expo-authorization-proxy", dependencies.config.apiBaseUrl);
        proxy.searchParams.set("authorizationURL", authorization.url);
        if (authorization.oauthState)
          proxy.searchParams.set("oauthState", authorization.oauthState);
        const returned = await dependencies.openBrowser(
          proxy.href,
          nativeCallbackBase(dependencies.config),
        );
        if (returned.type === "cancelled") return await cancel(record.attemptId);
        const result = await complete(returned.url);
        return result.type === "ignored" ? unknown(record.attemptId) : result;
      } catch (error) {
        if (pending) return unknown(pending.attemptId);
        if (error instanceof ApiError) throw error;
        throw unavailable();
      } finally {
        starting = false;
      }
    },
  };
}
export type NativeDeletion = ReturnType<typeof createNativeDeletion>;
