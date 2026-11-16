import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { ContextReviewView } from "../../product-ui/summary/ContextReviewView";
import {
  type ConversationContextReviewProps,
  useContextReviewController,
} from "../../product-ui/summary/useContextReviewController";

export function ConversationContextReview(props: ConversationContextReviewProps) {
  const controller = useContextReviewController(props);
  return (
    <GlobalProductTheme>
      <ContextReviewView controller={controller} />
    </GlobalProductTheme>
  );
}
