import { ChevronDown, ChevronLeft, FolderClosed } from "lucide-react";
import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef } from "react";

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

function revealFocusedTool(menu: HTMLElement) {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !menu.contains(focused)) return;
  const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const bounds = menu.getBoundingClientRect();
  const link = focused.getBoundingClientRect();
  const top = bounds.top + menu.clientTop * zoom;
  const bottom = top + menu.clientHeight * zoom;
  if (link.top < top) menu.scrollTop += (link.top - top) / zoom;
  else if (link.bottom > bottom) menu.scrollTop += (link.bottom - bottom) / zoom;
}

function positionTools(disclosure: HTMLDetailsElement | null, trigger: HTMLElement | null) {
  const menu = disclosure?.querySelector<HTMLElement>(".case-tools__menu");
  if (!disclosure?.open || !trigger || !menu) return;
  const scrollTop = menu.scrollTop;
  const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const viewport = window.visualViewport;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  const edge = 16 * zoom;
  let topEdge = (viewport?.offsetTop ?? 0) + edge;
  let leftEdge = (viewport?.offsetLeft ?? 0) + edge;
  const rightEdge = (viewport?.offsetLeft ?? 0) + width - edge;
  const bottomEdge = (viewport?.offsetTop ?? 0) + height - edge;
  const navigation = disclosure
    .closest(".app-frame")
    ?.querySelector(".app-header")
    ?.getBoundingClientRect();
  // Fixed navigation is above the case header's stacking context. Its occupied
  // top bar or side rail is unavailable even when it lies inside the viewport.
  if (navigation) {
    if (navigation.width >= width - 1) topEdge = Math.max(topEdge, navigation.bottom + edge);
    else if (navigation.height >= height - 1)
      leftEdge = Math.max(leftEdge, navigation.right + edge);
  }
  menu.style.setProperty(
    "--case-tools-width-limit",
    `${Math.max(0, rightEdge - leftEdge) / zoom}px`,
  );
  const anchor = trigger.getBoundingClientRect();
  const bounds = menu.getBoundingClientRect();
  // Read the full content without expanding the menu: a temporary larger
  // max-height would clamp its current scrollTop before it is constrained again.
  const contentHeight = (menu.scrollHeight + menu.offsetHeight - menu.clientHeight) * zoom;
  const left = Math.max(leftEdge, Math.min(anchor.right - bounds.width, rightEdge - bounds.width));
  const belowTop = Math.max(topEdge, anchor.bottom + 4 * zoom);
  const aboveBottom = Math.min(bottomEdge, anchor.top - 4 * zoom);
  const belowSpace = Math.max(0, bottomEdge - belowTop);
  const aboveSpace = Math.max(0, aboveBottom - topEdge);
  const below =
    contentHeight <= belowSpace || (contentHeight > aboveSpace && belowSpace >= aboveSpace);
  const space = below ? belowSpace : aboveSpace;
  // Keep an adjacent placement when a side can show a complete 44px control
  // plus menu insets. At smaller heights, use the unobscured region and scroll.
  const limit = space >= 54 * zoom ? space : Math.max(0, bottomEdge - topEdge);
  menu.style.setProperty("--case-tools-height-limit", `${limit / zoom}px`);
  const placed = menu.getBoundingClientRect();
  const top = Math.max(
    topEdge,
    Math.min(below ? belowTop : aboveBottom - placed.height, bottomEdge - placed.height),
  );
  menu.style.setProperty("--case-tools-left", `${left / zoom}px`);
  menu.style.setProperty("--case-tools-right", "auto");
  menu.style.setProperty("--case-tools-top", `${top / zoom}px`);
  menu.scrollTop = scrollTop;
  revealFocusedTool(menu);
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
  // Keep only the current prop for revision detection; never render an older title.
  const titleRevision = useRef({ value: title, revision: 0 });
  if (titleRevision.current.value !== title)
    titleRevision.current = { value: title, revision: titleRevision.current.revision + 1 };
  const placedRevision = useRef(-1);
  const knownOpen = useRef(false);
  const position = useCallback(() => {
    if (!disclosure.current?.open) return;
    positionTools(disclosure.current, trigger.current);
    placedRevision.current = titleRevision.current.revision;
  }, []);
  const syncOpen = useCallback(() => {
    const open = disclosure.current?.open ?? false;
    if (knownOpen.current === open) return;
    knownOpen.current = open;
    if (open) position();
  }, [position]);
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
    const positionOnScroll = (event: Event) => {
      // Only ancestor scrolling moves the anchor. Menu/message/sidebar scrolling
      // must not move a target that the user has already chosen.
      if (event.target instanceof Element && !event.target.contains(trigger.current)) return;
      position();
    };
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !disclosure.current?.contains(event.target)) {
        disclosure.current?.removeAttribute("open");
        syncOpen();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    document.addEventListener("scroll", positionOnScroll, true);
    const resize = new ResizeObserver(() => {
      // Show the latest title immediately, but keep an open menu's targets fixed
      // across background title reflow. Explicit geometry events still reanchor it.
      if (disclosure.current?.open && placedRevision.current !== titleRevision.current.revision)
        return;
      position();
    });
    if (trigger.current) resize.observe(trigger.current);
    const heading =
      disclosure.current?.closest(".case-workspace__header") ??
      disclosure.current?.closest(".case-header");
    if (heading) resize.observe(heading);
    const style = new MutationObserver(position);
    style.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    // A native disclosure may already be open when its island hydrates. Lock its
    // initial target before the parent's async case read replaces the loading title.
    syncOpen();
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      document.removeEventListener("scroll", positionOnScroll, true);
      resize.disconnect();
      style.disconnect();
    };
  }, [position, syncOpen]);
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
          onToggle={syncOpen}
          onClick={(event) => {
            if (!(event.target instanceof Node) || !trigger.current?.contains(event.target)) return;
            // Native toggle events are queued. Commit the same details state
            // and its initial position in this activation, before links can be hit.
            event.preventDefault();
            event.currentTarget.open = !event.currentTarget.open;
            syncOpen();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !event.currentTarget.open) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.open = false;
            syncOpen();
            trigger.current?.focus();
          }}
        >
          <summary ref={trigger}>
            사건 도구 <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <nav
            className="case-tools__menu"
            aria-label="사건 도구"
            onFocusCapture={(event) => revealFocusedTool(event.currentTarget)}
          >
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
