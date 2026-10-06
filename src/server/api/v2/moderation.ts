import { z } from "zod";
import { lawyerAccess } from "../../auth/roles";
import { createCaseDataCipher } from "../../crypto";
import { createV2Core } from "../../db/v2-core";
import { createLawyerAssetsService } from "../../modules/lawyers/assets";
import { createSubmittedAssetReview } from "../../modules/lawyers/sanitized";
import type { LawyerDependencies } from "../../modules/lawyers/service";
import { createModerationService } from "../../modules/moderation/service";
import { expectedRevisionBody, privateLawyerApi } from "./lawyers";

export function createModerationApi(
  options: { clock?: () => string; dependencies?: (env: Env) => Promise<LawyerDependencies> } = {},
) {
  const app = privateLawyerApi();
  const service = async (env: Env) =>
    createModerationService(
      createV2Core(env.DB, await createCaseDataCipher(env)),
      options.clock ? { clock: options.clock } : {},
    );
  app.get("/profile-revisions/:id/assets/:assetId/content", async (c) => {
    const a = await lawyerAccess(c, { moderator: true });
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    const review = createSubmittedAssetReview(
      createV2Core(c.env.DB, await createCaseDataCipher(c.env)),
      {
        ...(await options.dependencies?.(c.env)),
        ...(options.clock ? { clock: options.clock } : {}),
      },
    );
    const result = await review.open(
      a.ownerId,
      a.sessionId,
      c.req.param("id"),
      c.req.param("assetId"),
    );
    return new Response(result.body, {
      headers: {
        "content-type": result.contentType,
        "content-disposition": "attachment; filename=profile-asset.bin",
        "content-length": String(result.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
  app.get("/applications/:id/verification-assets/:assetId/content", async (c) => {
    const a = await lawyerAccess(c, { moderator: true });
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    const assets = createLawyerAssetsService(
      createV2Core(c.env.DB, await createCaseDataCipher(c.env)),
      {
        ...(await options.dependencies?.(c.env)),
        environment: c.env.APP_ENV === "production" ? "production" : "preview",
      },
    );
    const result = await assets.moderatorOpen(
      a.ownerId,
      a.sessionId,
      c.req.param("id"),
      c.req.param("assetId"),
    );
    return new Response(result.body, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment; filename=verification.bin",
        "content-length": String(result.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
  app.get("/applications", async (c) => {
    const a = await lawyerAccess(c, { moderator: true });
    if (a.response) return a.response;
    return c.json(await (await service(c.env)).applications(a.ownerId, a.sessionId, c.req.query()));
  });
  app.get("/applications/:id", async (c) => {
    const a = await lawyerAccess(c, { moderator: true });
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    return c.json(
      await (await service(c.env)).application(a.ownerId, a.sessionId, c.req.param("id")),
    );
  });
  app.get("/applications/:id/verification-assets/:assetId", async (c) => {
    const a = await lawyerAccess(c, { moderator: true });
    if (a.response) return a.response;
    return c.json(
      await (await service(c.env)).verification(
        a.ownerId,
        a.sessionId,
        c.req.param("id"),
        c.req.param("assetId"),
      ),
    );
  });
  app.post("/applications/:id/decision", async (c) => {
    const a = await lawyerAccess(c, { mutation: true, moderator: true });
    if (a.response) return a.response;
    return c.json(
      await (await service(c.env)).decideApplication(
        a.ownerId,
        a.sessionId,
        c.req.param("id"),
        await c.req.json(),
      ),
    );
  });
  app.post("/applications/:id/revoke", async (c) => {
    const a = await lawyerAccess(c, { mutation: true, moderator: true });
    if (a.response) return a.response;
    const body = expectedRevisionBody.parse(await c.req.json());
    return c.json(
      await (await service(c.env)).revokeVerification(
        a.ownerId,
        a.sessionId,
        c.req.param("id"),
        body.expectedRevision,
      ),
    );
  });
  app.get("/profile-revisions", async (c) => {
    const a = await lawyerAccess(c, { moderator: true });
    if (a.response) return a.response;
    return c.json(await (await service(c.env)).profiles(a.ownerId, a.sessionId, c.req.query()));
  });
  app.get("/profile-revisions/:id", async (c) => {
    const a = await lawyerAccess(c, { moderator: true });
    if (a.response) return a.response;
    return c.json(await (await service(c.env)).profile(a.ownerId, a.sessionId, c.req.param("id")));
  });
  app.post("/profile-revisions/:id/decision", async (c) => {
    const a = await lawyerAccess(c, { mutation: true, moderator: true });
    if (a.response) return a.response;
    return c.json(
      await (await service(c.env)).decideProfile(
        a.ownerId,
        a.sessionId,
        c.req.param("id"),
        await c.req.json(),
      ),
    );
  });
  return app;
}
export const moderationApi = createModerationApi();
