import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import conversation from "./helpers/conversation-agent.astro.config";
import reconfirmation from "./helpers/intake-reconfirmation.astro.config";
import workspace from "./helpers/workspace.astro.config";

type FixtureConfig = { vite: { plugins: unknown[] } };
function resolver(config: FixtureConfig, name: string) {
  const plugin = config.vite.plugins.find(
    (value) =>
      typeof value === "object" && value !== null && "name" in value && value.name === name,
  ) as { resolveId(source: string, importer?: string): string | null } | undefined;
  if (!plugin) throw new Error(`MISSING_SYNTHETIC_RESOLVER:${name}`);
  return (source: string, importer?: string) => plugin.resolveId(source, importer);
}
const source = "../../client/api";
const importer = (path: string) => `/synthetic/baro/src/${path}`;
const fixture = (name: string) => fileURLToPath(new URL(`./helpers/${name}`, import.meta.url));

describe("moved UI controllers retain the exact isolated API composition", () => {
  test("conversation routes only its actual owning controller to the existing session fixture", () => {
    const resolve = resolver(conversation, "isolated-conversation-session");
    expect(
      resolve(source, importer("product-ui/conversation-tools/useConversationAgentController.ts")),
    ).toBe(fixture("conversation-agent-browser-api.ts"));
    for (const path of [
      "components/workspace/ConversationAgent.tsx",
      "product-ui/conversation-tools/AgentView.tsx",
      "product-ui/account/useAccountSettingsController.ts",
      "server/modules/workspace/state.ts",
    ])
      expect(resolve(source, importer(path))).toBeNull();
    expect(resolve(source)).toBeNull();
    expect(
      resolve(
        "../client/api",
        importer("product-ui/conversation-tools/useConversationAgentController.ts"),
      ),
    ).toBeNull();
  });

  test("workspace retains its original subjects while moving only Agent and FileReview owners", () => {
    const resolve = resolver(workspace, "isolated-workspace-contract-facade");
    for (const path of [
      "components/workspace/Workspace.tsx",
      "components/workspace/useEvidenceUpload.ts",
      "components/workspace/LookupDialog.tsx",
      "components/intake/useCustomerAccess.ts",
      "product-ui/conversation-tools/useConversationAgentController.ts",
      "product-ui/materials/useFileReviewController.ts",
    ])
      expect(resolve(source, importer(path))).toBe(fixture("workspace-client-fixture.ts"));
    for (const path of [
      "components/workspace/ConversationAgent.tsx",
      "components/workspace/FileReview.tsx",
      "product-ui/materials/FileReviewView.tsx",
      "product-ui/account/useAccountSettingsController.ts",
    ])
      expect(resolve(source, importer(path))).toBeNull();
    expect(resolve(source)).toBeNull();
  });

  test("intake keeps prior access checks and the three moved intake/summary controllers", () => {
    const resolve = resolver(reconfirmation, "isolated-intake-reconfirmation-facade");
    for (const path of [
      "components/intake/useCustomerAccess.ts",
      "product-ui/intake/useCaseInputController.ts",
      "product-ui/intake/useQuestionsController.ts",
      "product-ui/summary/useSummaryReconfirmationController.ts",
    ])
      expect(resolve(source, importer(path))).toBe(fixture("intake-rework-client-fixture.ts"));
    for (const path of [
      "product-ui/intake/QuestionsView.tsx",
      "product-ui/summary/SummaryReconfirmationView.tsx",
      "product-ui/summary/useContextReviewController.ts",
      "server/modules/cases/repository.ts",
    ])
      expect(resolve(source, importer(path))).toBeNull();
    expect(resolve(source)).toBeNull();
    expect(
      resolve("../../client/api/core", importer("product-ui/intake/useQuestionsController.ts")),
    ).toBeNull();
  });
});
