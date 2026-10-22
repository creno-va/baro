import { createPrecedentsClient } from "@baro/api-client";
import { createSessionBoundClient } from "@baro/client-core";
import { browserSessionScope } from "./context";
import { request } from "./core";

let mockReady: Promise<unknown> | undefined;
export const precedentsApi = createSessionBoundClient(browserSessionScope, () =>
  createPrecedentsClient({
    scope: browserSessionScope,
    request: async <T>(operation: string, input?: unknown, options = {}) => {
      if (import.meta.env.PUBLIC_API_MODE === "mock") {
        mockReady ??= import("./mock/precedents").catch((error) => {
          mockReady = undefined;
          throw error;
        });
        await mockReady;
      }
      (options as import("@baro/api-client").OperationRequestOptions).signal?.throwIfAborted();
      return request<T>(operation, input, options);
    },
  }),
);
