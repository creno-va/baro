import type { Provider, SessionScope, UsageView } from "@baro/client-core";
import { accountDeletionResponseSchema, deletionAccessSchema } from "@baro/contracts/deletion";
import { v2UsageSchema } from "@baro/contracts/v2";
import { z } from "zod";
import { createCaseDeletionClient } from "./case-deletion";
import { ApiError } from "./errors";
import type { DomainRequest, DomainRequestInit } from "./reports";

const reauthenticationMarkerSchema = z.object({
  ownerTag: deletionAccessSchema.shape.ownerTag,
  startedAt: z.number().finite().nonnegative(),
});

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
export function createAccountClient(dependencies: {
  request: DomainRequest;
  scope: SessionScope;
  /** Only opt in when the adapter controls credential changes through this scope. */
  coalesceWrites?: "credential-scope";
  newKey: () => string;
  readReauthentication: () => Promise<unknown>;
  reauthenticate: (provider: Provider) => Promise<void>;
  onDeleted?: (kind: "case" | "account") => Promise<void> | void;
  /** Explicit fixture composition only. Never enable for the native/real transport. */
  allowMockDeletion?: boolean;
}) {
  const generation = dependencies.scope.snapshot();
  const signal = dependencies.scope.signal();
  const ensureCurrent = () => {
    if (!dependencies.scope.isCurrent(generation))
      throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요. 다시 확인해 주세요.");
    signal.throwIfAborted();
  };
  const request: DomainRequest = async <T>(path: string, options: DomainRequestInit = {}) => {
    ensureCurrent();
    try {
      const value = await dependencies.request<T>(path, {
        ...options,
        signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal,
      });
      ensureCurrent();
      return value;
    } catch (error) {
      ensureCurrent();
      throw error;
    }
  };
  let pendingAccountDelete: Promise<void> | undefined;
  const deleted = async (kind: "case" | "account") => {
    ensureCurrent();
    ownerTag = null;
    dependencies.scope.invalidate();
    try {
      await dependencies.onDeleted?.(kind);
    } catch {
      /* A committed deletion remains committed. */
    }
  };
  let ownerTag: string | null = null;
  return {
    async usage(): Promise<UsageSummary> {
      const result = await request<unknown>("/api/v2/me/usage");
      const wire = v2UsageSchema.safeParse(result);
      if (wire.success) {
        const value = wire.data;
        return {
          ...usageViewSchema.parse({
            newCases: {
              used: value.newCases.used + value.newCases.reserved,
              limit: value.newCases.limit,
            },
            aiResponses: {
              used: value.aiResponses.used + value.aiResponses.reserved,
              limit: value.aiResponses.limit,
            },
            storageBytes: {
              used: value.storageBytes.used + value.storageBytes.reserved,
              limit: value.storageBytes.limit,
            },
            mediaMinutes: {
              used: (value.mediaSeconds.used + value.mediaSeconds.reserved) / 60,
              limit: value.mediaSeconds.limit / 60,
            },
          }),
          resetAt: value.resetAt,
          waitReasons: value.waitReasons,
          includesReservations: true,
        };
      }
      return usageViewSchema.parse(result);
    },
    deleteCase: createCaseDeletionClient({
      request,
      scope: dependencies.scope,
      newKey: dependencies.newKey,
      ...(dependencies.coalesceWrites ? { coalesceWrites: dependencies.coalesceWrites } : {}),
      onDeleted: () => deleted("case"),
    }).deleteCase,
    async deleteAccount(confirmation: string) {
      ensureCurrent();
      if (confirmation !== "DELETE") throw new Error("삭제 확인란에 DELETE를 입력해 주세요.");
      if (dependencies.coalesceWrites === "credential-scope" && pendingAccountDelete)
        return pendingAccountDelete;
      const task = (async () => {
        const result = await request<unknown>("/api/me", {
          method: "DELETE",
          body: { confirmation },
          ...(ownerTag ? { headers: { "x-baro-deletion-owner": ownerTag } } : {}),
        });
        accountDeletionResponseSchema.parse(result);
        await deleted("account");
      })();
      if (dependencies.coalesceWrites === "credential-scope") pendingAccountDelete = task;
      try {
        await task;
      } finally {
        if (pendingAccountDelete === task) pendingAccountDelete = undefined;
      }
    },
    async deletionAccess() {
      const result = await request<unknown>("/api/me/deletion");
      const access = (
        dependencies.allowMockDeletion
          ? deletionAccessSchema.extend({ mock: z.boolean().optional() })
          : deletionAccessSchema
      ).parse(result);
      let marker: z.infer<typeof reauthenticationMarkerSchema> | null = null;
      try {
        const parsed = reauthenticationMarkerSchema.safeParse(
          await dependencies.readReauthentication(),
        );
        marker = parsed.success ? parsed.data : null;
      } catch {
        /* Missing/locked local proof cannot grant delete readiness. */
      }
      ensureCurrent();
      ownerTag = access.ownerTag;
      const canDelete =
        (dependencies.allowMockDeletion === true && "mock" in access && access.mock === true) ||
        Boolean(
          marker?.ownerTag === access.ownerTag &&
            access.recentOAuth &&
            access.authenticatedAt &&
            typeof marker?.startedAt === "number" &&
            Date.parse(access.authenticatedAt) >= marker.startedAt,
        );
      return {
        ...deletionAccessSchema.parse({
          ownerTag: access.ownerTag,
          recentOAuth: access.recentOAuth,
          authenticatedAt: access.authenticatedAt,
          providers: access.providers,
        }),
        canDelete,
      };
    },
    async reauthenticate(provider: Provider) {
      ensureCurrent();
      await dependencies.reauthenticate(
        deletionAccessSchema.shape.providers.element.parse(provider),
      );
    },
  };
}
