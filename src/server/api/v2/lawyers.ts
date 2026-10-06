import { Hono } from "hono";
import { z } from "zod";
import { idempotencyKeySchema, opaqueIdSchema, revisionSchema } from "../../../contracts";
import type { V2ErrorCode } from "../../../contracts/v2";
import { readAccountType } from "../../auth/account-type";
import { lawyerAccess } from "../../auth/roles";
import { createCaseDataCipher } from "../../crypto";
import { createV2Core, type V2Core } from "../../db/v2-core";
import { AssetBinaryError } from "../../modules/lawyers/asset-binary";
import { createLawyerAssetsService } from "../../modules/lawyers/assets";
import { createSelfProfileService } from "../../modules/lawyers/self-profile";
import { selfProfileSchema } from "../../modules/lawyers/self-profile-contract";
import {
  createLawyersService,
  type LawyerDependencies,
  LawyerError,
} from "../../modules/lawyers/service";
import { type ApiEnvironment, errorBody } from "../errors";

export function privateLawyerApi() {
  const app = new Hono<ApiEnvironment>();
  app.use("*", async (c, next) => {
    c.header("cache-control", "private, no-store");
    c.header("x-content-type-options", "nosniff");
    if (c.env.APP_ENV === "production" && c.env.PUBLIC_BETA_ENABLED !== "true")
      return c.json(errorBody(c, "BETA_NOT_OPEN", "공개 베타를 준비하고 있어요."), 503);
    await next();
    c.header("cache-control", "private, no-store");
    return;
  });
  app.onError((error, c) => {
    if (error instanceof AssetBinaryError)
      return c.json(errorBody(c, "FILE_REJECTED", "자료 내용을 확인해 주세요."), 400);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return c.json(errorBody(c, "VALIDATION_ERROR", "요청 내용을 확인해 주세요."), 400);
    if (error instanceof LawyerError) {
      const codes: Record<LawyerError["code"], V2ErrorCode> = {
        NOT_FOUND: "NOT_FOUND",
        STALE_REVISION: "STALE_REVISION",
        REVIEW_REQUIRED: "REVIEW_REQUIRED",
        ASSET_NOT_READY: "FILE_REJECTED",
        PROCESSING_UNAVAILABLE: "FILE_PROCESSING_FAILED",
      };
      const status =
        error.code === "NOT_FOUND" ? 404 : error.code === "PROCESSING_UNAVAILABLE" ? 503 : 409;
      return c.json(
        errorBody(c, codes[error.code], "요청을 처리하지 못했어요.", status === 503),
        status,
      );
    }
    return c.json(errorBody(c, "INTERNAL_ERROR", "요청을 처리하지 못했어요.", true), 500);
  });
  return app;
}
export const expectedRevisionBody = z.strictObject({ expectedRevision: revisionSchema });
export function createLawyersApi(
  options: {
    dependencies?: (env: Env, core: V2Core, ownerId: string) => Promise<LawyerDependencies>;
  } = {},
) {
  const app = privateLawyerApi();
  const selfService = async (env: Env) =>
    createSelfProfileService(createV2Core(env.DB, await createCaseDataCipher(env)));
  const selfAccess = async (c: import("hono").Context<ApiEnvironment>, mutation = false) => {
    const a = await lawyerAccess(c, { mutation, consent: true });
    if (a.response) return a;
    const row = await c.env.DB.prepare(
      "SELECT id FROM user WHERE id=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=user.id)",
    )
      .bind(a.ownerId)
      .first();
    if (!row || (await readAccountType(c.env.DB, a.ownerId)) !== "lawyer")
      return {
        response: c.json(errorBody(c, "ROLE_REQUIRED", "변호사 역할로 로그인해 주세요."), 403),
      };
    return a;
  };
  app.get("/lawyer/self-profile", async (c) => {
    const a = await selfAccess(c);
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    return c.json(await (await selfService(c.env)).getMine(a.ownerId));
  });
  app.put("/lawyer/self-profile", async (c) => {
    const a = await selfAccess(c, true);
    if (a.response) return a.response;
    const body = z.strictObject({ profile: selfProfileSchema }).parse(await c.req.json());
    return c.json(await (await selfService(c.env)).saveMine(a.ownerId, body.profile));
  });
  app.post("/lawyer/self-profile/publication", async (c) => {
    const a = await selfAccess(c, true);
    if (a.response) return a.response;
    const body = z
      .strictObject({
        published: z.boolean(),
        expectedRevision: revisionSchema,
        consent: z.boolean(),
      })
      .refine((b) => !b.published || b.consent)
      .parse(await c.req.json());
    return c.json(
      await (await selfService(c.env)).publishMine(
        a.ownerId,
        body.published,
        body.expectedRevision,
      ),
    );
  });
  const service = async (env: Env, ownerId: string) => {
    const core = createV2Core(env.DB, await createCaseDataCipher(env));
    return createLawyersService(core, await options.dependencies?.(env, core, ownerId));
  };
  const assets = async (env: Env, ownerId: string) => {
    const core = createV2Core(env.DB, await createCaseDataCipher(env));
    return createLawyerAssetsService(core, {
      ...(await options.dependencies?.(env, core, ownerId)),
      environment: env.APP_ENV === "production" ? "production" : "preview",
    });
  };
  app.get("/roles", async (c) => {
    const a = await lawyerAccess(c);
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    return c.json(await (await service(c.env, a.ownerId)).roles(a.ownerId, a.sessionId));
  });
  app.get("/lawyer/application", async (c) => {
    const a = await lawyerAccess(c);
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    return c.json(await (await service(c.env, a.ownerId)).application(a.ownerId));
  });
  app.post("/lawyer/application", async (c) => {
    const a = await lawyerAccess(c, { mutation: true, consent: true });
    if (a.response) return a.response;
    z.strictObject({}).parse(await c.req.json());
    return c.json(await (await service(c.env, a.ownerId)).createApplication(a.ownerId), 201);
  });
  app.put("/lawyer/application", async (c) => {
    const a = await lawyerAccess(c, { mutation: true, consent: true });
    if (a.response) return a.response;
    return c.json(
      await (await service(c.env, a.ownerId)).saveApplication(a.ownerId, await c.req.json()),
    );
  });
  app.post("/lawyer/application/submit", async (c) => {
    const a = await lawyerAccess(c, { mutation: true, consent: true });
    if (a.response) return a.response;
    const body = expectedRevisionBody.parse(await c.req.json());
    return c.json(
      await (await service(c.env, a.ownerId)).submitApplication(a.ownerId, body.expectedRevision),
    );
  });
  app.post("/lawyer/application/withdraw", async (c) => {
    const a = await lawyerAccess(c, { mutation: true });
    if (a.response) return a.response;
    const body = expectedRevisionBody.parse(await c.req.json());
    return c.json(
      await (await service(c.env, a.ownerId)).withdrawApplication(a.ownerId, body.expectedRevision),
    );
  });
  app.get("/lawyer/profile", async (c) => {
    const a = await lawyerAccess(c);
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    return c.json(await (await service(c.env, a.ownerId)).profile(a.ownerId));
  });
  app.put("/lawyer/profile", async (c) => {
    const a = await lawyerAccess(c, { mutation: true, consent: true });
    if (a.response) return a.response;
    return c.json(
      await (await service(c.env, a.ownerId)).saveProfile(a.ownerId, await c.req.json()),
    );
  });
  app.post("/lawyer/profile/submit", async (c) => {
    const a = await lawyerAccess(c, { mutation: true, consent: true });
    if (a.response) return a.response;
    const body = expectedRevisionBody.parse(await c.req.json());
    return c.json(
      await (await service(c.env, a.ownerId)).submitProfile(a.ownerId, body.expectedRevision),
    );
  });
  app.post("/lawyer/profile/withdraw", async (c) => {
    const a = await lawyerAccess(c, { mutation: true });
    if (a.response) return a.response;
    return c.json(
      await (await service(c.env, a.ownerId)).withdrawProfile(a.ownerId, await c.req.json()),
    );
  });
  for (const group of ["verification-assets", "portfolio-assets"] as const) {
    const scope = group === "verification-assets" ? "verification" : "portfolio";
    app.get(`/lawyer/${group}`, async (c) => {
      const a = await lawyerAccess(c);
      if (a.response) return a.response;
      const q = z
        .strictObject({
          cursor: opaqueIdSchema.optional(),
          limit: z.coerce.number().int().min(1).max(20).default(20),
        })
        .parse(c.req.query());
      return c.json(
        await (await assets(c.env, a.ownerId)).list(a.ownerId, scope, q.cursor, q.limit),
      );
    });
    app.post(`/lawyer/${group}`, async (c) => {
      const a = await lawyerAccess(c, { mutation: true, consent: true });
      if (a.response) return a.response;
      const match = c.req.header("if-match");
      if (!match || !/^[1-9]\d*$/.test(match)) throw new LawyerError("STALE_REVISION");
      const key = idempotencyKeySchema.parse(c.req.header("idempotency-key"));
      return c.json(
        await (await assets(c.env, a.ownerId)).reserve(
          a.ownerId,
          Number(match),
          key,
          await c.req.json(),
          scope,
        ),
        201,
      );
    });
    app.get(`/lawyer/${group}/:assetId`, async (c) => {
      const a = await lawyerAccess(c);
      if (a.response) return a.response;
      return c.json(
        await (await service(c.env, a.ownerId)).asset(
          a.ownerId,
          opaqueIdSchema.parse(c.req.param("assetId")),
          group === "verification-assets" ? "verification" : "portfolio",
        ),
      );
    });
    app.delete(`/lawyer/${group}/:assetId`, async (c) => {
      const a = await lawyerAccess(c, { mutation: true });
      if (a.response) return a.response;
      const body = expectedRevisionBody.parse(await c.req.json());
      await (await service(c.env, a.ownerId)).asset(
        a.ownerId,
        c.req.param("assetId"),
        group === "verification-assets" ? "verification" : "portfolio",
      );
      return c.json(
        await (await service(c.env, a.ownerId)).removeAsset(
          a.ownerId,
          c.req.param("assetId"),
          body.expectedRevision,
        ),
        202,
      );
    });
  }
  app.put("/lawyer/assets/:assetId/content", async (c) => {
    const a = await lawyerAccess(c, { mutation: true, consent: true });
    if (a.response) return a.response;
    const match = c.req.header("if-match");
    const length = c.req.header("content-length");
    if (!match || !/^[1-9]\d*$/.test(match)) throw new LawyerError("STALE_REVISION");
    if (
      !length ||
      !/^[1-9]\d*$/.test(length) ||
      c.req.header("content-type") !== "application/octet-stream"
    )
      throw new LawyerError("ASSET_NOT_READY");
    return c.json(
      await (await assets(c.env, a.ownerId)).upload(
        a.ownerId,
        c.req.param("assetId"),
        Number(match),
        Number(length),
        c.req.raw.body,
      ),
    );
  });
  app.get("/lawyer/assets/:assetId/content", async (c) => {
    const a = await lawyerAccess(c);
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    const result = await (await assets(c.env, a.ownerId)).open(a.ownerId, c.req.param("assetId"));
    return new Response(result.body, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment; filename=asset.bin",
        "content-length": String(result.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
  return app;
}
export const lawyersApi = createLawyersApi();
