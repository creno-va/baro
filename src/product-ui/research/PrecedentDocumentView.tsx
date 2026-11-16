import { precedentHighlights } from "../../client/precedent-highlights";
import type { V2PrecedentComparison } from "../../contracts/v2/precedent-comparison";
import { precedentDisplayParts } from "../../utils/precedent-document";
import { Button as ControlButton } from "../Button";

export function PrecedentDocumentView({
  text,
  startUtf16 = 0,
  comparison,
  onSelect,
}: {
  text: string;
  startUtf16?: number;
  comparison?: V2PrecedentComparison | undefined;
  onSelect?: ((metrics: number[]) => void) | undefined;
}) {
  return (
    <div
      data-product-precedent-document=""
      className="min-w-0 space-y-4 text-sm leading-7 text-[var(--pui-text)] [overflow-wrap:anywhere] [&_h4]:pt-3 [&_h4]:font-semibold [&_h4]:text-base [&_p]:whitespace-pre-wrap [&_p]:leading-7"
    >
      {precedentDisplayParts(text).map((part) => {
        const content = comparison
          ? precedentHighlights(comparison, {
              text: part.text,
              startUtf16: startUtf16 + part.start,
            }).map((segment) =>
              segment.metrics.length ? (
                <ControlButton
                  key={segment.start}
                  type="button"
                  data-product-comparison-highlight=""
                  variant="ghost"
                  className="inline min-h-0 whitespace-pre-wrap rounded-sm border-0 bg-[var(--pui-background)] p-0 text-left [font:inherit] text-[var(--pui-focus)] underline decoration-[var(--pui-focus)]/40 underline-offset-4"
                  onClick={() => onSelect?.(segment.metrics)}
                  aria-label={`${segment.text} · 유사한 이유 보기`}
                >
                  {segment.text}
                </ControlButton>
              ) : (
                <span key={segment.start}>{segment.text}</span>
              ),
            )
          : part.text;
        return part.kind === "heading" ? (
          <h4 key={part.start}>{content}</h4>
        ) : (
          <p className="precedent-body" key={part.start}>
            {content}
          </p>
        );
      })}
    </div>
  );
}
