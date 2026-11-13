import { precedentHighlights } from "../../client/precedent-highlights";
import type { V2PrecedentComparison } from "../../contracts/v2/precedent-comparison";
import { precedentDisplayParts } from "../../utils/precedent-document";
import { ActionButton as ControlButton } from "../ui/button";

export function PrecedentDocument({
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
    <div className="precedent-full-text">
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
                  className="comparison-highlight"
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
