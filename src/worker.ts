import { cf } from "@astrojs/cloudflare/hono";
import { actions, i18n, middleware, pages } from "astro/hono";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { api } from "./server/api";
import { cleanupAuthData } from "./server/auth/cleanup";
import { reconcileAnalysisTimeouts } from "./server/modules/case-structure/execution";
import { reconcileDeletion } from "./server/modules/deletion/service";
import { reconcileDispatch } from "./server/modules/dispatch/service";
import { reconcileFileUploads } from "./server/modules/files/reconcile";

export { AnalysisWorkflow } from "./workflows/analysis";
export { FileProcessorContainer } from "./workflows/file-processor-container";

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
app.use(actions());
app.use(middleware());
app.use(pages());
app.use(i18n());

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await reconcileDeletion(env);
    await cleanupAuthData(env.DB);
    await reconcileDispatch(env);
    await reconcileAnalysisTimeouts(env);
    await reconcileFileUploads(env);
  },
};
