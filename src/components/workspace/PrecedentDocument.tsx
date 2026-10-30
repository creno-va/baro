import { precedentHighlights } from "../../client/precedent-highlights";
import type { V2PrecedentComparison } from "../../contracts/v2/precedent-comparison";
import { precedentDocumentParts } from "../../utils/precedent-document";

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
      {precedentDocumentParts(text).map((part) => {
        const content = comparison
          ? precedentHighlights(comparison, {
              text: part.text,
              startUtf16: startUtf16 + part.start,
            }).map((segment) =>
              segment.metrics.length ? (
                <button
                  key={segment.start}
                  type="button"
                  className="comparison-highlight"
                  onClick={() => onSelect?.(segment.metrics)}
                  aria-label={`${segment.text} · 유사한 이유 보기`}
                >
                  {segment.text}
                </button>
              ) : (
                <span key={segment.start}>{segment.text}</span>
              ),
            )
          : part.text;
        const major = /^(판시사항|판결요지|참조조문|참조판례|전문|주문|이유)$/u.test(
          part.text.replace(/[【】[\]\s]/gu, ""),
        );
        return part.kind === "heading" ? (
          major ? (
            <h4 key={part.start}>{content}</h4>
          ) : (
            <h5 key={part.start}>{content}</h5>
          )
        ) : (
          <p className="precedent-body" key={part.start}>
            {content}
          </p>
        );
      })}
    </div>
  );
}
