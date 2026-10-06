import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
import { idempotencyKeySchema, opaqueIdSchema, revisionSchema } from "../../../contracts";
import type { V2ErrorCode } from "../../../contracts/v2";
import { getAuth } from "../../auth";
import { readAccountType } from "../../auth/account-type";
import { lawyerAccess } from "../../auth/roles";
import { createCaseDataCipher } from "../../crypto";
import * as schema from "../../db/schema";
import { createV2Core, type V2Core } from "../../db/v2-core";
import { hasCurrentConsent } from "../../modules/consent/service";
import { AssetBinaryError } from "../../modules/lawyers/asset-binary";
import { createLawyerAssetsService } from "../../modules/lawyers/assets";
import type { OpenSanitizedAsset } from "../../modules/lawyers/sanitized";
import { createSelfAssetReader, selfAssetResponse } from "../../modules/lawyers/self-assets";
import { createSelfProfileService } from "../../modules/lawyers/self-profile";
import { selfAssetUrl, selfProfileSchema } from "../../modules/lawyers/self-profile-contract";
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
    selfAssetDecoder?: OpenSanitizedAsset;
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
    const profile = await (await selfService(c.env)).getMine(a.ownerId);
    const after = await selfAccess(c);
    if (after.response) return after.response;
    if (after.ownerId !== a.ownerId)
      return c.json(errorBody(c, "NOT_FOUND", "프로필을 찾을 수 없어요."), 404);
    return c.json(profile);
  });
  app.get("/lawyer/self-profile/assets", async (c) => {
    const a = await selfAccess(c);
    if (a.response) return a.response;
    const rows = await c.env.DB.prepare(
      "SELECT a.id,a.revision,a.state AS status,a.purpose FROM v2_assets a JOIN v2_profiles p ON p.id=a.profile_id WHERE a.owner_id=? AND p.owner_id=a.owner_id AND a.purpose IN ('profile_photo','portfolio') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='asset' AND target_id=a.id) OR (target_kind='profile' AND target_id=a.profile_id) OR (target_kind='account' AND target_id=a.owner_id)) ORDER BY a.created_at DESC LIMIT 50",
    )
      .bind(a.ownerId)
      .all<{ id: string; revision: number; status: string; purpose: string }>();
    const after = await selfAccess(c);
    if (after.response) return after.response;
    if (after.ownerId !== a.ownerId)
      return c.json(errorBody(c, "NOT_FOUND", "자료를 찾을 수 없어요."), 404);
    return c.json({
      items: rows.results.map((row) => ({
        id: row.id,
        revision: row.revision,
        status: row.status,
        purpose: row.purpose,
      })),
    });
  });
  app.get("/lawyer/self-profile/assets/:assetId/content", async (c) => {
    const a = await selfAccess(c);
    if (a.response) return a.response;
    const core = createV2Core(c.env.DB, await createCaseDataCipher(c.env));
    const service = createSelfProfileService(core);
    const profile = await service.getMine(a.ownerId);
    const assetId = c.req.param("assetId");
    const purpose = await core
      .statement(
        "SELECT purpose FROM v2_assets WHERE id=? AND owner_id=? AND profile_id=? AND purpose IN ('profile_photo','portfolio')",
        [assetId, a.ownerId, profile.id],
      )
      .first<string>("purpose");
    if (!purpose) throw new LawyerError("NOT_FOUND");
    // Own ready uploads can be previewed before saving; public reads still require a persisted reference.
    const preview =
      purpose === "profile_photo"
        ? { ...profile, photoAssetId: assetId, photoUrl: selfAssetUrl(profile.id, assetId) }
        : {
            ...profile,
            portfolio: [
              { id: assetId, title: "자료", assetId, url: selfAssetUrl(profile.id, assetId) },
            ],
          };
    const read = createSelfAssetReader(core, {
      environment: c.env.APP_ENV === "production" ? "production" : "preview",
      bucket: c.env.CASE_PRIVATE_R2,
      ...(options.selfAssetDecoder ? { openSanitized: options.selfAssetDecoder } : {}),
    });
    return selfAssetResponse(
      await read(a.ownerId, preview, assetId, async () => {
        // Stream checks read auth without rewriting response headers after the body starts.
        const access = await getAuth(c.env).api.getSession({ headers: c.req.raw.headers });
        return (
          access?.user.id === a.ownerId &&
          access.session.id === a.sessionId &&
          (await readAccountType(c.env.DB, a.ownerId)) === "lawyer" &&
          (await hasCurrentConsent(drizzle(c.env.DB, { schema }), a.ownerId)) &&
          (await service.getMine(a.ownerId)).revision === profile.revision
        );
      }),
    );
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
        profileId: opaqueIdSchema.optional(),
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
        body.profileId,
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
