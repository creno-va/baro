import { limitedConversationState } from "./conversation-state";

// The Astro report page opts into passive rework reads. Keep the same draft,
// generation and PDF assertions in both the real page and isolated harness.
export async function preparationRead(route: import("@playwright/test").Route) {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith("/rework/conversation")) {
    await route.fulfill({ json: limitedConversationState() });
    return true;
  }
  if (path.endsWith("/rework/resolution")) {
    await route.fulfill({
      json: {
        contractVersion: "conversation-report-v1",
        revision: 1,
        basis: null,
        selection: null,
        selectedFileIds: [],
        maskIdentifiers: true,
        status: "not_ready",
        draft: null,
        procedureChecks: [],
        weaknessChecks: [],
        consultationPreparation: [],
        citations: [],
        sourceClaims: [],
        allowedDocumentKinds: ["fact_statement"],
      },
    });
    return true;
  }
  return false;
}
