import { randomUUID } from "expo-crypto";
import { createNativeTransport } from "../platform/auth/transport";
import { createMobileApi } from "../platform/http";
import { readMobileConfig } from "./config";
import { getMobileCredentials } from "./credentials";

let client: ReturnType<typeof createMobileApi> | undefined;
export function getMobileApi() {
  const { scope, credentials } = getMobileCredentials();
  const config = readMobileConfig();
  client ??= createMobileApi({
    config,
    scope,
    transport: createNativeTransport({
      config,
      credentials,
      fetch: (input, init) => fetch(input, init),
    }),
    fetch: (input, init) => fetch(input, init),
    newKey: randomUUID,
  });
  return client;
}
