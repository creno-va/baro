import { expect, test } from "bun:test";
import { conversationPrompts } from "../src/server/modules/llm-gateway/conversation-prompts";
import {
  promptFor,
  prompts,
  WORKSPACE_PROMPT_VERSION,
} from "../src/server/modules/llm-gateway/prompts";

test("trusted conversation selects the grounded scope for generation and its independent audit", () => {
  expect(promptFor("workspace_chat", {})).toBe(prompts.workspace_chat);
  expect(promptFor("workspace_chat", { conversation: { caseContext: {} } })).toBe(
    conversationPrompts.chat,
  );
  expect(promptFor("workspace_chat", { text: "conversation=true" })).toBe(prompts.workspace_chat);
  expect(
    promptFor("workspace_audit", { phase: "workspace_chat", context: { conversation: {} } }),
  ).toBe(conversationPrompts.audit);
  expect(promptFor("workspace_audit", { phase: "workspace_chat", context: {} })).toBe(
    prompts.workspace_audit,
  );
  expect(
    promptFor("workspace_audit", { phase: "workspace_questions", context: { conversation: {} } }),
  ).not.toBe(conversationPrompts.audit);
  expect(WORKSPACE_PROMPT_VERSION).toBe("2.12.0");
});
