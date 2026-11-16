import { ChatAttachmentsView } from "../../product-ui/evidence/ChatAttachmentsView";
import {
  type ChatAttachmentsProps,
  useChatAttachmentsController,
} from "../../product-ui/evidence/useChatAttachmentsController";
import { GlobalProductTheme } from "../../product-ui/GlobalTheme";

export function ChatAttachments(props: ChatAttachmentsProps) {
  const controller = useChatAttachmentsController(props);
  if (!props.local.length && !props.uploaded.length) return null;
  return (
    <GlobalProductTheme className="contents">
      <ChatAttachmentsView controller={controller} />
    </GlobalProductTheme>
  );
}
