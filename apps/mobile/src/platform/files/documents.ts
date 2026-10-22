import { ApiError, type UploadMetadata, type UploadReader, validateUpload } from "@baro/api-client";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import { createNativeUploadReader } from "./upload-reader";

/** Opaque object identity resolves to a private file; no URI/path is exposed to a model or UI. */
export type NativeUploadSource = Readonly<UploadMetadata>;
const unavailable = () =>
  new ApiError(
    "UNAVAILABLE",
    "파일을 준비하지 못했어요. 저장 공간과 접근 권한을 확인하고 다시 선택해 주세요.",
    true,
  );
export function createExpoUploadSources(dependencies: { namespace: string; newId: () => string }) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(dependencies.namespace)) throw unavailable();
  const root = new Directory(Paths.cache, dependencies.namespace);
  const owned = new Map<NativeUploadSource, { file: File; readers: Set<UploadReader> }>();
  const pendingCleanup = new Set<File>();
  let initialized = false,
    version = 0,
    selecting = false;
  const cleanup = () => {
    for (const file of pendingCleanup) {
      if (file.exists) file.delete();
      if (file.exists) throw unavailable();
      pendingCleanup.delete(file);
    }
  };
  const initialize = () => {
    if (initialized) return;
    if (root.exists) root.delete();
    if (root.exists) throw unavailable();
    root.create({ intermediates: true });
    if (!root.exists) throw unavailable();
    initialized = true;
  };
  const remove = async (source: NativeUploadSource) => {
    const entry = owned.get(source);
    if (!entry) return;
    owned.delete(source);
    await Promise.all([...entry.readers].map((reader) => reader.close()));
    pendingCleanup.add(entry.file);
    cleanup();
  };
  return {
    async select(signal: AbortSignal): Promise<NativeUploadSource | null> {
      if (selecting) throw unavailable();
      selecting = true;
      const captured = version;
      let temporary: File | undefined, target: File | undefined;
      const ensure = () => {
        signal.throwIfAborted();
        if (captured !== version) throw unavailable();
      };
      try {
        ensure();
        initialize();
        cleanup();
        // The picker copies external/provider bytes to app cache. Move that owned
        // snapshot rather than reading a provider URI after its permission expires.
        const result = await DocumentPicker.getDocumentAsync({
          copyToCacheDirectory: true,
          multiple: false,
          type: "*/*",
          base64: false,
        });
        if (result.canceled) {
          ensure();
          return null;
        }
        const asset = result.assets[0];
        if (result.assets.length !== 1 || !asset) throw unavailable();
        const uri = new URL(asset.uri),
          cache = new URL(Paths.cache.uri),
          path = decodeURIComponent(uri.pathname);
        if (
          uri.protocol !== "file:" ||
          uri.host !== cache.host ||
          uri.search ||
          uri.hash ||
          path.includes("\\") ||
          path.includes("\0") ||
          path.split("/").some((part) => part === "." || part === "..") ||
          !path.startsWith(
            decodeURIComponent(
              cache.pathname.endsWith("/") ? cache.pathname : `${cache.pathname}/`,
            ),
          )
        )
          throw unavailable();
        temporary = new File(asset.uri);
        ensure();
        const source: NativeUploadSource = Object.freeze({
          name: asset.name,
          type: asset.mimeType ?? "application/octet-stream",
          size: temporary.size,
        });
        validateUpload(source);
        if (asset.size !== undefined && asset.size !== source.size) throw unavailable();
        const id = dependencies.newId();
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))
          throw unavailable();
        const candidate = new File(root, id);
        if (candidate.exists) throw unavailable();
        target = candidate;
        await temporary.move(target);
        temporary = undefined;
        ensure();
        if (!target.exists || target.size !== source.size) throw unavailable();
        owned.set(source, { file: target, readers: new Set() });
        target = undefined;
        return source;
      } catch (error) {
        for (const file of [temporary, target]) if (file) pendingCleanup.add(file);
        try {
          cleanup();
        } catch {
          /* Retain failed private cleanup for the next explicit call. */
        }
        if (error instanceof ApiError) throw error;
        throw unavailable();
      } finally {
        selecting = false;
      }
    },
    async openUpload(source: NativeUploadSource, signal: AbortSignal): Promise<UploadReader> {
      signal.throwIfAborted();
      const entry = owned.get(source);
      if (!entry) throw unavailable();
      const raw = createNativeUploadReader(
        {
          size: source.size,
          open: () => {
            if (owned.get(source) !== entry) throw unavailable();
            return entry.file.open(FileMode.ReadOnly);
          },
        },
        signal,
      );
      const reader: UploadReader = {
        ...raw,
        async close() {
          await raw.close();
          entry.readers.delete(reader);
        },
      };
      entry.readers.add(reader);
      return reader;
    },
    async release(source: NativeUploadSource) {
      try {
        await remove(source);
        cleanup();
      } catch {
        throw unavailable();
      }
    },
    async clear() {
      version++;
      try {
        initialize();
        await Promise.all([...owned.keys()].map(remove));
        cleanup();
      } catch {
        throw unavailable();
      }
    },
  };
}
