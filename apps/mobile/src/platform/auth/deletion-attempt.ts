import { ApiError } from "@baro/api-client";
import {
  mobileAuthAttemptIdSchema,
  mobileAuthV2ProviderSchema,
  mobileAuthVerifierSchema,
} from "@baro/contracts/mobile-auth";
import { mobileDeletionOutcomeSchema } from "@baro/contracts/mobile-deletion";
import { z } from "zod";

const identity = {
  attemptId: mobileAuthAttemptIdSchema,
  ownerId: z.string().min(1).max(128),
};
const pendingSchema = z.strictObject({
  ...identity,
  state: z.literal("pending"),
  verifier: mobileAuthVerifierSchema,
  ownerTag: mobileDeletionOutcomeSchema.shape.ownerTag,
  provider: mobileAuthV2ProviderSchema,
  createdAt: z.number().int().nonnegative(),
});
const acceptedSchema = z.strictObject({
  ...identity,
  state: z.literal("accepted"),
  outcome: mobileDeletionOutcomeSchema,
  cleanup: z.enum(["pending", "complete", "skipped", "failed"]),
});
const recordSchema = z.discriminatedUnion("state", [
  pendingSchema,
  acceptedSchema,
  z.strictObject({ ...identity, state: z.literal("cancelled") }),
]);
const journalSchema = z.strictObject({
  version: z.literal(2),
  records: z
    .array(recordSchema)
    .max(4)
    .refine((records) => new Set(records.map((r) => r.attemptId)).size === records.length),
});
export type PendingDeletionAttempt = z.infer<typeof pendingSchema>;
export type DeletionAttemptRecord = z.infer<typeof recordSchema>;
const unavailable = () =>
  new ApiError(
    "UNAVAILABLE",
    "삭제 확인 정보를 기기에 보관하지 못했어요. 저장 상태를 다시 확인해 주세요.",
    true,
  );
const conflict = () =>
  new ApiError(
    "CONFLICT",
    "이전 삭제 요청의 결과를 먼저 확인해 주세요. 자동으로 다시 보내지 않아요.",
  );

/** Separate, bounded proof journal. Expiry, logout and new owners never silently remove uncertainty. */
export function createDeletionAttemptStore(dependencies: {
  key: string;
  storage: {
    getItemAsync(key: string): Promise<string | null>;
    setItemAsync(key: string, value: string): Promise<void>;
  };
}) {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(dependencies.key)) throw unavailable();
  let pending: Promise<unknown> = Promise.resolve();
  const serial = <T>(action: () => Promise<T>) => {
    const task = pending.then(action).catch((error: unknown) => {
      if (error instanceof ApiError) throw error;
      throw unavailable();
    });
    pending = task.catch(() => {});
    return task;
  };
  const read = async () => {
    const raw = await dependencies.storage.getItemAsync(dependencies.key);
    return raw === null
      ? { version: 2 as const, records: [] }
      : journalSchema.parse(JSON.parse(raw));
  };
  const write = async (records: DeletionAttemptRecord[]) => {
    const value = JSON.stringify(journalSchema.parse({ version: 2, records }));
    // Each platform's native secure store receives a bounded item, never an unbounded account history.
    if (new TextEncoder().encode(value).length > 1900) throw conflict();
    await dependencies.storage.setItemAsync(dependencies.key, value);
    if ((await dependencies.storage.getItemAsync(dependencies.key)) !== value) throw unavailable();
  };
  async function update<T>(
    id: string,
    change: (record: DeletionAttemptRecord) => { record: DeletionAttemptRecord; result: T },
  ) {
    const journal = await read(),
      index = journal.records.findIndex((r) => r.attemptId === id),
      current = journal.records[index];
    if (!current) throw conflict();
    const next = change(current);
    journal.records[index] = recordSchema.parse(next.record);
    await write(journal.records);
    return next.result;
  }
  return {
    list: () => serial(async () => (await read()).records),
    put: (input: PendingDeletionAttempt) =>
      serial(async () => {
        const record = pendingSchema.parse(input),
          journal = await read();
        if (
          journal.records.length >= 4 ||
          journal.records.some(
            (r) =>
              r.attemptId === record.attemptId ||
              (r.ownerId === record.ownerId && r.state === "pending"),
          )
        )
          throw conflict();
        await write([...journal.records, record]);
      }),
    accept: (attemptId: string, input: unknown) =>
      serial(async () => {
        const outcome = mobileDeletionOutcomeSchema.parse(input);
        return update(attemptId, (current) => {
          if (
            current.state === "cancelled" ||
            (current.state === "pending" && current.ownerTag !== outcome.ownerTag) ||
            (current.state === "accepted" &&
              (current.outcome.ownerTag !== outcome.ownerTag ||
                (current.outcome.appleRevocation === "not_linked") !==
                  (outcome.appleRevocation === "not_linked")))
          )
            throw conflict();
          const record: z.infer<typeof acceptedSchema> =
            current.state === "accepted"
              ? {
                  ...current,
                  outcome:
                    current.outcome.appleRevocation === "confirmed" ? current.outcome : outcome,
                }
              : {
                  state: "accepted",
                  attemptId,
                  ownerId: current.ownerId,
                  outcome,
                  cleanup: "pending",
                };
          return { record, result: record };
        });
      }),
    cancel: (attemptId: string) =>
      serial(() =>
        update(attemptId, (current) => {
          // A locally observed accepted result can never become a cancellation.
          const record: DeletionAttemptRecord =
            current.state === "pending"
              ? { state: "cancelled", attemptId, ownerId: current.ownerId }
              : current;
          return { record, result: record };
        }),
      ),
    markCleanup: (attemptId: string, cleanup: z.infer<typeof acceptedSchema>["cleanup"]) =>
      serial(() =>
        update(attemptId, (current) => {
          if (current.state !== "accepted") throw conflict();
          const record = {
            ...current,
            cleanup:
              current.cleanup === "complete"
                ? ("complete" as const)
                : acceptedSchema.shape.cleanup.parse(cleanup),
          };
          return { record, result: record };
        }),
      ),
    /** Explicit acknowledgement only; pending proof cannot be forgotten through this API. */
    acknowledge: (attemptId: string) =>
      serial(async () => {
        const journal = await read(),
          record = journal.records.find((r) => r.attemptId === attemptId);
        if (
          !record ||
          record.state === "pending" ||
          (record.state === "accepted" && !["complete", "skipped"].includes(record.cleanup))
        )
          throw conflict();
        await write(journal.records.filter((r) => r.attemptId !== attemptId));
      }),
  };
}
export type DeletionAttemptStore = ReturnType<typeof createDeletionAttemptStore>;
