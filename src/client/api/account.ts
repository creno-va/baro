import { z } from "zod";
import { deletionAccessSchema } from "../../contracts";
import { v2UsageSchema } from "../../contracts/v2";
import { authClient } from "../auth";
import { type ApiRequest, type DomainRequest, domainRequest } from "./reports";
import type { UsageView } from "./types";

const count = z.object({ used: z.number().nonnegative(), limit: z.number().positive() });
const usageViewSchema = z.object({
  newCases: count,
  aiResponses: count,
  mediaMinutes: count,
  storageBytes: count,
});
export type UsageSummary = UsageView & {
  resetAt?: string;
  waitReasons?: string[];
  includesReservations?: boolean;
};
export function createAccountClient(request: DomainRequest) {
  return {
    async usage(): Promise<UsageSummary> {
      const result = await request<unknown>("/api/v2/me/usage");
      const wire = v2UsageSchema.safeParse(result);
      if (wire.success) {
        const value = wire.data;
        return usageViewSchema.parse({
          newCases: value.newCases,
          aiResponses: value.aiResponses,
          storageBytes: value.storageBytes,
          mediaMinutes: {
            used: value.mediaSeconds.used / 60,
            limit: value.mediaSeconds.limit / 60,
          },
        });
      }
      return usageViewSchema.parse(result);
    },
    async deleteCase(id: string, confirmation: string) {
      if (confirmation !== "DELETE") throw new Error("삭제 확인란에 DELETE를 입력해 주세요.");
      await request(`/api/cases/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "idempotency-key": crypto.randomUUID() },
      });
    },
    async deleteAccount(confirmation: string) {
      if (confirmation !== "DELETE") throw new Error("삭제 확인란에 DELETE를 입력해 주세요.");
      const result = await request<unknown>("/api/me", {
        method: "DELETE",
        body: { confirmation },
      });
      z.object({ status: z.literal("accepted") }).parse(result);
    },
    async deletionAccess() {
      const result = await request<unknown>("/api/me/deletion");
      const access = deletionAccessSchema.extend({ mock: z.boolean().optional() }).parse(result);
      let marker: { ownerTag?: string; startedAt?: number } | null = null;
      try {
        const raw =
          typeof sessionStorage === "undefined"
            ? null
            : sessionStorage.getItem("baro.account-reauth.v1");
        marker = raw ? JSON.parse(raw) : null;
      } catch {
        marker = null;
      }
      const canDelete =
        access.mock === true ||
        Boolean(
          marker?.ownerTag === access.ownerTag &&
            access.recentOAuth &&
            access.authenticatedAt &&
            typeof marker?.startedAt === "number" &&
            Date.parse(access.authenticatedAt) >= marker.startedAt,
        );
      const { mock: _mock, ...view } = access;
      return { ...view, canDelete };
    },
    async reauthenticate(provider: "google" | "naver" | "kakao") {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: "/settings",
        errorCallbackURL: "/settings?error=oauth",
      });
      if (result.error) throw new Error("재인증을 시작하지 못했어요. 다시 시도해 주세요.");
    },
  };
}

export function createAccountApi(request: ApiRequest) {
  return createAccountClient(domainRequest(request));
}
