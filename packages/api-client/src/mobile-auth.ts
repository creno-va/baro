import { deletionAccessSchema, deletionAccessV2Schema } from "@baro/contracts/deletion";
import {
  legacyMobileAuthProviderSchema,
  MOBILE_AUTH_CONTRACT_HEADER,
  type MobileAuthProvider,
  mobileAuthCapabilitiesSchema,
  mobileReauthPrepareSchema,
  mobileReauthPrepareV2Schema,
  mobileReauthProofSchema,
  mobileReauthReceiptSchema,
} from "@baro/contracts/mobile-auth";
import {
  mobileDeletionCancelResponseSchema,
  mobileDeletionExchangeSchema,
  mobileDeletionOutcomeSchema,
  mobileDeletionPrepareSchema,
  mobileDeletionProofSchema,
} from "@baro/contracts/mobile-deletion";
import type { z } from "zod";
import { ApiError } from "./errors";
import type { JsonRequest } from "./http";

export type MobileAuthProtocol =
  | { contractVersion: 1; providers: ("google" | "naver" | "kakao")[] }
  | { contractVersion: 2; providers: MobileAuthProvider[] };
const headers = { [MOBILE_AUTH_CONTRACT_HEADER]: "2" };
const unavailable = () =>
  new ApiError("UNAVAILABLE", "서버의 인증 응답을 확인하지 못했어요. 다시 확인해 주세요.", true);
const denied = () =>
  new ApiError("UNAUTHENTICATED", "삭제할 계정이 변경됐어요. 결과를 다시 확인해 주세요.");
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw unavailable();
  return result.data;
}
function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError("VALIDATION_ERROR", "인증 요청을 다시 시작해 주세요.");
  return result.data;
}
function requireOwnerTag(ownerTag: string) {
  if (!mobileDeletionOutcomeSchema.shape.ownerTag.safeParse(ownerTag).success) throw denied();
}
function requireV2(protocol: MobileAuthProtocol) {
  if (protocol.contractVersion !== 2) throw unavailable();
}
function supported(protocol: MobileAuthProtocol, provider: MobileAuthProvider) {
  if (!protocol.providers.some((value) => value === provider))
    throw new ApiError(
      "VALIDATION_ERROR",
      "현재 서버에서 사용할 수 있는 로그인 수단을 다시 확인해 주세요.",
    );
}
function boundOutcome(value: unknown, ownerTag: string) {
  const outcome = parse(mobileDeletionOutcomeSchema, value);
  if (
    !mobileDeletionOutcomeSchema.shape.ownerTag.safeParse(ownerTag).success ||
    outcome.ownerTag !== ownerTag
  )
    throw denied();
  return outcome;
}

/** Wire only. Session credentials, pending verifier storage and owner-scoped cleanup stay in adapters. */
export function createMobileAuthClient(dependencies: {
  request: JsonRequest;
  /** Explicit separate transport: deletion receipts must remain readable after that session is deleted. */
  completionRequest: JsonRequest;
}) {
  return {
    async capabilities(): Promise<MobileAuthProtocol> {
      let value: unknown;
      try {
        value = await dependencies.request({ path: "/api/mobile/auth/capabilities" });
      } catch (error) {
        // Never infer endpoint absence from a server error code, timeout or malformed successful body.
        if (error instanceof ApiError && error.httpStatus === 404)
          return { contractVersion: 1, providers: [...legacyMobileAuthProviderSchema.options] };
        if (error instanceof ApiError) throw error;
        throw unavailable();
      }
      return parse(mobileAuthCapabilitiesSchema, value);
    },
    async deletionAccess(protocol: MobileAuthProtocol, ownerId: string) {
      const value = await dependencies.request({
        path: "/api/me/deletion",
        expectedOwner: ownerId,
        ...(protocol.contractVersion === 2 ? { headers } : {}),
      });
      return protocol.contractVersion === 2
        ? parse(deletionAccessV2Schema, value)
        : { ...parse(deletionAccessSchema, value), contractVersion: 1 as const };
    },
    async prepareReauthentication(protocol: MobileAuthProtocol, input: unknown, ownerId: string) {
      const body = parseInput(
        protocol.contractVersion === 2 ? mobileReauthPrepareV2Schema : mobileReauthPrepareSchema,
        input,
      );
      supported(protocol, body.provider);
      return parse(
        mobileReauthReceiptSchema,
        await dependencies.request({
          path: "/api/mobile/auth/reauth/prepare",
          method: "POST",
          body,
          expectedOwner: ownerId,
          ...(protocol.contractVersion === 2 ? { headers } : {}),
        }),
      );
    },
    async verifyReauthentication(protocol: MobileAuthProtocol, input: unknown) {
      const body = parseInput(mobileReauthProofSchema, input);
      return parse(
        mobileReauthReceiptSchema,
        await dependencies.request({
          path: "/api/mobile/auth/reauth/verify",
          method: "POST",
          body,
          ...(protocol.contractVersion === 2 ? { headers } : {}),
        }),
      );
    },
    async prepareDeletion(protocol: MobileAuthProtocol, input: unknown, ownerId: string) {
      requireV2(protocol);
      const body = parseInput(mobileDeletionPrepareSchema, input);
      supported(protocol, body.provider);
      return parse(
        mobileReauthReceiptSchema,
        await dependencies.request({
          path: "/api/mobile/auth/deletion/prepare",
          method: "POST",
          headers,
          body,
          expectedOwner: ownerId,
        }),
      );
    },
    async exchangeDeletion(input: unknown, ownerTag: string) {
      requireOwnerTag(ownerTag);
      const body = parseInput(mobileDeletionExchangeSchema, input);
      return boundOutcome(
        await dependencies.completionRequest({
          path: "/api/mobile/auth/deletion/exchange",
          method: "POST",
          headers,
          body,
        }),
        ownerTag,
      );
    },
    async deletionStatus(input: unknown, ownerTag: string) {
      requireOwnerTag(ownerTag);
      const body = parseInput(mobileDeletionProofSchema, input);
      return boundOutcome(
        await dependencies.completionRequest({
          path: "/api/mobile/auth/deletion/status",
          method: "POST",
          headers,
          body,
        }),
        ownerTag,
      );
    },
    async cancelDeletion(input: unknown, ownerTag: string) {
      requireOwnerTag(ownerTag);
      const body = parseInput(mobileDeletionProofSchema, input);
      const result = parse(
        mobileDeletionCancelResponseSchema,
        await dependencies.completionRequest({
          path: "/api/mobile/auth/deletion/cancel",
          method: "POST",
          headers,
          body,
        }),
      );
      return result.status === "cancelled" ? result : boundOutcome(result, ownerTag);
    },
  };
}
export type MobileAuthClient = ReturnType<typeof createMobileAuthClient>;
