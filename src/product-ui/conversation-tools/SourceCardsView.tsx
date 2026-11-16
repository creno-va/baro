import { ArrowUpRight, BookOpen } from "lucide-react";

/** Published citation fields remain the complete source of this read-only view. */
export function SourceCardsView({
  citations,
}: {
  citations: { id: string; title: string; url: string }[];
}) {
  return (
    <ul
      aria-label="공식 출처"
      data-product-source-cards=""
      className="grid list-none gap-2 p-0 sm:grid-cols-2"
    >
      {citations.map((citation) => (
        <li
          key={citation.id}
          data-product-source-card=""
          className="min-w-0 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-3"
        >
          <div className="mb-2 flex items-start gap-2 text-sm font-medium text-[var(--pui-text)]">
            <BookOpen
              size={16}
              className="mt-0.5 shrink-0 text-[var(--pui-muted)]"
              aria-hidden="true"
            />
            <strong className="min-w-0 font-medium [overflow-wrap:anywhere]">
              {citation.title}
            </strong>
          </div>
          <a
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${citation.title} 원문 보기`}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-xs font-medium text-[var(--pui-primary)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)]"
          >
            공식 원문 보기 <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}
