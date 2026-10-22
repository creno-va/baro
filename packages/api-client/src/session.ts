import type { SessionScope } from "@baro/client-core";
import { type ConsentInput, consentInputSchema } from "@baro/contracts/consent";
import {
  type ClientSession,
  clientAccountTypeSchema,
  consentStatusSchema,
  sessionViewSchema,
} from "@baro/contracts/session";
import { decode } from "./decode";
import { ApiError } from "./errors";
import type { JsonRequest } from "./http";

export function createSessionClient(request: JsonRequest, scope?: SessionScope) {
  let pending: { generation: number | undefined; promise: Promise<ClientSession> } | undefined;
  return {
    async get(): Promise<ClientSession> {
      const generation = scope?.snapshot();
      if (!pending || pending.generation !== generation) {
        const promise = request({ path: "/api/me/session" }).then((value) =>
          decode(sessionViewSchema, value),
        );
        const current = { generation, promise };
        pending = current;
        void promise
          .finally(() => {
            if (pending === current) pending = undefined;
          })
          .catch(() => {});
      }
      const session = await pending.promise;
      if (generation !== undefined && !scope?.isCurrent(generation))
        throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요. 다시 확인해 주세요.");
      return { ...session, user: session.user ? { ...session.user } : null };
    },
    async getConsent() {
      return decode(consentStatusSchema, await request({ path: "/api/me/consent" }));
    },
    async saveConsent(input: ConsentInput) {
      const parsed = consentInputSchema.safeParse(input);
      if (!parsed.success)
        throw new ApiError("VALIDATION_ERROR", "현재 정책과 만 14세 이상 여부를 확인해 주세요.");
      return decode(
        consentStatusSchema,
        await request({
          path: "/api/me/consent",
          method: "PUT",
          body: parsed.data,
        }),
      );
    },
    async setAccountType(accountType: "customer" | "lawyer") {
      const parsed = clientAccountTypeSchema.safeParse(accountType);
      if (!parsed.success)
        throw new ApiError("VALIDATION_ERROR", "고객 또는 변호사 이용 유형을 선택해 주세요.");
      const value = await request<{ accountType: unknown }>({
        path: "/api/me/account-type",
        method: "PUT",
        body: { accountType: parsed.data },
      });
      return decode(clientAccountTypeSchema, value?.accountType);
    },
    invalidate() {
      pending = undefined;
      scope?.invalidate();
    },
  };
}
