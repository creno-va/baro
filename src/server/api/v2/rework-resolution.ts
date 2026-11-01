import { Hono } from "hono";
import { z } from "zod";
import { idempotencyKeySchema, opaqueIdSchema } from "../../../contracts";
import {
  type V2ResolutionDraftRequest,
  type V2ResolutionMutation,
  type V2ResolutionState,
  v2ResolutionDraftRequestSchema,
  v2ResolutionMutationSchema,
  v2ResolutionStateForGuidesSchema,
} from "../../../contracts/v2/resolution";
import { GUIDE_HOSTS } from "../../modules/legal-retrieval/v2/registry";
import { caseAccess } from "../case-access";
import type { ApiEnvironment } from "../errors";

export interface ReworkResolutionRuntime {
  get(ownerId: string, caseId: string): Promise<V2ResolutionState>;
  update(
    ownerId: string,
    caseId: string,
    key: string,
    input: V2ResolutionMutation,
  ): Promise<V2ResolutionState>;
  draft(
    ownerId: string,
    caseId: string,
    key: string,
    input: V2ResolutionDraftRequest,
  ): Promise<V2ResolutionState>;
}
export interface ReworkResolutionApiOptions {
  /** Central factory retains current case ownership, source authority, CAS and
   * atomic idempotency receipts. A signed session alone never grants case access. */
  runtime(env: Env, ownerId: string, sessionId: string): Promise<ReworkResolutionRuntime>;
}

/** Mount under the central rework API's private/no-store, public gate and error
 * middleware. No model/retrieval/storage/receipt work occurs in this child. */
export function createReworkResolutionApi(options: ReworkResolutionApiOptions) {
  const app = new Hono<ApiEnvironment>();
  const response = v2ResolutionStateForGuidesSchema(GUIDE_HOSTS);
  const emptyQuery = z.strictObject({});
  app.get("/:id/rework/resolution", async (c) => {
    const access = await caseAccess(c);
    if (access.response) return access.response;
    emptyQuery.parse(c.req.query());
    const id = opaqueIdSchema.parse(c.req.param("id"));
    const runtime = await options.runtime(c.env, access.ownerId, access.sessionId);
    return c.json(response.parse(await runtime.get(access.ownerId, id)));
  });
  app.patch("/:id/rework/resolution", async (c) => {
    const access = await caseAccess(c, true, true, true, { customerConsentSnapshot: true });
    if (access.response) return access.response;
    emptyQuery.parse(c.req.query());
    const id = opaqueIdSchema.parse(c.req.param("id"));
    const key = idempotencyKeySchema.parse(c.req.header("idempotency-key"));
    const input = v2ResolutionMutationSchema.parse(await c.req.json());
    const runtime = await options.runtime(c.env, access.ownerId, access.sessionId);
    return c.json(response.parse(await runtime.update(access.ownerId, id, key, input)));
  });
  app.post("/:id/rework/resolution/draft", async (c) => {
    const access = await caseAccess(c, true, true, true, { customerConsentSnapshot: true });
    if (access.response) return access.response;
    emptyQuery.parse(c.req.query());
    const id = opaqueIdSchema.parse(c.req.param("id"));
    const key = idempotencyKeySchema.parse(c.req.header("idempotency-key"));
    const input = v2ResolutionDraftRequestSchema.parse(await c.req.json());
    const runtime = await options.runtime(c.env, access.ownerId, access.sessionId);
    return c.json(response.parse(await runtime.draft(access.ownerId, id, key, input)));
  });
  return app;
}
