import { ChevronLeft, Ellipsis, FileChartColumn, FolderClosed } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

const tools = [
  { id: "summary", label: "요약 보기 · 재확인", path: "/summary" },
  { id: "timeline", label: "타임라인", path: "/timeline" },
  { id: "actions", label: "다음 행동", path: "/actions" },
  { id: "precedents", label: "유사 판례", path: "/precedents" },
  { id: "files", label: "자료", path: "/files" },
  { id: "reports", label: "리포트 보기", path: "/reports" },
] as const;

/** Route navigation only. Business state and the materials toggle belong to the caller. */
export function CaseNavigation({
  caseId,
  title,
  active,
  fileCount,
  actions,
}: {
  caseId: string;
  title: string;
  active: "chat" | (typeof tools)[number]["id"];
  fileCount?: number | undefined;
  actions?: ReactNode;
}) {
  const base = `/cases/${encodeURIComponent(caseId)}`;
  const disclosure = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !disclosure.current?.contains(event.target))
        disclosure.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  return (
    <header className="case-navigation case-header">
      <div className="case-header__identity">
        {active !== "chat" && (
          <a
            className="case-header__back"
            href={base}
            aria-label="대화로 돌아가기"
            title="대화로 돌아가기"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </a>
        )}
        <FolderClosed size={18} aria-hidden="true" />
        <h1 title={title}>{title}</h1>
      </div>
      <div className="case-header__actions">
        {active !== "reports" && (
          <a className="case-report-link" href={`${base}/reports?mode=conversation`}>
            <FileChartColumn size={17} aria-hidden="true" /> 리포트
          </a>
        )}
        {actions}
        <details
          ref={disclosure}
          className="case-tools"
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !event.currentTarget.open) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.open = false;
            trigger.current?.focus();
          }}
        >
          <summary ref={trigger} aria-label="사건 도구" title="사건 도구">
            <Ellipsis size={19} aria-hidden="true" />
          </summary>
          <nav className="case-tools__menu" aria-label="사건 도구">
            {tools.map(({ id, label, path }) => (
              <a key={id} href={`${base}${path}`} aria-current={active === id ? "page" : undefined}>
                <span>{label}</span>
                {id === "files" && fileCount !== undefined && <small>{fileCount}</small>}
              </a>
            ))}
          </nav>
        </details>
      </div>
    </header>
  );
}
