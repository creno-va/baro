import { ApiError, type UploadReader, validateUpload } from "@baro/api-client";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import { createNativeUploadReader, type NativeUploadSource } from "./upload-reader";

/** Opaque object identity resolves to a private file; no URI/path is exposed to a model or UI. */
export type { NativeUploadSource } from "./upload-reader";

const unavailable = () =>
  new ApiError(
    "UNAVAILABLE",
    "파일을 준비하지 못했어요. 저장 공간과 접근 권한을 확인하고 다시 선택해 주세요.",
    true,
  );
export function createExpoUploadSources(dependencies: {
  namespace: string;
  newId: () => string;
  pick?: typeof DocumentPicker.getDocumentAsync;
}) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(dependencies.namespace)) throw unavailable();
  const root = new Directory(Paths.cache, dependencies.namespace);
  type Activity = { cancel(): void; done: Promise<void> };
  type Entry = { file: File; readers: Set<UploadReader>; activities: Set<Activity> };
  const owned = new Map<NativeUploadSource, Entry>(),
    removed = new Map<NativeUploadSource, Entry>(),
    retiring = new Map<NativeUploadSource, Promise<void>>();
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
  const remove = (source: NativeUploadSource): Promise<void> => {
    const pending = retiring.get(source);
    if (pending) return pending;
    const entry = owned.get(source) ?? removed.get(source);
    if (!entry) return Promise.resolve();
    owned.delete(source);
    removed.set(source, entry);
    const task = Promise.resolve()
      .then(async () => {
        for (const activity of entry.activities) activity.cancel();
        await Promise.all([...entry.activities].map((activity) => activity.done));
        const readers = await Promise.allSettled(
          [...entry.readers].map((reader) => reader.close()),
        );
        if (readers.some((result) => result.status === "rejected")) throw unavailable();
        removed.delete(source);
        pendingCleanup.add(entry.file);
        cleanup();
      })
      .finally(() => {
        retiring.delete(source);
      });
    retiring.set(source, task);
    return task;
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
        const result = await (dependencies.pick ?? DocumentPicker.getDocumentAsync)({
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
        owned.set(source, { file: target, readers: new Set(), activities: new Set() });
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
    async withNativeSource<T>(
      source: NativeUploadSource,
      signal: AbortSignal,
      consume: (context: { sourceName: string; signal: AbortSignal }) => Promise<T>,
    ): Promise<T> {
      const entry = owned.get(source),
        captured = version;
      const controller = new AbortController(),
        combined = AbortSignal.any([signal, controller.signal]);
      const ensure = () => {
        combined.throwIfAborted();
        if (
          !entry ||
          captured !== version ||
          owned.get(source) !== entry ||
          !entry.file.exists ||
          entry.file.size !== source.size
        )
          throw unavailable();
      };
      let complete!: () => void;
      const activity = {
        cancel: () => controller.abort(),
        done: new Promise<void>((resolve) => {
          complete = resolve;
        }),
      };
      try {
        ensure();
        if (!entry) throw unavailable();
        // Only a generated filename leaves the adapter. Never expose the SDK URI or an arbitrary source path.
        const sourceName = entry.file.name;
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(sourceName))
          throw unavailable();
        entry.activities.add(activity);
        const value = await consume({ sourceName, signal: combined });
        ensure();
        return value;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw unavailable();
      } finally {
        entry?.activities.delete(activity);
        complete();
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
        const results = await Promise.allSettled(
          [...new Set([...owned.keys(), ...removed.keys(), ...retiring.keys()])].map(remove),
        );
        if (results.some((result) => result.status === "rejected")) throw unavailable();
        cleanup();
      } catch {
        throw unavailable();
      }
    },
  };
}
