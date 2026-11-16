import { PanelView } from "../../product-ui/conversation-tools/PanelView";
import {
  type PanelProps,
  useConversationPanelController,
} from "../../product-ui/conversation-tools/useConversationPanelController";

export function ConversationPanel(props: PanelProps) {
  return <PanelView {...useConversationPanelController(props)} />;
}
