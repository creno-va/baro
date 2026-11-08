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

function positionTools(disclosure: HTMLDetailsElement | null, trigger: HTMLElement | null) {
  const menu = disclosure?.querySelector<HTMLElement>(".case-tools__menu");
  if (!disclosure?.open || !trigger || !menu) return;
  const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const width = window.visualViewport?.width ?? window.innerWidth;
  const height = window.visualViewport?.height ?? window.innerHeight;
  const edge = 16 * zoom;
  menu.style.setProperty("--case-tools-width-limit", `${Math.max(44, width / zoom - 32)}px`);
  menu.style.setProperty("--case-tools-height-limit", `${Math.max(44, height / zoom - 32)}px`);
  const anchor = trigger.getBoundingClientRect();
  const bounds = menu.getBoundingClientRect();
  const left = Math.max(edge, Math.min(anchor.right - bounds.width, width - edge - bounds.width));
  let top = anchor.bottom + 4 * zoom;
  if (top + bounds.height > height - edge) top = anchor.top - bounds.height - 4 * zoom;
  top = Math.max(edge, Math.min(top, height - edge - bounds.height));
  menu.style.setProperty("--case-tools-left", `${left / zoom}px`);
  menu.style.setProperty("--case-tools-top", `${top / zoom}px`);
}

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
    const position = () => positionTools(disclosure.current, trigger.current);
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !disclosure.current?.contains(event.target))
        disclosure.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    const resize = new ResizeObserver(position);
    if (trigger.current) resize.observe(trigger.current);
    const style = new MutationObserver(position);
    style.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
      resize.disconnect();
      style.disconnect();
    };
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
          onToggle={() => positionTools(disclosure.current, trigger.current)}
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
