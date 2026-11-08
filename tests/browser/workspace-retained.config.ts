import base from "./workspace-materials.config";

export default {
  ...base,
  testMatch: "workspace-retained.e2e.ts",
  outputDir: "../../.wrangler/flow02-retained",
};
