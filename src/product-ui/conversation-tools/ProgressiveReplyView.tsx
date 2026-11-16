import { ChevronsDown } from "lucide-react";
import { Button } from "../Button";
import { MessageView } from "./MessageView";

export function ProgressiveReplyView({
  text,
  typing,
  showAll,
}: {
  text: string;
  typing: boolean;
  showAll: () => void;
}) {
  return (
    <div data-product-progressive-reply="" className="min-w-0 space-y-2">
      {typing && (
        <Button data-product-reply-skip="" size="sm" variant="ghost" onClick={showAll}>
          <ChevronsDown size={15} aria-hidden="true" />
          답변 전체 바로 보기
        </Button>
      )}
      <MessageView text={text} revealing={typing} />
    </div>
  );
}
