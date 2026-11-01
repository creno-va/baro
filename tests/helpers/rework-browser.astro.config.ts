import base from "../../astro.config";

// Actual application routes and real authenticated client; no component/API alias.
if (process.env.PUBLIC_API_MODE !== "real" || process.env.BARO_UI_TEST_FIXTURE !== "true")
  throw new Error("REWORK_BROWSER_REQUIRES_EXPLICIT_REAL_CLIENT_FIXTURE");
export default base;
