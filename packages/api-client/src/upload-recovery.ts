import type { FileView } from "@baro/client-core";
import { opaqueIdSchema, revisionSchema } from "@baro/contracts/common";
import { z } from "zod";
import { ApiError } from "./errors";
import type { WorkspaceRecovery } from "./workspace-recovery";

/** Only opaque operation metadata; never an upload token, filename, URI, manifest or case contents. */
export const uploadRecoveryRecordSchema = z
  .strictObject({
    version: z.literal(1),
    reservationKey: z.uuid(),
    expectedRevision: revisionSchema,
    fileId: opaqueIdSchema.optional(),
    complete: z
      .strictObject({
        key: z.uuid(),
        expectedRevision: revisionSchema,
        requestHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .optional(),
    conflict: z.enum(["reservation", "complete", "missing"]).optional(),
  })
  .refine(
    (value) =>
      (!value.complete || Boolean(value.fileId)) &&
      (value.conflict !== "missing" || Boolean(value.fileId)) &&
      (value.conflict !== "complete" || Boolean(value.complete)),
  );
export type UploadRecoveryRecord = z.infer<typeof uploadRecoveryRecordSchema>;
export type UploadRecovery = WorkspaceRecovery;
const pending = new WeakMap<UploadRecovery["storage"], Map<string, Promise<FileView>>>();
const failed = () =>
  new ApiError(
    "UNAVAILABLE",
    "업로드 복구 정보를 기기에 보관하지 못했어요. 같은 파일을 유지한 채 다시 시도해 주세요.",
    true,
  );
export function createUploadRecovery(options: { recovery: UploadRecovery; ensureCurrent(): void }) {
  const { recovery, ensureCurrent } = options;
  if (!recovery.ownerId || recovery.ownerId.length > 128) throw failed();
  let active = pending.get(recovery.storage);
  if (!active) {
    active = new Map();
    pending.set(recovery.storage, active);
  }
  const operations = active;
  const io = async <T>(action: () => Promise<T>) => {
    ensureCurrent();
    try {
      const result = await action();
      ensureCurrent();
      return result;
    } catch {
      ensureCurrent();
      throw failed();
    }
  };
  const fingerprint = (value: string) =>
    io(async () => {
      const hash = await recovery.fingerprint(value);
      if (!/^[a-f0-9]{64}$/.test(hash)) throw failed();
      return hash;
    });
  return {
    fingerprint,
    async identity(path: string, input: unknown) {
      return `baro-upload-operation:${await fingerprint(JSON.stringify([recovery.ownerId, path, input]))}`;
    },
    async run(identity: string, task: () => Promise<FileView>) {
      ensureCurrent();
      const current = operations.get(identity);
      const result =
        current ??
        Promise.resolve().then(() => {
          ensureCurrent();
          return task();
        });
      if (!current) operations.set(identity, result);
      try {
        const value = await result;
        ensureCurrent();
        return value;
      } finally {
        if (operations.get(identity) === result) operations.delete(identity);
      }
    },
    load: (identity: string) =>
      io(async () => {
        const raw = await recovery.storage.getItem(identity);
        return raw === null ? null : uploadRecoveryRecordSchema.parse(JSON.parse(raw));
      }),
    save: (identity: string, record: UploadRecoveryRecord) =>
      io(async () => {
        const value = JSON.stringify(uploadRecoveryRecordSchema.parse(record));
        await recovery.storage.setItem(identity, value);
        if ((await recovery.storage.getItem(identity)) !== value) throw failed();
      }),
    async complete(identity: string) {
      try {
        await io(async () => {
          await recovery.storage.removeItem(identity);
          if ((await recovery.storage.getItem(identity)) !== null) throw failed();
        });
      } catch {
        ensureCurrent(); /* Accepted readback remains accepted; retain failed cleanup for replay. */
      }
    },
  };
}
