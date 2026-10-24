/** Uses only the existing public citation view; no inferred dates or verification metadata. */
export function SourceCards({
  citations,
}: {
  citations: { id: string; title: string; url: string }[];
}) {
  return (
    <ul aria-label="공식 출처" className="workspace-source-cards">
      {citations.map((citation) => (
        <li key={citation.id} className="workspace-source-card">
          <strong>{citation.title}</strong>
          <a
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${citation.title} 원문 보기`}
          >
            공식 원문 보기 ↗
          </a>
        </li>
      ))}
    </ul>
  );
}
