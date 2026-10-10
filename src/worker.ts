import { cf } from "@astrojs/cloudflare/hono";
import { actions, i18n, middleware, pages } from "astro/hono";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { api } from "./server/api";
import { cleanupAuthData } from "./server/auth/cleanup";
import { createPageAccess } from "./server/auth/page-access";
import { cleanupExpiredDirectorySnapshots } from "./server/db/v2-directory-cleanup";
import { reconcileAnalysisTimeouts } from "./server/modules/case-structure/execution";
import { reconcileDeletion } from "./server/modules/deletion/service";
import { reconcileV2Deletion } from "./server/modules/deletion/v2-reconcile";
import { reconcileDispatch } from "./server/modules/dispatch/service";
import { reconcileFileUploads } from "./server/modules/files/reconcile";
import { reconcileV2Dispatch } from "./server/runtime/dispatch";

export { AnalysisWorkflow } from "./workflows/analysis";
export { AssetProcessingWorkflow } from "./workflows/asset-processing";
export { FileProcessingWorkflow } from "./workflows/file-processing";
export { FileProcessorContainer } from "./workflows/file-processor-container";
export { ProfilePublicationWorkflow } from "./workflows/profile-publication";
export { WorkspaceWorkflow } from "./workflows/workspace";

const app = new Hono<{ Bindings: Env }>();

app.use(cf());
app.use(
  secureHeaders({
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: "DENY",
  }),
);
// Astro SSR supplies per-response script/style hashes. Preserve that policy.
app.use(async (context, next) => {
  await next();
  const policy = context.res.headers.get("content-security-policy");
  context.header("content-security-policy", `${policy ? `${policy}; ` : ""}frame-ancestors 'none'`);
});
app.route("/api", api);
app.use(createPageAccess({ syntheticFixture: import.meta.env.BARO_UI_TEST_FIXTURE === true }));
app.use(actions());
app.use(middleware());
app.use(pages());
app.use(i18n());

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await reconcileDeletion(env);
    await cleanupAuthData(env.DB);
    await cleanupExpiredDirectorySnapshots(env.DB);
    await reconcileDispatch(env);
    await reconcileAnalysisTimeouts(env);
    await reconcileFileUploads(env);
    await reconcileV2Dispatch(env);
    await reconcileV2Deletion(env);
  },
};
