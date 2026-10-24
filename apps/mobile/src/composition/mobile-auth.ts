import {
  createJsonRequester,
  createMobileAuthClient,
  type MobileAuthClient,
} from "@baro/api-client";
import { randomUUID } from "expo-crypto";
import { createNativeDeletionTransport } from "../platform/auth/deletion-transport";
import { getMobileApi } from "./api";
import { readMobileConfig } from "./config";

let client: MobileAuthClient | undefined;
export function getMobileAuthClient() {
  client ??= createMobileAuthClient({
    request: getMobileApi().request,
    completionRequest: createJsonRequester({
      newKey: randomUUID,
      transport: createNativeDeletionTransport({
        config: readMobileConfig(),
        fetch: (url, init) => fetch(url, init),
      }),
    }),
  });
  return client;
}
