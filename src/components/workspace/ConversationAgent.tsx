import { AgentView } from "../../product-ui/conversation-tools/AgentView";
import {
  type ConversationAgentProps,
  useConversationAgentController,
} from "../../product-ui/conversation-tools/useConversationAgentController";

export type {
  ConversationClient,
  ConversationPane,
  ConversationPaneProps,
} from "../../product-ui/conversation-tools/useConversationAgentController";

export function ConversationAgent(props: ConversationAgentProps) {
  return <AgentView controller={useConversationAgentController(props)} />;
}
