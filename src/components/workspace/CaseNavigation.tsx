import { ChevronDown, ChevronLeft, FolderClosed } from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useRef } from "react";

export type CaseTask = "chat" | "files" | "reports" | "drafts";
const tasks: readonly { id: CaseTask; label: string; path: string }[] = [
  { id: "chat", label: "대화", path: "" },
  { id: "files", label: "자료", path: "/files" },
  { id: "reports", label: "리포트", path: "/reports" },
  { id: "drafts", label: "문서 초안", path: "/reports#document-drafts" },
];

const tools = [
  { id: "summary", label: "요약 보기 · 재확인", path: "/summary" },
  { id: "timeline", label: "타임라인", path: "/timeline" },
  { id: "actions", label: "다음 행동", path: "/actions" },
  { id: "precedents", label: "유사 판례", path: "/precedents" },
] as const;

/** Route navigation only. Business state and the materials toggle belong to the caller. */
export function CaseNavigation({
  caseId,
  title,
  active,
  fileCount,
  actions,
  activeTask,
  onNavigate,
}: {
  caseId: string;
  title: string;
  active: CaseTask | (typeof tools)[number]["id"];
  fileCount?: number | undefined;
  actions?: ReactNode;
  activeTask?: CaseTask;
  /** A retained owner can switch tasks without unmounting unsent input or editors. */
  onNavigate?: (task: CaseTask) => void;
}) {
  const base = `/cases/${encodeURIComponent(caseId)}`;
  const disclosure = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const currentTask = activeTask ?? tasks.find((task) => task.id === active)?.id;
  function navigate(event: MouseEvent<HTMLAnchorElement>, task: CaseTask) {
    // Keep copy-link, open-in-new-tab and direct URL behavior available.
    if (
      !onNavigate ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onNavigate(task);
  }
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
            onClick={(event) => navigate(event, "chat")}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </a>
        )}
        <FolderClosed size={18} aria-hidden="true" />
        <h1 title={title}>{title}</h1>
      </div>
      <div className="case-header__actions">
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
          <summary ref={trigger}>
            사건 도구 <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <nav className="case-tools__menu" aria-label="사건 도구">
            {tools.map(({ id, label, path }) => (
              <a key={id} href={`${base}${path}`} aria-current={active === id ? "page" : undefined}>
                <span>{label}</span>
              </a>
            ))}
          </nav>
        </details>
      </div>
      <nav className="case-task-navigation" aria-label="사건 작업">
        {tasks.map(({ id, label, path }) => (
          <a
            key={id}
            href={`${base}${path}`}
            aria-current={currentTask === id ? "page" : undefined}
            onClick={(event) => navigate(event, id)}
          >
            <span>{label}</span>
            {id === "files" && fileCount !== undefined && <small>{fileCount}개</small>}
          </a>
        ))}
      </nav>
    </header>
  );
}
