import { ProgressiveReplyView } from "../../product-ui/conversation-tools/ProgressiveReplyView";
import { useProgressiveReplyController } from "../../product-ui/conversation-tools/useProgressiveReplyController";

/** Presentation of an already validated, durably published answer. */
export function ProgressiveReply(props: Parameters<typeof useProgressiveReplyController>[0]) {
  return <ProgressiveReplyView {...useProgressiveReplyController(props)} />;
}
