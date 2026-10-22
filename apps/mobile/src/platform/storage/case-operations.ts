import { ApiError, type CaseOperationStorage, uploadRecoveryRecordSchema } from "@baro/api-client";
import { z } from "zod";

const uuid = z.uuid();
const wire = z.strictObject({
  owner: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
  revision: z.number().int().positive(),
  summaryRevision: z.number().int().positive().optional(),
});
const failed = () =>
  new ApiError(
    "UNAVAILABLE",
    "요청 복구 정보를 기기에 보관하지 못했어요. 입력을 유지한 채 다시 시도해 주세요.",
    true,
  );
function kind(key: string) {
  if (/^baro-upload-operation:[a-f0-9]{64}$/.test(key)) return "upload";
  if (/^baro-workspace-request:[a-f0-9]{64}$/.test(key)) return "request";
  if (/^baro-reports-request:[a-f0-9]{64}$/.test(key)) return "request";
  if (/^baro-workspace-job:[A-Za-z0-9_.-]{1,128}$/.test(key)) return "job";
  if (/^baro-cases-request:[A-Za-z0-9_:/.-]{1,600}:[a-f0-9]{64}$/.test(key)) return "request";
  if (key.startsWith("baro-cases-wire:") && uuid.safeParse(key.slice(16)).success) return "wire";
  throw failed();
}
function validate(key: string, value: string) {
  if (value.length > 1024) throw failed();
  const valid =
    kind(key) === "upload"
      ? uploadRecoveryRecordSchema.safeParse(JSON.parse(value)).success
      : kind(key) === "request"
        ? uuid.safeParse(value).success
        : kind(key) === "job"
          ? /^[A-Za-z0-9_.-]{1,128}$/.test(value)
          : wire.safeParse(JSON.parse(value)).success;
  if (!valid) throw failed();
}
/** No clearing API: auth reset must not discard unresolved operations. One queue survives auth generations. */
export function createCaseOperationStorage(dependencies: {
  namespace: string;
  fingerprint: (value: string) => Promise<string>;
  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
}): CaseOperationStorage {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(dependencies.namespace)) throw failed();
  let pending: Promise<unknown> = Promise.resolve();
  const run = <T>(task: () => Promise<T>) => {
    const result = pending
      .catch(() => {})
      .then(task)
      .catch(() => {
        throw failed();
      });
    pending = result;
    return result;
  };
  const physical = async (key: string) => {
    kind(key);
    const hash = await dependencies.fingerprint(key);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw failed();
    return `${dependencies.namespace}.${hash}`;
  };
  return {
    getItem: (key) =>
      run(async () => {
        const value = await dependencies.storage.get(await physical(key));
        if (value !== null) validate(key, value);
        return value;
      }),
    setItem: (key, value) =>
      run(async () => {
        validate(key, value);
        const name = await physical(key);
        await dependencies.storage.set(name, value);
        if ((await dependencies.storage.get(name)) !== value) throw failed();
      }),
    removeItem: (key) =>
      run(async () => {
        const name = await physical(key);
        await dependencies.storage.remove(name);
        if ((await dependencies.storage.get(name)) !== null) throw failed();
      }),
  };
}
