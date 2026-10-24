import { Hono } from "hono";
import {
  MOBILE_AUTH_CONTRACT_HEADER,
  MOBILE_DELETION_ACTIVITY_HEADER,
  mobileReauthReceiptSchema,
} from "../../contracts/mobile-auth";
import {
  mobileDeletionActivityRequestSchema,
  mobileDeletionExchangeSchema,
  mobileDeletionPrepareReceiptSchema,
  mobileDeletionPrepareSchema,
  mobileDeletionProofSchema,
} from "../../contracts/mobile-deletion";
import { availableMobileAuthProviders } from "../auth/mobile-contract";
import { NativeAuthProofError } from "../auth/native-codes";
import { createNativeDeletionActivityProof } from "../auth/native-deletion-activity";
import { createNativeDeletionReceipts } from "../auth/native-deletion-receipt";
import { createNativeReauthentication } from "../auth/native-reauth";
import { getSession } from "../auth/session";
import { deletionOwnerTag } from "../modules/deletion/service";
import { type ApiEnvironment, errorBody } from "./errors";
import { hasAllowedOrigin } from "./me";

export const mobileDeletionApi = new Hono<ApiEnvironment>()
  .use("*", async (c, next) => {
    c.header("cache-control", "private, no-store");
    c.header("x-content-type-options", "nosniff");
    if (!hasAllowedOrigin(c.req.raw, c.env.BETTER_AUTH_URL))
      return c.json(errorBody(c, "ORIGIN_NOT_ALLOWED", "허용되지 않은 요청이에요."), 403);
    if (c.req.header(MOBILE_AUTH_CONTRACT_HEADER) !== "2")
      return c.json(errorBody(c, "VALIDATION_ERROR", "앱의 인증 설정을 확인해 주세요."), 400);
    return next();
  })
  .post("/prepare", async (c) => {
    const input = mobileDeletionPrepareSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      return c.json(errorBody(c, "VALIDATION_ERROR", "삭제 확인을 다시 입력해 주세요."), 400);
    const session = await getSession(c);
    if (!session) return c.json(errorBody(c, "UNAUTHENTICATED", "로그인이 필요해요."), 401);
    if (!availableMobileAuthProviders(c.env).some((v) => v === input.data.provider))
      return c.json(
        errorBody(c, "DEPENDENCY_UNAVAILABLE", "이 로그인 수단은 아직 사용할 수 없어요.", true),
        503,
      );
    try {
      const prepared = await createNativeReauthentication({
        db: c.env.DB,
        issuer: c.env.BETTER_AUTH_URL,
        secret: c.env.BETTER_AUTH_SECRET,
      }).prepareDeletion(input.data, { userId: session.user.id, sessionId: session.session.id });
      const receipt = mobileReauthReceiptSchema.parse({
        ...prepared,
        ownerTag: await deletionOwnerTag(c.env.BETTER_AUTH_SECRET, session.user.id),
      });
      if (c.req.header(MOBILE_DELETION_ACTIVITY_HEADER) !== "1") return c.json(receipt);
      const activityProof = await createNativeDeletionActivityProof({
        issuer: c.env.BETTER_AUTH_URL,
        secret: c.env.BETTER_AUTH_SECRET,
      }).sign({
        attemptId: input.data.attemptId,
        challenge: input.data.challenge,
        ownerTag: receipt.ownerTag,
        startedAt: receipt.startedAt,
      });
      return c.json(mobileDeletionPrepareReceiptSchema.parse({ ...receipt, activityProof }));
    } catch (error) {
      return error instanceof NativeAuthProofError
        ? c.json(errorBody(c, "UNAUTHENTICATED", "같은 계정으로 삭제를 다시 시작해 주세요."), 401)
        : c.json(
            errorBody(
              c,
              "DEPENDENCY_UNAVAILABLE",
              "삭제 준비를 마치지 못했어요. 다시 시도해 주세요.",
              true,
            ),
            503,
          );
    }
  });
for (const operation of ["exchange", "status", "cancel", "activity"] as const)
  mobileDeletionApi.post(`/${operation}`, async (c) => {
    const raw = await c.req.json().catch(() => null),
      input = (
        operation === "exchange"
          ? mobileDeletionExchangeSchema
          : operation === "activity"
            ? mobileDeletionActivityRequestSchema
            : mobileDeletionProofSchema
      ).safeParse(raw);
    if (!input.success)
      return c.json(errorBody(c, "VALIDATION_ERROR", "삭제 결과를 다시 확인해 주세요."), 400);
    try {
      if (operation === "activity")
        return c.json(
          await createNativeReauthentication({
            db: c.env.DB,
            issuer: c.env.BETTER_AUTH_URL,
            secret: c.env.BETTER_AUTH_SECRET,
          }).deletionActivity(input.data),
        );
      const receipts = createNativeDeletionReceipts({
        db: c.env.DB,
        issuer: c.env.BETTER_AUTH_URL,
        secret: c.env.BETTER_AUTH_SECRET,
      });
      if (operation === "exchange") return c.json(await receipts.exchange(input.data));
      const outcome = await receipts.status(input.data);
      if (outcome) return c.json(outcome, operation === "cancel" ? 202 : 200);
      if (operation === "cancel") {
        try {
          const cancelled = await createNativeReauthentication({
            db: c.env.DB,
            issuer: c.env.BETTER_AUTH_URL,
            secret: c.env.BETTER_AUTH_SECRET,
          }).cancelDeletion(input.data);
          if (cancelled) return c.json({ status: "cancelled" as const });
        } catch (error) {
          if (!(error instanceof NativeAuthProofError)) throw error;
        }
        const completed = await receipts.status(input.data);
        if (completed) return c.json(completed, 202);
      }
      throw new NativeAuthProofError();
    } catch (error) {
      return error instanceof NativeAuthProofError
        ? c.json(
            errorBody(c, "UNAUTHENTICATED", "삭제 결과를 확인하지 못했어요. 다시 확인해 주세요."),
            401,
          )
        : c.json(
            errorBody(
              c,
              "DEPENDENCY_UNAVAILABLE",
              "삭제 결과를 확인하지 못했어요. 다시 확인해 주세요.",
              true,
            ),
            503,
          );
    }
  });
