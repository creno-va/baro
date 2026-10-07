/** Deployment builds always preview intake; isolated full-feature tests retain their coverage.
 * PUBLIC_PREVIEW_TEST opts the synthetic browser into the same disabled UI as production.
 * BARO_UI_TEST_FIXTURE is build-time only and already forbidden in deployment builds.
 */
export const PUBLIC_PREVIEW =
  !import.meta.env.BARO_UI_TEST_FIXTURE || import.meta.env.PUBLIC_PREVIEW_TEST === "true";
