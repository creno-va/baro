import { cf } from "@astrojs/cloudflare/hono";
import { actions, i18n, middleware, pages } from "astro/hono";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { api } from "./server/api";

export { AnalysisWorkflow } from "./workflows/analysis";

const app = new Hono<{ Bindings: Env }>();

app.use(cf());
app.use(
  secureHeaders({
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: "DENY",
  }),
);
app.route("/api", api);
app.use(actions());
app.use(middleware());
app.use(pages());
app.use(i18n());

export default app;
