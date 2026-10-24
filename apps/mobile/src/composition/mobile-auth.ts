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
    request: (options) => {
      const api = getMobileApi();
      return options.path === "/api/mobile/auth/capabilities"
        ? api.publicRequest(options)
        : api.request(options);
    },
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
