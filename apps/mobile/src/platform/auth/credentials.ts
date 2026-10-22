import { ApiError } from "@baro/api-client";
import type { SessionScope } from "@baro/client-core";

/** Structurally compatible with the pinned Expo SDK's public storage port. */
export interface CredentialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}
export interface ManagedCredentialStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}
export interface CookieCodec {
  header(value: string | null): string;
  merge(header: string, previous?: string): string;
}

const unavailable = () =>
  new ApiError(
    "UNAVAILABLE",
    "기기의 로그인 저장소를 확인하지 못했어요. 다시 시도해 주세요.",
    true,
  );
const retired = () =>
  new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요. 다시 확인해 주세요.");

/** No credentials or SDK errors leave this adapter. Unresolved operation stores are separate. */
export function createNativeCredentials(dependencies: {
  scope: SessionScope;
  namespace: string;
  storage: Pick<CredentialStorage, "getItemAsync" | "setItemAsync">;
  manageStorage: (storage: CredentialStorage) => ManagedCredentialStorage;
  codec: CookieCodec;
}) {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(dependencies.namespace))
    throw new Error("MOBILE_CREDENTIAL_NAMESPACE_INVALID");
  const cookieKey = `${dependencies.namespace}_cookie`;
  const cacheKey = `${dependencies.namespace}_session_data`;
  let lowLevel: Promise<unknown> = Promise.resolve();
  let cookieOperations: Promise<unknown> = Promise.resolve();
  let ready: Promise<void> = Promise.resolve();
  let faulted = false;
  let faults = 0;
  let current: ReturnType<typeof view> | undefined;

  function ensure(generation: number, recovery = false) {
    if (!dependencies.scope.isCurrent(generation)) throw retired();
    if (faulted && !recovery) throw unavailable();
  }
  function view(generation: number, recovery = false) {
    const io = <T>(operation: () => Promise<T>): Promise<T> => {
      const task = lowLevel.then(async () => {
        ensure(generation, recovery);
        let value: T;
        try {
          value = await operation();
        } catch {
          if (dependencies.scope.isCurrent(generation)) {
            faulted = true;
            faults++;
          }
          ensure(generation, true);
          throw unavailable();
        }
        ensure(generation, recovery);
        return value;
      });
      lowLevel = task.catch(() => {});
      return task;
    };
    const storage: CredentialStorage = {
      // Authentication uses the async SDK paths exclusively. Do not block the UI or
      // let a synchronous access overtake a queued credential replacement.
      getItem: () => {
        throw unavailable();
      },
      setItem: () => {
        throw unavailable();
      },
      getItemAsync: (key) => io(() => dependencies.storage.getItemAsync(key)),
      setItemAsync: (key, value) =>
        io(async () => {
          await dependencies.storage.setItemAsync(key, value);
          // Stop at the first missing chunk, before the SDK can write later
          // fragments or a marker that would hide a partial native-store failure.
          if ((await dependencies.storage.getItemAsync(key)) !== value) throw unavailable();
        }),
    };
    const managed = dependencies.manageStorage(storage);
    const serial = <T>(operation: () => Promise<T>) => {
      const barrier = ready;
      const task = cookieOperations.then(async () => {
        await barrier;
        ensure(generation, recovery);
        return operation();
      });
      cookieOperations = task.catch(() => {});
      return task;
    };
    const verifyWrite = async (key: string, value: string) => {
      const before = faults;
      await managed.setItemAsync(key, value);
      const actual = await managed.getItemAsync(key);
      ensure(generation, recovery);
      // Expo's managed writer can swallow an underlying storage error. Readback
      // and the fault counter are both required before accepting persistence.
      if (before !== faults || actual !== value) {
        faulted = true;
        throw unavailable();
      }
    };
    return {
      generation,
      storage,
      cookie: () =>
        serial(async () => {
          const value = await managed.getItemAsync(cookieKey);
          ensure(generation, recovery);
          try {
            return dependencies.codec.header(value);
          } catch {
            faulted = true;
            throw unavailable();
          }
        }),
      accept: (header: string | null) =>
        serial(async () => {
          if (!header) return;
          const previous = await managed.getItemAsync(cookieKey);
          ensure(generation, recovery);
          let value: string;
          try {
            value = dependencies.codec.merge(header, previous ?? undefined);
          } catch {
            faulted = true;
            throw unavailable();
          }
          await verifyWrite(cookieKey, value);
        }),
      clear: async () => {
        await verifyWrite(cookieKey, "{}");
        await verifyWrite(cacheKey, "{}");
      },
    };
  }
  return {
    namespace: dependencies.namespace,
    capture() {
      const generation = dependencies.scope.snapshot();
      if (!current || current.generation !== generation) current = view(generation);
      const { generation: captured, storage, cookie, accept } = current;
      return { generation: captured, storage, cookie, accept };
    },
    ready: () => ready,
    /** Invalidate synchronously before awaiting old IO or clearing the next jar. */
    reset() {
      dependencies.scope.invalidate();
      const generation = dependencies.scope.snapshot();
      const previous = ready;
      faulted = true;
      current = undefined;
      const task = cookieOperations.then(async () => {
        await previous.catch(() => {});
        ensure(generation, true);
        await view(generation, true).clear();
        ensure(generation, true);
        faulted = false;
      });
      cookieOperations = task.catch(() => {});
      ready = task;
      // Keep a failed reset observable without an unhandled rejection when the
      // app is closing. Requests still await the original rejected barrier.
      void task.catch(() => {});
      return task;
    },
  };
}
export type NativeCredentials = ReturnType<typeof createNativeCredentials>;
export type NativeCredentialFrame = ReturnType<NativeCredentials["capture"]>;
