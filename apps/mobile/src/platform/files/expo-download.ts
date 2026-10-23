import { ApiError } from "@baro/api-client";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { createPrivateDownloads, type DownloadDiskFile } from "./download";
import { nativeTransferFile } from "./native-cache";

export function createExpoDownloads(namespace: string, newId: () => string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(namespace)) throw new Error("PRIVATE_CACHE_NAMESPACE_INVALID");
  const root = new Directory(Paths.cache, namespace);
  const orphans = new Set<File>();
  const reserved = new Set<string>();
  const target = (mimeType: string, disposition: string) => {
    const id = newId();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))
      throw new Error("PRIVATE_FILE_ID_INVALID");
    let suffix = (
      { "application/pdf": "pdf", "application/zip": "zip", "text/html": "html" } as Record<
        string,
        string
      >
    )[mimeType];
    if (!suffix) {
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      try {
        const name = decodeURIComponent(match?.[1] ?? "");
        suffix = name.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toLowerCase();
      } catch {
        /* Untrusted filename never becomes a path. */
      }
    }
    if (
      !suffix ||
      !/^(txt|pdf|doc|docx|hwp|hwpx|xls|xlsx|ppt|pptx|jpg|jpeg|png|webp|gif|bmp|tif|tiff|heic|mp3|wav|m4a|ogg|flac|aac|mp4|mov|webm|avi|mkv|zip|html)$/.test(
        suffix,
      )
    )
      suffix = "bin";
    const file = new File(root, `${id}.${suffix}`);
    if (file.exists || reserved.has(file.uri)) throw new Error("PRIVATE_FILE_COLLISION");
    reserved.add(file.uri);
    return file;
  };
  const wrap = (file: File, handle?: ReturnType<File["open"]>): DownloadDiskFile => {
    let closed = !handle;
    return {
      size: () => (file.exists ? file.size : -1),
      async write(bytes) {
        if (!handle) throw new Error("PRIVATE_FILE_NOT_WRITABLE");
        await handle.writeBytes(bytes);
      },
      finish() {
        if (!closed) {
          handle?.close();
          closed = true;
        }
      },
      fingerprint: () => file.digest("SHA-256"),
      open: () => file.open(FileMode.ReadOnly),
      text: () => file.text(),
      remove() {
        if (file.exists) file.delete();
        if (file.exists) throw new Error("PRIVATE_FILE_DELETE_FAILED");
      },
      async present(mode, input, ensureCurrent) {
        if (mode === "share") {
          if (!(await Sharing.isAvailableAsync()))
            throw new ApiError("UNAVAILABLE", "이 기기에서 파일 공유를 열 수 없어요.");
          ensureCurrent();
          await Sharing.shareAsync(file.uri, {
            mimeType: input.mimeType,
            dialogTitle: input.name,
          });
        } else {
          if (!(await file.canPreview({ mimeType: input.mimeType })))
            throw new ApiError(
              "UNAVAILABLE",
              "이 형식을 열 수 있는 앱이 없어요. 파일 공유로 저장할 앱을 선택해 주세요.",
            );
          ensureCurrent();
          await file.preview({ mimeType: input.mimeType, title: input.name });
        }
      },
    };
  };
  return createPrivateDownloads({
    cleanup() {
      for (const file of orphans) {
        if (file.exists) file.delete();
        if (file.exists) throw new Error("PRIVATE_FILE_DELETE_FAILED");
        orphans.delete(file);
      }
    },
    initialize() {
      if (root.exists) root.delete();
      if (root.exists) throw new Error("PRIVATE_CACHE_DELETE_FAILED");
      root.create({ intermediates: true });
      if (!root.exists) throw new Error("PRIVATE_CACHE_CREATE_FAILED");
    },
    create(mimeType, disposition) {
      const file = target(mimeType, disposition);
      let handle: ReturnType<File["open"]>;
      try {
        file.create();
        handle = file.open(FileMode.WriteOnly);
      } catch (error) {
        orphans.add(file);
        try {
          if (file.exists) file.delete();
          if (!file.exists) orphans.delete(file);
        } catch {}
        throw error;
      } finally {
        reserved.delete(file.uri);
      }
      return wrap(file, handle);
    },
    async adopt(id, mimeType, disposition) {
      const file = target(mimeType, disposition);
      try {
        const source = nativeTransferFile(id);
        if (!source.exists) throw new Error("PRIVATE_NATIVE_FILE_MISSING");
        await source.move(file, { overwrite: false });
        if (!file.exists || nativeTransferFile(id).exists)
          throw new Error("PRIVATE_NATIVE_MOVE_FAILED");
        return wrap(file);
      } catch (error) {
        orphans.add(file);
        try {
          if (file.exists) file.delete();
          if (!file.exists) orphans.delete(file);
        } catch {}
        throw error;
      } finally {
        reserved.delete(file.uri);
      }
    },
  });
}
