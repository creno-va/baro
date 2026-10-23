import {
  ApiError,
  type CaseOperationStorage,
  createAccountClient,
  type DomainRequestInit,
  type JsonRequest,
} from "@baro/api-client";
import type { Provider, SessionScope } from "@baro/client-core";
import { accountDeletionRequestSchema } from "@baro/contracts/deletion";
import { v2UsageSchema } from "@baro/contracts/v2/usage";
import { type NativeAccountDeletionRecord, nativeAccountDeletionRecordSchema } from "./recovery";

export class NativeAccountFault extends ApiError {
  constructor(
    public readonly reason:
      | "REAUTHENTICATION_REQUIRED"
      | "UNCONFIRMED"
      | "OWNER_CHANGED"
      | "ALREADY_ACCEPTED"
      | "NO_PENDING_REQUEST",
  ) {
    super(
      reason === "REAUTHENTICATION_REQUIRED" ? "VALIDATION_ERROR" : "CONFLICT",
      {
        REAUTHENTICATION_REQUIRED: "삭제할 계정으로 다시 인증한 뒤 확인해 주세요.",
        UNCONFIRMED:
          "이전 삭제 요청의 결과가 불확실해요. 자동으로 다시 보내지 않아요. 같은 계정의 현재 상태를 확인한 뒤 명시적으로 다시 확인해 주세요.",
        OWNER_CHANGED: "삭제할 계정이 바뀌었어요. 현재 계정을 다시 확인해 주세요.",
        ALREADY_ACCEPTED:
          "이 기기에서 삭제 접수를 확인한 요청이에요. 새 삭제 요청을 보내지 않아요.",
        NO_PENDING_REQUEST: "다시 확인할 삭제 요청이 없어요.",
      }[reason],
    );
  }
}
const unavailable = () =>
  new ApiError(
    "UNAVAILABLE",
    "계정 요청 복구 정보를 기기에 보관하지 못했어요. 저장 공간과 접근 권한을 확인해 주세요.",
    true,
  );

/** Mandatory native persistence. The existing server does not promise idempotent ACK replay. */
export function createNativeAccountClient(dependencies: {
  request: JsonRequest;
  scope: SessionScope;
  signal: AbortSignal;
  ownerId: string;
  storage: CaseOperationStorage;
  fingerprint(value: string): Promise<string>;
  newKey(): string;
  readReauthentication(): Promise<unknown>;
  reauthenticate(provider: Provider): Promise<void>;
  onAccepted?(receipt: { ownerId: string }): void | Promise<void>;
  /** Every await/handoff in the native consumer must recheck this fence before clearing credentials. */
  cleanup(context: { ownerId: string; ensureCurrent(): void }): Promise<void>;
}) {
  const generation = dependencies.scope.snapshot(),
    signal = AbortSignal.any([dependencies.signal, dependencies.scope.signal()]);
  const ensure = () => {
    if (!dependencies.scope.isCurrent(generation))
      throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요. 다시 확인해 주세요.");
    if (signal.aborted)
      throw new ApiError(
        "UNAVAILABLE",
        "계정 요청을 중단했어요. 미확정 삭제 요청은 보존돼요.",
        true,
      );
  };
  const safe = async <T>(task: () => Promise<T>): Promise<T> => {
    try {
      return await task();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("UNAVAILABLE", "계정 요청을 확인하지 못했어요. 다시 확인해 주세요.", true);
    }
  };
  let storageKey: string | undefined,
    pending: Promise<{ status: "accepted"; cleanupFailed: boolean }> | undefined;
  let prepared: { record: NativeAccountDeletionRecord; storageKey: string } | undefined;
  let cleanupFailed = false;
  const key = async () => {
    ensure();
    if (storageKey) return storageKey;
    if (!dependencies.ownerId || dependencies.ownerId.length > 128) throw unavailable();
    const hash = await dependencies.fingerprint(`baro-account-deletion:v1:${dependencies.ownerId}`);
    ensure();
    if (!/^[a-f0-9]{64}$/.test(hash)) throw unavailable();
    storageKey = `baro-account-deletion:${hash}`;
    return storageKey;
  };
  const load = async (name: string) => {
    const value = await dependencies.storage.getItem(name);
    ensure();
    return value === null ? null : nativeAccountDeletionRecordSchema.parse(JSON.parse(value));
  };
  const store = async (name: string, record: NativeAccountDeletionRecord) => {
    const value = JSON.stringify(nativeAccountDeletionRecordSchema.parse(record));
    await dependencies.storage.setItem(name, value);
    if ((await dependencies.storage.getItem(name)) !== value) throw unavailable();
  };
  const account = createAccountClient({
    scope: dependencies.scope,
    newKey: dependencies.newKey,
    coalesceWrites: "credential-scope",
    readReauthentication: dependencies.readReauthentication,
    reauthenticate: (provider) => {
      ensure();
      return dependencies.reauthenticate(provider);
    },
    request: async <T>(path: string, options: DomainRequestInit = {}) => {
      ensure();
      if (options.method === "DELETE") {
        if (
          path !== "/api/me" ||
          !prepared ||
          !accountDeletionRequestSchema.safeParse(options.body).success ||
          options.headers?.["x-baro-deletion-owner"] !== prepared.record.ownerTag
        )
          throw new NativeAccountFault("OWNER_CHANGED");
        return dependencies.request<T>({
          ...options,
          path,
          expectedOwner: dependencies.ownerId,
          key: prepared.record.key,
          headers: { ...options.headers, "idempotency-key": prepared.record.key },
          signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal,
        });
      }
      const value = await dependencies.request<T>({
        ...options,
        path,
        expectedOwner: dependencies.ownerId,
        signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal,
      });
      if (path === "/api/v2/me/usage") v2UsageSchema.parse(value);
      return value;
    },
    onDeleted: async (kind) => {
      if (kind !== "account" || !prepared) return;
      // createAccountClient calls this only after validated ACK, then intentional scope invalidation.
      const current = prepared,
        cleanupGeneration = dependencies.scope.snapshot();
      const ensureCleanup = () => {
        if (!dependencies.scope.isCurrent(cleanupGeneration))
          throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요.");
      };
      try {
        await dependencies.onAccepted?.({ ownerId: dependencies.ownerId });
      } catch {
        cleanupFailed = true;
      }
      try {
        await store(current.storageKey, { ...current.record, state: "accepted" });
      } catch {
        cleanupFailed = true;
      }
      try {
        ensureCleanup();
        await dependencies.cleanup({ ownerId: dependencies.ownerId, ensureCurrent: ensureCleanup });
        // Cleanup itself may intentionally reset credentials/scope. Only this operation's opaque metadata is removed.
        await dependencies.storage.removeItem(current.storageKey);
        if ((await dependencies.storage.getItem(current.storageKey)) !== null) throw unavailable();
      } catch {
        cleanupFailed = true;
      }
    },
  });
  function execute(confirmation: string, retry: boolean) {
    return safe(async () => {
      ensure();
      if (confirmation !== "DELETE")
        throw new ApiError("VALIDATION_ERROR", "삭제 확인란에 DELETE를 입력해 주세요.");
      if (pending) return pending;
      const task = (async () => {
        const name = await key(),
          prior = await load(name);
        if (prior?.state === "accepted") throw new NativeAccountFault("ALREADY_ACCEPTED");
        if (prior && !retry) throw new NativeAccountFault("UNCONFIRMED");
        if (!prior && retry) throw new NativeAccountFault("NO_PENDING_REQUEST");
        const access = await account.deletionAccess();
        ensure();
        if (prior && prior.ownerTag !== access.ownerTag)
          throw new NativeAccountFault("OWNER_CHANGED");
        if (
          !access.canDelete ||
          !access.authenticatedAt ||
          (prior && Date.parse(access.authenticatedAt) <= Date.parse(prior.authenticatedAt))
        )
          throw new NativeAccountFault("REAUTHENTICATION_REQUIRED");
        const record = nativeAccountDeletionRecordSchema.parse({
          version: 1,
          ownerTag: access.ownerTag,
          key: prior?.key ?? dependencies.newKey(),
          authenticatedAt: access.authenticatedAt,
          state: "attempted",
        });
        await store(name, record);
        ensure();
        prepared = { record, storageKey: name };
        cleanupFailed = false;
        await account.deleteAccount(confirmation);
        // A valid ACK stays accepted even after cleanup or the deliberate scope change.
        return { status: "accepted" as const, cleanupFailed };
      })();
      pending = task;
      try {
        return await task;
      } finally {
        if (pending === task) {
          pending = undefined;
          prepared = undefined;
        }
      }
    });
  }
  return {
    usage: () => safe(() => account.usage()),
    deletionAccess: () =>
      safe(async () => {
        const access = await account.deletionAccess(),
          prior = await load(await key());
        return {
          ...access,
          canDelete:
            access.canDelete &&
            (!prior ||
              (prior.state === "attempted" &&
                prior.ownerTag === access.ownerTag &&
                access.authenticatedAt !== null &&
                Date.parse(access.authenticatedAt) > Date.parse(prior.authenticatedAt))),
        };
      }),
    reauthenticate: (provider: Provider) => safe(() => account.reauthenticate(provider)),
    deletionState: () =>
      safe(async () => {
        const record = await load(await key());
        return record?.state === "accepted"
          ? ("accepted" as const)
          : record
            ? ("unconfirmed" as const)
            : ("none" as const);
      }),
    deleteAccount: (confirmation: string) => execute(confirmation, false),
    retryUnconfirmed: (confirmation: string) => execute(confirmation, true),
  };
}
