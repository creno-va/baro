import { randomUUID } from "expo-crypto";
import { createMobileApi } from "../platform/http";
import { readMobileConfig } from "./config";

let client: ReturnType<typeof createMobileApi> | undefined;
export function getMobileApi() {
  client ??= createMobileApi({
    config: readMobileConfig(),
    fetch: (input, init) => fetch(input, init),
    newKey: randomUUID,
  });
  return client;
}
