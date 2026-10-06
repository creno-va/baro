import { Hono } from "hono";
import { z } from "zod";
import { idempotencyKeySchema, opaqueIdSchema, revisionSchema } from "../../../contracts";
import type { V2ErrorCode } from "../../../contracts/v2";
import { createCaseDataCipher } from "../../crypto";
import { createV2Core, type V2Core } from "../../db/v2-core";
import { ProcessingError } from "../../modules/file-processing/protocol";
import { FileError } from "../../modules/files/binary";
import { createFilesService, type FileServiceDependencies } from "../../modules/files/service";
import { caseAccess } from "../case-access";
import { type ApiEnvironment, errorBody } from "../errors";

export function attachmentFilename(name: string) {
  return `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name.toWellFormed()).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
const deleteSchema = z.strictObject({
  expectedRevision: revisionSchema,
  fileRevision: revisionSchema,
});
const publicFileError: Record<FileError["code"], V2ErrorCode> = {
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "INVALID_STATE",
  BODY_TOO_LARGE: "BODY_TOO_LARGE",
  INVALID_FILE: "FILE_REJECTED",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  PROCESSING_UNAVAILABLE: "FILE_PROCESSING_FAILED",
};
/** Mounted at /v2/cases. Dependencies are server composition, never request fields. */
export function createFilesApi(
  options: {
    dependencies?: (
      env: Env,
      core: V2Core,
      ownerId: string,
    ) => Promise<Omit<FileServiceDependencies, "environment">>;
  } = {},
) {
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
    if (error instanceof ProcessingError)
      return c.json(
        errorBody(c, "FILE_PROCESSING_FAILED", "자료 처리 준비를 확인하고 있어요.", true),
        503,
      );
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return c.json(errorBody(c, "VALIDATION_ERROR", "자료 요청을 확인해 주세요."), 400);
    if (error instanceof FileError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "CONFLICT"
            ? 409
            : error.code === "BODY_TOO_LARGE"
              ? 413
              : error.code === "INVALID_FILE"
                ? 400
                : 503;
      return c.json(
        errorBody(c, publicFileError[error.code], "자료 요청을 처리하지 못했어요.", status === 503),
        status,
      );
    }
    return c.json(errorBody(c, "INTERNAL_ERROR", "자료 요청을 처리하지 못했어요.", true), 500);
  });
  const service = async (env: Env, ownerId: string) => {
    const core = createV2Core(env.DB, await createCaseDataCipher(env));
    return createFilesService(core, {
      ...(await options.dependencies?.(env, core, ownerId)),
      environment: env.APP_ENV === "production" ? "production" : "preview",
    });
  };
  app.get("/:caseId/files", async (c) => {
    const access = await caseAccess(c);
    if (access.response) return access.response;
    const query = z.strictObject({ afterId: opaqueIdSchema.optional() }).parse(c.req.query());
    return c.json(
      await (await service(c.env, access.ownerId)).list(
        access.ownerId,
        c.req.param("caseId"),
        query.afterId,
      ),
    );
  });
  app.post("/:caseId/files", async (c) => {
    const access = await caseAccess(c, true, true);
    if (access.response) return access.response;
    const revision = c.req.header("if-match");
    if (!revision || !/^[1-9]\d*$/.test(revision)) throw new FileError("INVALID_FILE");
    const key = idempotencyKeySchema.parse(c.req.header("idempotency-key"));
    return c.json(
      await (await service(c.env, access.ownerId)).reserve(
        access.ownerId,
        c.req.param("caseId"),
        Number(revision),
        key,
        await c.req.json(),
      ),
      201,
    );
  });
  app.put("/:caseId/files/:fileId/parts/:partNumber", async (c) => {
    const access = await caseAccess(c, true, true);
    if (access.response) {
      await c.req.raw.body?.cancel().catch(() => {});
      return access.response;
    }
    // Validate all routing/auth metadata before acquiring or reading the binary body.
    const number = c.req.param("partNumber");
    if (
      !/^(0|[1-9]\d{0,2})$/.test(number) ||
      c.req.header("content-type")?.split(";")[0] !== "application/octet-stream"
    )
      throw new FileError("INVALID_FILE");
    const uploadId = opaqueIdSchema.parse(c.req.header("x-upload-session"));
    return c.json(
      await (await service(c.env, access.ownerId)).putPart(
        access.ownerId,
        c.req.param("caseId"),
        c.req.param("fileId"),
        uploadId,
        Number(number),
        c.req.raw.body,
      ),
    );
  });
  app.post("/:caseId/files/:fileId/complete", async (c) => {
    const access = await caseAccess(c, true, true);
    if (access.response) return access.response;
    return c.json(
      await (await service(c.env, access.ownerId)).complete(
        access.ownerId,
        c.req.param("caseId"),
        c.req.param("fileId"),
        await c.req.json(),
      ),
    );
  });
  app.get("/:caseId/files/:fileId/content", async (c) => {
    const access = await caseAccess(c);
    if (access.response) return access.response;
    z.strictObject({}).parse(c.req.query());
    const result = await (await service(c.env, access.ownerId)).content(
      access.ownerId,
      c.req.param("caseId"),
      c.req.param("fileId"),
    );
    return new Response(result.body, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": attachmentFilename(result.name),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-length": String(result.byteLength),
      },
    });
  });
  app.delete("/:caseId/files/:fileId", async (c) => {
    const access = await caseAccess(c, true);
    if (access.response) return access.response;
    const body = deleteSchema.parse(await c.req.json());
    return c.json(
      await (await service(c.env, access.ownerId)).remove(
        access.ownerId,
        c.req.param("caseId"),
        c.req.param("fileId"),
        body.expectedRevision,
        body.fileRevision,
      ),
      202,
    );
  });
  return app;
}
export const filesApi = createFilesApi();
