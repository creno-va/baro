import { ApiError } from "@baro/api-client";
import { requireOptionalNativeModule } from "expo";
import type { NativeDiskPort } from "./native-jobs";

/** Optional on boot: public/auth flows stay available. Binary IO requires a rebuilt development app. */
export function readNativeDiskPort(): NativeDiskPort | null {
  return requireOptionalNativeModule<NativeDiskPort>("BaroPrivateDownload");
}
export function requireNativeDiskPort(): NativeDiskPort {
  const port = readNativeDiskPort();
  if (!port)
    throw new ApiError("UNAVAILABLE", "파일 저장 기능을 사용하려면 최신 개발 앱을 설치해 주세요.");
  return port;
}
