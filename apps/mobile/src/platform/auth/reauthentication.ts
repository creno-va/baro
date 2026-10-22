import { ApiError } from "@baro/api-client";
import { mobileAuthAttemptIdSchema, mobileReauthReceiptSchema } from "@baro/contracts/mobile-auth";
import type { createPendingAuthStore } from "./attempt";

const proofSchema = mobileReauthReceiptSchema.extend({ attemptId: mobileAuthAttemptIdSchema });
const unavailable = () =>
  new ApiError(
    "UNAVAILABLE",
    "재인증 확인 정보를 기기에 보관하지 못했어요. 다시 시도해 주세요.",
    true,
  );
export function createReauthenticationStore(dependencies: {
  key: string;
  storage: Parameters<typeof createPendingAuthStore>[0]["storage"];
}) {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(dependencies.key)) throw unavailable();
  let pending: Promise<unknown> = Promise.resolve();
  function serial<T>(action: () => Promise<T>) {
    const task = pending
      .catch(() => {})
      .then(action)
      .catch(() => {
        throw unavailable();
      });
    pending = task;
    return task;
  }
  return {
    load: () =>
      serial(async () => {
        const raw = await dependencies.storage.getItemAsync(dependencies.key);
        return raw === null ? null : proofSchema.parse(JSON.parse(raw));
      }),
    put: (input: unknown) =>
      serial(async () => {
        const value = JSON.stringify(proofSchema.parse(input));
        await dependencies.storage.setItemAsync(dependencies.key, value);
        if ((await dependencies.storage.getItemAsync(dependencies.key)) !== value)
          throw unavailable();
      }),
    clear: () =>
      serial(async () => {
        await dependencies.storage.deleteItemAsync(dependencies.key);
        if ((await dependencies.storage.getItemAsync(dependencies.key)) !== null)
          throw unavailable();
      }),
  };
}
export type ReauthenticationStore = ReturnType<typeof createReauthenticationStore>;
