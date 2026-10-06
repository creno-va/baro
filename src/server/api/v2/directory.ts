import { type Context, Hono } from "hono";
import { z } from "zod";
import { v2DirectoryQuerySchema } from "../../../contracts/v2";
import { createCaseDataCipher } from "../../crypto";
import { createV2Core, V2RepositoryError } from "../../db/v2-core";
import { createV2StorageCapacityRepository } from "../../db/v2-storage-capacity";
import {
  createDirectoryService,
  DirectoryError,
  publicProfileQuerySchema,
} from "../../modules/lawyers/directory";
import { readPublicAsset } from "../../modules/lawyers/public-read";
import type { OpenSanitizedAsset } from "../../modules/lawyers/sanitized";
import { createSelfAssetReader, selfAssetResponse } from "../../modules/lawyers/self-assets";
import { createSelfProfileService } from "../../modules/lawyers/self-profile";
import { LawyerError } from "../../modules/lawyers/service";
import { type ApiEnvironment, errorBody } from "../errors";

export function createDirectoryApi(
  options: { clock?: () => string; selfAssetDecoder?: OpenSanitizedAsset } = {},
) {
  const app = new Hono<ApiEnvironment>();
  app.use("*", async (c, next) => {
    c.header("cache-control", "no-store");
    if (c.env.APP_ENV === "production" && c.env.PUBLIC_BETA_ENABLED !== "true")
      return c.json(errorBody(c, "BETA_NOT_OPEN", "공개 베타를 준비하고 있어요."), 503);
    await next();
    return;
  });
  app.onError((error, c) => {
    if (error instanceof LawyerError && error.code === "NOT_FOUND")
      return c.json(errorBody(c, "NOT_FOUND", "공개된 프로필을 찾을 수 없어요."), 404);
    if (
      error instanceof z.ZodError ||
      (error instanceof V2RepositoryError && error.code === "REPOSITORY_INPUT_INVALID")
    )
      return c.json(errorBody(c, "VALIDATION_ERROR", "검색 조건을 확인해 주세요."), 400);
    if (error instanceof DirectoryError)
      return c.json(
        errorBody(
          c,
          error.code,
          error.code === "CURSOR_EXPIRED"
            ? "목록이 갱신됐어요. 다시 검색해 주세요."
            : error.code === "STORAGE_UNAVAILABLE"
              ? "공개 자료를 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
              : "공개된 프로필을 찾을 수 없어요.",
        ),
        error.code === "CURSOR_EXPIRED" ? 409 : error.code === "STORAGE_UNAVAILABLE" ? 503 : 404,
      );
    return c.json(errorBody(c, "DEPENDENCY_UNAVAILABLE", "프로필을 불러오지 못했어요.", true), 503);
  });
  const service = async (env: Env) =>
    createDirectoryService(createV2Core(env.DB, await createCaseDataCipher(env)), options.clock);
  app.get("/", async (c) => c.json(await (await service(c.env)).list(c.req.query())));
  app.get("/self-service", async (c) => {
    const raw = c.req.query();
    const query = v2DirectoryQuerySchema.parse({
      ...raw,
      ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
    });
    const core = createV2Core(c.env.DB, await createCaseDataCipher(c.env));
    return c.json(await createSelfProfileService(core, options.clock).list(query));
  });
  app.get("/self-service/:id/assets/:assetId", async (c) => {
    publicProfileQuerySchema.parse(c.req.query());
    const core = createV2Core(c.env.DB, await createCaseDataCipher(c.env));
    const service = createSelfProfileService(core, options.clock);
    const profile = await service.get(c.req.param("id"));
    const ownerId = await core
      .statement("SELECT owner_id FROM v2_profiles WHERE id=?", [profile.id])
      .first<string>("owner_id");
    if (!ownerId) throw new LawyerError("NOT_FOUND");
    const read = createSelfAssetReader(core, {
      environment: c.env.APP_ENV === "production" ? "production" : "preview",
      bucket: c.env.CASE_PRIVATE_R2,
      ...(options.selfAssetDecoder ? { openSanitized: options.selfAssetDecoder } : {}),
    });
    return selfAssetResponse(
      await read(ownerId, profile, c.req.param("assetId"), async () => {
        try {
          return service.isCurrent(ownerId, profile, true);
        } catch {
          return false;
        }
      }),
    );
  });
  app.get("/self-service/:id", async (c) => {
    publicProfileQuerySchema.parse(c.req.query());
    const core = createV2Core(c.env.DB, await createCaseDataCipher(c.env));
    return c.json(await createSelfProfileService(core, options.clock).get(c.req.param("id")));
  });
  const publicAsset = async (c: Context<ApiEnvironment>) => {
    publicProfileQuerySchema.parse(c.req.query());
    const core = createV2Core(c.env.DB, await createCaseDataCipher(c.env));
    const directory = createDirectoryService(core, options.clock);
    const capacity = createV2StorageCapacityRepository(
      core,
      c.env.APP_ENV === "production" ? "production" : "preview",
    );
    const now = options.clock ?? (() => new Date().toISOString());
    const asset = await readPublicAsset(
      core,
      directory.profile,
      {
        bucket: c.env.PROFILE_PUBLIC_R2,
        admitGet: async (blobId, objectKey) => {
          const permit = await capacity.beforeMaintenanceIO({ blobId, action: "get" }, now());
          return (
            !!permit &&
            permit.objectKey === objectKey &&
            capacity.consumeMaintenanceIO(permit, now())
          );
        },
      },
      z.string().parse(c.req.param("id")),
      z.string().parse(c.req.param("assetId")),
    );
    return new Response(asset.body, {
      headers: {
        "cache-control": "no-store",
        "content-type": asset.type,
        "content-length": String(asset.size),
        "content-disposition":
          asset.kind === "pdf" ? 'attachment; filename="portfolio.pdf"' : "inline",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  };
  app.get("/:id/assets/:assetId", publicAsset);
  app.get("/:id/portfolio/:assetId", publicAsset);
  app.get("/:id", async (c) => {
    publicProfileQuerySchema.parse(c.req.query());
    return c.json(await (await service(c.env)).profile(c.req.param("id")));
  });
  return app;
}
