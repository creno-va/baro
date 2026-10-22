import {
  ApiError,
  createFileMetadataReader,
  createWorkspaceClient,
  type WorkspaceAcknowledgement,
  type WorkspaceTransport,
} from "@baro/api-client";
import { EXPECTED_OWNER_HEADER } from "@baro/contracts/session";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import { createNativeTransport } from "../platform/auth/transport";
import { getCaseOperationStorage } from "./cases";
import { readMobileConfig } from "./config";
import { getMobileCredentials } from "./credentials";

export function createNativeWorkspace(
  signal: AbortSignal,
  ownerId: string,
  onAcknowledged: (receipt: WorkspaceAcknowledgement) => void,
) {
  const { scope, credentials } = getMobileCredentials();
  const generation = scope.snapshot();
  const combined = AbortSignal.any([signal, scope.signal()]);
  const transport = createNativeTransport({
    config: readMobileConfig(),
    credentials,
    frame: credentials.capture(),
    fetch: (input, init) => fetch(input, init),
  });
  const request: WorkspaceTransport = async (path, init = {}) => {
    const check = () => {
      combined.throwIfAborted();
      if (!scope.isCurrent(generation))
        throw new ApiError("UNAUTHENTICATED", "계정을 다시 확인해 주세요.");
    };
    check();
    const headers = new Headers(init.headers);
    headers.set(EXPECTED_OWNER_HEADER, encodeURIComponent(ownerId));
    const response = await transport(path, {
      ...init,
      headers,
      signal: init.signal ? AbortSignal.any([init.signal, combined]) : combined,
    });
    check();
    return response;
  };
  const metadata = createFileMetadataReader(request);
  const storage = getCaseOperationStorage();
  return createWorkspaceClient({
    scope,
    signal: combined,
    request,
    newKey: randomUUID,
    coalesceWrites: "credential-scope",
    includeActionRevisions: true,
    includeSummaryConfirmation: true,
    jobStorage: storage,
    recovery: {
      ownerId,
      storage,
      fingerprint: (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
    },
    listFiles: (id) => metadata(id),
    onAcknowledged,
  });
}
