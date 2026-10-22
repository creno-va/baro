import { createMobilePrecedents } from "../platform/precedents";
import { getMobileApi } from "./api";
import { getMobileCredentials } from "./credentials";

/** Existing signed JSON transport. Public topic IDs and opaque proof stay in the POST body. */
export function createNativePrecedents(signal: AbortSignal, ownerId: string) {
  return createMobilePrecedents({
    scope: getMobileCredentials().scope,
    request: getMobileApi().request,
    signal,
    ownerId,
  });
}
