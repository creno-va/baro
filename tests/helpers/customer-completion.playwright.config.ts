import base from "./workspace.shared.playwright.config";
export default {
  ...base,
  use: { ...base.use, actionTimeout: 8000 },
  testMatch: ["customer-completion.e2e.ts", "workspace-shared.e2e.ts"],
};
