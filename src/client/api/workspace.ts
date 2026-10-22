import {
  createWorkspaceClient,
  createWorkspaceOperations,
  type WorkspaceTransport,
} from "@baro/api-client";
import { createSessionBoundClient } from "@baro/client-core";
import { browserSessionScope } from "./context";
import { createFilesApi } from "./files";

export type { CustomerWorkspaceView, WorkspaceTransport } from "@baro/api-client";
export { workspaceError, workspaceResponse, workspaceViewSchema } from "@baro/api-client";
// Explicit legacy helpers; workspace/files domain instances use their own registry.
export const { workspaceJson, workspaceMutation } = createWorkspaceOperations(() =>
  crypto.randomUUID(),
);

export function createWorkspaceApi(
  request: WorkspaceTransport,
  jobStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
) {
  let storage = jobStorage;
  if (storage === undefined) {
    try {
      storage = typeof sessionStorage === "undefined" ? null : sessionStorage;
    } catch {
      storage = null;
    }
  }
  return createSessionBoundClient(browserSessionScope, () => {
    const signal = browserSessionScope.signal();
    const files = createFilesApi((path, init = {}) =>
      request(path, {
        ...init,
        signal: init.signal ? AbortSignal.any([init.signal, signal]) : signal,
      }),
    );
    return createWorkspaceClient({
      request,
      scope: browserSessionScope,
      newKey: () => crypto.randomUUID(),
      jobStorage: storage,
      listFiles: (id, options) => files.list(id, options),
    });
  });
}
