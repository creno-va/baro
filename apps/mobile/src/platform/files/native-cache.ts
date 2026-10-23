import { ApiError } from "@baro/api-client";
import { Directory, File, Paths } from "expo-file-system";

const root = () => new Directory(Paths.cache, "baro_native_transfers");
const validId = (value: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const failed = () =>
  new ApiError(
    "UNAVAILABLE",
    "기기의 임시 다운로드를 정리하지 못했어요. 접근 권한을 확인해 주세요.",
    true,
  );
export function nativeTransferFile(id: string) {
  if (!validId(id)) throw failed();
  return new File(root(), `${id}.bin`);
}
/** Only when no native module/registry exists in this process. Never unlink active native IO. */
export function clearNativeTransferOrphans() {
  const folder = root();
  if (!folder.exists) return;
  for (const entry of folder.list()) {
    const suffix = entry.name.endsWith(".bin")
      ? ".bin"
      : entry.name.endsWith(".upload")
        ? ".upload"
        : "";
    if (!(entry instanceof File) || !suffix || !validId(entry.name.slice(0, -suffix.length)))
      throw failed();
    entry.delete();
    if (entry.exists) throw failed();
  }
}
