import { Hono } from "hono";
import { z } from "zod";
import { idempotencyKeySchema, opaqueIdSchema } from "../../../contracts";
import { createCaseDataCipher } from "../../crypto";
import { createV2Core, type V2Core, V2RepositoryError } from "../../db/v2-core";
import { reportRequestCore } from "../../modules/reports/limits";
import { createReportDependencies } from "../../modules/reports/runtime";
import { createReportsService } from "../../modules/reports/service";
import { ReportError } from "../../modules/reports/source";
import type { ReportDependencies } from "../../modules/reports/storage";
import { caseAccess } from "../case-access";
import { type ApiEnvironment, errorBody } from "../errors";
import { attachmentFilename } from "./files";

/** Mount once at /v2. Same client facade, real SQL/crypto/R2/streams. */
export function createReportsApi(
  options: {
    dependencies?: (env: Env, core: V2Core, ownerId: string) => Promise<ReportDependencies>;
    /** Explicit offline SQLite adapter only; native D1 must supply billing metadata. */
    testOnlyMissingD1Meta?: true;
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
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      (error instanceof V2RepositoryError && error.code === "REPOSITORY_INPUT_INVALID")
    )
      return c.json(
        errorBody(c, "VALIDATION_ERROR", "리포트 입력과 선택한 자료를 확인해 주세요."),
        400,
      );
    if (error instanceof ReportError) {
      const messages = {
        CONSENT_REQUIRED:
          "현재 필수 동의 후 새 리포트를 만들 수 있어요. 저장된 리포트와 PDF는 계속 확인할 수 있어요.",
        NOT_FOUND: "리포트를 찾을 수 없거나 접근할 수 없어요.",
        STALE_REVISION: "사건이나 검토 버전이 변경됐어요. 다시 불러오거나 새 버전을 만들어 주세요.",
        EDITS_REQUIRE_SAVE:
          "본문 편집을 먼저 저장한 뒤 자료 제외를 적용해 주세요. 입력한 내용은 아직 저장되지 않았어요.",
        EXPORT_RETRY_EXHAUSTED:
          "이 다운로드의 재시도 횟수를 모두 사용했어요. 검토 내용을 새 버전으로 저장한 뒤 다시 다운로드해 주세요. 기존 내용은 보존돼요.",
        REVIEW_REQUIRED: "현재 사건 요약을 확인한 뒤 리포트를 만들어 주세요.",
        VALIDATION_ERROR:
          "내용·제외 자료·원본 선택을 확인해 주세요. 원본이 많거나 크면 나눠 다운로드해 주세요.",
        STORAGE_UNAVAILABLE:
          "다운로드를 완료하지 못했어요. 저장한 검토 내용은 보존돼요. 다시 시도해 주세요.",
        BUDGET_UNAVAILABLE:
          "다운로드 저장을 지금 시작할 수 없어요. 검토 내용은 보존돼요. 잠시 후 다시 확인해 주세요.",
        USER_QUOTA_EXCEEDED:
          "저장 공간이 부족해요. 보관한 자료나 사건을 정리한 뒤 다시 시도해 주세요.",
        IDEMPOTENCY_CONFLICT: "다른 입력에 사용된 요청이에요. 최신 내용을 다시 확인해 주세요.",
        LEGAL_SOURCE_UNAVAILABLE:
          "리포트에 쓰인 공식 출처를 현재 검증할 수 없어요. 출처를 다시 확인한 뒤 새 버전을 만들어 주세요.",
        EXPORT_LIMIT_EXCEEDED:
          "리포트 또는 다운로드 처리 한도를 넘었어요. 리포트에서 자료를 제외하거나 ZIP 원본 선택을 줄여 주세요.",
      };
      const status =
        error.code === "CONSENT_REQUIRED"
          ? 403
          : error.code === "NOT_FOUND"
            ? 404
            : error.code === "EXPORT_LIMIT_EXCEEDED"
              ? 413
              : error.code === "VALIDATION_ERROR"
                ? 400
                : error.code === "USER_QUOTA_EXCEEDED"
                  ? 429
                  : [
                        "BUDGET_UNAVAILABLE",
                        "STORAGE_UNAVAILABLE",
                        "LEGAL_SOURCE_UNAVAILABLE",
                      ].includes(error.code)
                    ? 503
                    : 409;
      return c.json(errorBody(c, error.code, messages[error.code], status === 503), status);
    }
    return c.json(
      errorBody(
        c,
        "DEPENDENCY_UNAVAILABLE",
        "리포트를 확인하지 못했어요. 다시 시도해 주세요.",
        true,
      ),
      503,
    );
  });
  const service = async (env: Env, ownerId: string, sessionId: string) => {
    if (options.testOnlyMissingD1Meta && env.APP_ENV !== "preview")
      throw new ReportError("STORAGE_UNAVAILABLE");
    const core = reportRequestCore(
      createV2Core(env.DB, await createCaseDataCipher(env), {
        monthlyBudgetCapEnabled: env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
      }),
      !options.testOnlyMissingD1Meta,
    );
    return createReportsService(core, {
      ...((await options.dependencies?.(env, core, ownerId)) ??
        createReportDependencies(env, core, ownerId)),
      sessionId,
    });
  };
  app.get("/cases/:caseId/reports", async (c) => {
    const access = await caseAccess(c);
    if (access.response) return access.response;
    z.strictObject({}).parse(c.req.query());
    return c.json(
      await (await service(c.env, access.ownerId, access.sessionId)).get(
        access.ownerId,
        c.req.param("caseId"),
      ),
    );
  });
  app.patch("/cases/:caseId/reports", async (c) => {
    const access = await caseAccess(c, true, true);
    if (access.response) return access.response;
    return c.json(
      await (await service(c.env, access.ownerId, access.sessionId)).save(
        access.ownerId,
        c.req.param("caseId"),
        idempotencyKeySchema.parse(c.req.header("idempotency-key")),
        await c.req.json(),
      ),
    );
  });
  app.post("/cases/:caseId/reports", async (c) => {
    const access = await caseAccess(c, true, true);
    if (access.response) return access.response;
    return c.json(
      await (await service(c.env, access.ownerId, access.sessionId)).generate(
        access.ownerId,
        c.req.param("caseId"),
        idempotencyKeySchema.parse(c.req.header("idempotency-key")),
        await c.req.json(),
      ),
      201,
    );
  });
  app.get("/reports/:reportId/html", async (c) => {
    const access = await caseAccess(c);
    if (access.response) return access.response;
    z.strictObject({}).parse(c.req.query());
    const id = opaqueIdSchema.parse(c.req.param("reportId"));
    const document = await (await service(c.env, access.ownerId, access.sessionId)).html(
      access.ownerId,
      id,
    );
    return new Response(document, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": attachmentFilename(`BARO-${id}.html`),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy":
          "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      },
    });
  });
  app.get("/reports/:reportId/pdf", async (c) => {
    const access = await caseAccess(c);
    if (access.response) return access.response;
    z.strictObject({}).parse(c.req.query());
    const id = opaqueIdSchema.parse(c.req.param("reportId")),
      result = await (await service(c.env, access.ownerId, access.sessionId)).pdf(
        access.ownerId,
        id,
      );
    return new Response(result.body, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": attachmentFilename(`BARO-${id}.pdf`),
        "content-length": String(result.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
  app.get("/reports/:reportId/zip", async (c) => {
    const access = await caseAccess(c);
    if (access.response) return access.response;
    z.strictObject({}).parse(c.req.query());
    const id = opaqueIdSchema.parse(c.req.param("reportId")),
      result = await (await service(c.env, access.ownerId, access.sessionId)).savedZip(
        access.ownerId,
        id,
      );
    return new Response(result.body, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": attachmentFilename(`BARO-${id}.zip`),
        "content-length": String(result.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
  app.post("/reports/:reportId/zip", async (c) => {
    const access = await caseAccess(c, true, true);
    if (access.response) return access.response;
    const { selectedFileIds } = z
      .strictObject({
        selectedFileIds: z
          .array(opaqueIdSchema)
          .min(1)
          .max(100)
          .refine((ids) => new Set(ids).size === ids.length),
      })
      .parse(await c.req.json());
    const id = opaqueIdSchema.parse(c.req.param("reportId")),
      result = await (await service(c.env, access.ownerId, access.sessionId)).zip(
        access.ownerId,
        id,
        idempotencyKeySchema.parse(c.req.header("idempotency-key")),
        selectedFileIds,
      );
    return new Response(result.body, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": attachmentFilename(`BARO-${id}.zip`),
        "content-length": String(result.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
  return app;
}
export const reportsApi = createReportsApi();
