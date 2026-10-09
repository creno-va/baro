import { Hono } from "hono";
import { z } from "zod";
import { idempotencyKeySchema, opaqueIdSchema, revisionSchema } from "../../../contracts";
import type { V2ErrorCode } from "../../../contracts/v2";
import { createCaseDataCipher } from "../../crypto";
import { createV2Core, type V2Core } from "../../db/v2-core";
import { ProcessingError } from "../../modules/file-processing/protocol";
import { createFileRetry } from "../../modules/file-processing/retry";
import { FileError } from "../../modules/files/binary";
import { createFileReviewService, FileReviewError } from "../../modules/files/review";
import { createFilesService, type FileServiceDependencies } from "../../modules/files/service";
import { readWorkspaceFile } from "../../modules/files/workspace-read";
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
    if (error instanceof FileReviewError) {
      const status =
        error.code === "NOT_FOUND" ? 404 : error.code === "CONSENT_REQUIRED" ? 403 : 409;
      return c.json(
        errorBody(
          c,
          error.code,
          error.code === "CONSENT_REQUIRED"
            ? "현재 필수 동의 후 교정을 저장할 수 있어요. 기존 자료 조회와 삭제는 가능해요."
            : "자료가 변경됐어요. 다시 불러온 뒤 저장해 주세요.",
        ),
        status,
      );
    }
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
    const core = createV2Core(env.DB, await createCaseDataCipher(env), {
      monthlyBudgetCapEnabled: env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
    });
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
  app.get("/:caseId/files/:fileId/upload-session", async (c) => {
    const access = await caseAccess(c, false, true);
    if (access.response) return access.response;
    z.strictObject({}).parse(c.req.query());
    return c.json(
      await (await service(c.env, access.ownerId)).resumeUpload(
        access.ownerId,
        c.req.param("caseId"),
        c.req.param("fileId"),
      ),
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
  app.post("/:caseId/files/:fileId/retry", async (c) => {
    const access = await caseAccess(c, true, true);
    if (access.response) return access.response;
    const core = createV2Core(c.env.DB, await createCaseDataCipher(c.env), {
      monthlyBudgetCapEnabled: c.env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
    });
    const deps = (await options.dependencies?.(c.env, core, access.ownerId)) ?? {};
    return c.json(
      await createFileRetry(core, c.env, deps)(
        access.ownerId,
        c.req.param("caseId"),
        c.req.param("fileId"),
        await c.req.json(),
      ),
      202,
    );
  });
  const review = async (env: Env) =>
    createFileReviewService(createV2Core(env.DB, await createCaseDataCipher(env)));
  app.get("/:caseId/files/:fileId/review", async (c) => {
    const access = await caseAccess(c);
    if (access.response) return access.response;
    const query = z
      .strictObject({ afterOrdinal: z.coerce.number().int().min(-1).max(9999).optional() })
      .parse(c.req.query());
    return c.json(
      await (await review(c.env)).read(
        access.ownerId,
        c.req.param("caseId"),
        c.req.param("fileId"),
        query.afterOrdinal,
      ),
    );
  });
  app.patch("/:caseId/files/:fileId/observations", async (c) => {
    const access = await caseAccess(c, true, true);
    if (access.response) return access.response;
    const revision = z.coerce.number().int().positive().parse(c.req.header("if-match"));
    const result = await (await review(c.env)).start(
      access.ownerId,
      c.req.param("caseId"),
      c.req.param("fileId"),
      revision,
      idempotencyKeySchema.parse(c.req.header("idempotency-key")),
      await c.req.json(),
    );
    return c.json(result, result.status === "ready" ? 200 : 202);
  });
  app.post("/:caseId/files/:fileId/observations/:reviewId/continue", async (c) => {
    const access = await caseAccess(c, true, true);
    if (access.response) return access.response;
    const result = await (await review(c.env)).advance(
      access.ownerId,
      c.req.param("caseId"),
      c.req.param("fileId"),
      c.req.param("reviewId"),
    );
    return c.json(result, result.status === "ready" ? 200 : 202);
  });
  app.delete("/:caseId/files/:fileId/observations/:reviewId", async (c) => {
    const access = await caseAccess(c, true);
    if (access.response) return access.response;
    return c.json(
      await (await review(c.env)).cancel(
        access.ownerId,
        c.req.param("caseId"),
        c.req.param("fileId"),
        c.req.param("reviewId"),
      ),
    );
  });
  app.get("/:caseId/files/:fileId", async (c) => {
    const access = await caseAccess(c);
    if (access.response) return access.response;
    z.strictObject({}).parse(c.req.query());
    const core = createV2Core(c.env.DB, await createCaseDataCipher(c.env), {
      monthlyBudgetCapEnabled: c.env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
    });
    return c.json(
      await readWorkspaceFile(core, access.ownerId, c.req.param("caseId"), c.req.param("fileId")),
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
