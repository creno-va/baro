import { randomUUID } from "expo-crypto";
import { createExpoUploadSources } from "../platform/files/documents";
import { readMobileConfig } from "./config";

let sources: ReturnType<typeof createExpoUploadSources> | undefined;
export function getNativeUploadSources() {
  if (!sources) {
    const config = readMobileConfig();
    sources = createExpoUploadSources({
      namespace: `baro_${config.environment}_private_uploads`,
      newId: randomUUID,
    });
  }
  return sources;
}
