import type { SessionScope } from "@baro/client-core";
import { accountDeletionResponseSchema } from "@baro/contracts/deletion";
import { ApiError } from "./errors";
import type { DomainRequest } from "./reports";
import { createWorkspaceRecovery, type WorkspaceRecovery } from "./workspace-recovery";

/** Case removal has no account-reauthentication dependency. The server owns authorization/cleanup. */
export function createCaseDeletionClient(dependencies: {
  request: DomainRequest;
  scope: SessionScope;
  signal?: AbortSignal;
  newKey: () => string;
  coalesceWrites?: "credential-scope";
  recovery?: WorkspaceRecovery;
  onDeleted?: (caseId: string) => Promise<void> | void;
}) {
  const generation = dependencies.scope.snapshot();
  const signal = dependencies.signal
    ? AbortSignal.any([dependencies.signal, dependencies.scope.signal()])
    : dependencies.scope.signal();
  const ensureCurrent = () => {
    if (!dependencies.scope.isCurrent(generation))
      throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요. 다시 확인해 주세요.");
    signal.throwIfAborted();
  };
  const recovery = dependencies.recovery
    ? createWorkspaceRecovery({
        recovery: dependencies.recovery,
        scope: dependencies.scope,
        ensureCurrent,
        newKey: dependencies.newKey,
      })
    : undefined;
  const keys = new Map<string, string>(),
    pending = new Map<string, Promise<void>>();
  return {
    async deleteCase(id: string, confirmation: string, schemaVersion: "1" | "2" = "2") {
      ensureCurrent();
      if (confirmation !== "DELETE") throw new Error("삭제 확인란에 DELETE를 입력해 주세요.");
      const identity = `${schemaVersion}:${id}`;
      const previous =
        dependencies.coalesceWrites === "credential-scope" ? pending.get(identity) : undefined;
      if (previous) return previous;
      const task = (async () => {
        const path = `/api/${schemaVersion === "1" ? "cases" : "v2/cases"}/${encodeURIComponent(id)}`;
        // DELETE must have an empty wire body (including v1). Its durable identity includes that absence.
        const prepared = recovery ? await recovery.prepare(path, undefined, "DELETE") : undefined;
        ensureCurrent();
        const key = prepared ? "" : (keys.get(identity) ?? dependencies.newKey());
        if (!prepared) keys.set(identity, key);
        let result: unknown;
        try {
          result = await dependencies.request(path, {
            method: "DELETE",
            signal,
            headers: prepared
              ? Object.fromEntries(new Headers(prepared.headers))
              : { "idempotency-key": key },
          });
          ensureCurrent();
        } catch (cause) {
          ensureCurrent();
          throw cause;
        }
        if (result !== undefined) accountDeletionResponseSchema.parse(result);
        else if (recovery && schemaVersion === "2")
          throw new ApiError("UNAVAILABLE", "삭제 요청 결과를 다시 확인해 주세요.", true);
        keys.delete(identity);
        if (prepared) await recovery?.complete(prepared);
        ensureCurrent();
        // The accepted deletion must stay accepted even if local navigation/refresh fails.
        try {
          await dependencies.onDeleted?.(id);
        } catch {
          /* A committed deletion remains committed. */
        }
      })();
      if (dependencies.coalesceWrites === "credential-scope") pending.set(identity, task);
      try {
        await task;
      } finally {
        if (pending.get(identity) === task) pending.delete(identity);
      }
    },
  };
}
