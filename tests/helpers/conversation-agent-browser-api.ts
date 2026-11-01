import type { SessionView } from "../../src/client/api/types";
import type { V2ConversationActionRequest, V2ConversationIntent } from "../../src/contracts/v2";

export type ConversationFixtureControl = {
  calls: V2ConversationActionRequest[];
  delay: boolean;
  fail: boolean;
  failureCode: string;
  resolve: (() => void) | null;
  aborted: boolean;
  needsConsent: boolean;
  withdrawConsent: () => void;
  emitIntent: (intent: V2ConversationIntent, revision?: number) => void;
  advanceWorkspace: () => void;
  catchUpState: () => void;
};
declare global {
  interface Window {
    conversationFixture: ConversationFixtureControl;
  }
}

export const browserSession = (): SessionView => ({
  user: { id: "synthetic-owner", name: "합성 사용자", accountType: "customer" },
  needsConsent: typeof window !== "undefined" && !!window.conversationFixture?.needsConsent,
});
export const api = { session: { get: async () => browserSession() } };
