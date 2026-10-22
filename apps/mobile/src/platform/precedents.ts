import { ApiError, createPrecedentsClient, type JsonRequest } from "@baro/api-client";
import type { SessionScope } from "@baro/client-core";

export function createMobilePrecedents(dependencies: {
  request: JsonRequest;
  scope: SessionScope;
  signal: AbortSignal;
  ownerId: string;
}) {
  return createPrecedentsClient({
    scope: dependencies.scope,
    request: (_operation, _input, options = {}) => {
      if (!options.path) throw new ApiError("VALIDATION_ERROR", "요청 경로를 확인해 주세요.");
      return dependencies.request({
        ...options,
        path: options.path,
        expectedOwner: dependencies.ownerId,
        signal: options.signal
          ? AbortSignal.any([options.signal, dependencies.signal])
          : dependencies.signal,
      });
    },
  });
}
