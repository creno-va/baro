import type { SessionScope } from "@baro/client-core";
import { EXPECTED_OWNER_HEADER } from "@baro/contracts/session";
import { z } from "zod";
import type { CaseOperationStorage } from "./cases";
import { ApiError } from "./errors";

export interface WorkspaceRecovery {
  ownerId: string;
  storage: CaseOperationStorage;
  fingerprint(value: string): Promise<string>;
}
const locks = new WeakMap<SessionScope, Map<string, Promise<unknown>>>();
const failed = () =>
  new ApiError(
    "UNAVAILABLE",
    "전송 복구 정보를 기기에 보관하지 못했어요. 입력을 유지한 채 다시 시도해 주세요.",
    true,
  );

/** Only hashes/opaque keys reach storage. Recreating a client must replay the original revision/body. */
export function createWorkspaceRecovery(options: {
  recovery: WorkspaceRecovery;
  scope: SessionScope;
  ensureCurrent(): void;
  newKey(): string;
  namespace?: "workspace" | "reports";
}) {
  const { recovery, ensureCurrent } = options;
  if (!recovery.ownerId || recovery.ownerId.length > 128) throw failed();
  let pending = locks.get(options.scope);
  if (!pending) {
    pending = new Map();
    locks.set(options.scope, pending);
  }
  const queue = pending;
  const identities = new Map<string, string>();
  const lock = async <T>(identity: string, task: () => Promise<T>) => {
    const operation = (queue.get(identity) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        ensureCurrent();
        try {
          return await task();
        } catch {
          ensureCurrent();
          throw failed();
        }
      });
    queue.set(identity, operation);
    try {
      const value = await operation;
      ensureCurrent();
      return value;
    } finally {
      if (queue.get(identity) === operation) queue.delete(identity);
    }
  };
  return {
    async prepare(path: string, body: unknown, method = "POST"): Promise<RequestInit> {
      ensureCurrent();
      const encoded = JSON.stringify(body);
      let fingerprint: string;
      try {
        fingerprint = await recovery.fingerprint(
          JSON.stringify([recovery.ownerId, path, method, encoded]),
        );
      } catch {
        ensureCurrent();
        throw failed();
      }
      ensureCurrent();
      if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw failed();
      const identity = `baro-${options.namespace ?? "workspace"}-request:${fingerprint}`;
      const key = await lock(identity, async () => {
        const existing = await recovery.storage.getItem(identity);
        ensureCurrent();
        if (existing !== null) {
          if (!z.uuid().safeParse(existing).success) throw failed();
          return existing;
        }
        const value = options.newKey();
        if (!z.uuid().safeParse(value).success) throw failed();
        await recovery.storage.setItem(identity, value);
        ensureCurrent();
        if ((await recovery.storage.getItem(identity)) !== value) throw failed();
        return value;
      });
      identities.set(key, identity);
      return {
        method,
        body: encoded,
        headers: {
          "content-type": "application/json",
          "idempotency-key": key,
          [EXPECTED_OWNER_HEADER]: encodeURIComponent(recovery.ownerId),
        },
      };
    },
    async complete(init: RequestInit) {
      ensureCurrent();
      const key = new Headers(init.headers).get("idempotency-key");
      const identity = key ? identities.get(key) : undefined;
      if (!key || !identity) return;
      try {
        await lock(identity, async () => {
          const current = await recovery.storage.getItem(identity);
          ensureCurrent();
          if (current === key) {
            await recovery.storage.removeItem(identity);
            ensureCurrent();
            if ((await recovery.storage.getItem(identity)) !== null) throw failed();
          }
        });
        identities.delete(key);
      } catch {
        ensureCurrent();
        // The acknowledgement/readback succeeded. Retain a failed cleanup for idempotent recovery;
        // do not turn a committed operation into a duplicate retry.
      }
    },
  };
}
