import { Hono } from "hono";
import { idempotencyKeySchema, opaqueIdSchema } from "../../../contracts";
import { deleteWorkspace, WorkspaceDeletionError } from "../../modules/deletion/workspace";
import { caseAccess } from "../case-access";
import { type ApiEnvironment, errorBody } from "../errors";
/** A mounts this domain at /api/v2/cases. Legacy /api/cases deletion remains intact. */
export const workspaceDeleteApi = new Hono<ApiEnvironment>().delete("/:caseId", async (c) => {
  c.header("cache-control", "private, no-store");
  if (c.env.APP_ENV === "production" && c.env.PUBLIC_BETA_ENABLED !== "true")
    return c.json(errorBody(c, "BETA_NOT_OPEN", "공개 베타를 준비하고 있어요."), 503);
  const access = await caseAccess(c, true);
  if (access.response) return access.response;
  const id = opaqueIdSchema.safeParse(c.req.param("caseId"));
  const key = idempotencyKeySchema.safeParse(c.req.header("idempotency-key"));
  if (!id.success) return c.json(errorBody(c, "NOT_FOUND", "사건을 찾을 수 없어요."), 404);
  if (!key.success || (await c.req.text()).trim() || Object.keys(c.req.query()).length)
    return c.json(errorBody(c, "VALIDATION_ERROR", "삭제 요청을 확인해 주세요."), 400);
  try {
    await deleteWorkspace(c.env.DB, access.ownerId, id.data, key.data);
    return c.json({ status: "accepted" as const }, 202);
  } catch (error) {
    if (error instanceof WorkspaceDeletionError)
      return c.json(
        errorBody(
          c,
          error.code,
          error.code === "NOT_FOUND" ? "사건을 찾을 수 없어요." : "다른 요청에 사용된 작업 키예요.",
        ),
        error.code === "NOT_FOUND" ? 404 : 409,
      );
    throw error;
  }
});
