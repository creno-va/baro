import { ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";

const menus = [
  { id: "chat", label: "대화", path: "" },
  { id: "files", label: "자료", path: "/files" },
  { id: "timeline", label: "타임라인", path: "/timeline" },
  { id: "actions", label: "다음 행동", path: "/actions" },
  { id: "precedents", label: "유사 판례", path: "/precedents" },
  { id: "reports", label: "리포트", path: "/reports" },
] as const;

function revealDestination(nav: HTMLElement, link: HTMLElement) {
  if (nav.scrollWidth <= nav.clientWidth) return;
  const container = nav.getBoundingClientRect();
  const destination = link.getBoundingClientRect();
  // DOM rectangles include CSS zoom while scrollLeft uses layout pixels.
  const scale = container.width / nav.offsetWidth || 1;
  if (destination.left < container.left)
    nav.scrollLeft += (destination.left - container.left) / scale - 4;
  else if (destination.right > container.right)
    nav.scrollLeft += (destination.right - container.right) / scale + 4;
}

export function CaseNavigation({
  caseId,
  title,
  active,
  fileCount,
  subjectContext,
}: {
  caseId: string;
  title: string;
  active: (typeof menus)[number]["id"];
  fileCount?: number | undefined;
  subjectContext?: "individual" | "company" | undefined;
}) {
  const base = `/cases/${encodeURIComponent(caseId)}`;
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    const revealCurrent = () => {
      if (!nav.isConnected) return;
      const focused = document.activeElement;
      const selected =
        focused instanceof HTMLElement && nav.contains(focused)
          ? focused
          : nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (selected) revealDestination(nav, selected);
    };
    revealCurrent();
    const observer = new ResizeObserver(revealCurrent);
    observer.observe(nav);
    for (const link of nav.querySelectorAll("a")) observer.observe(link);
    void document.fonts.ready.then(revealCurrent);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="case-navigation">
      <a className="workspace-back" href="/app">
        <ArrowLeft size={16} aria-hidden="true" /> 새 사건 입력
      </a>
      {subjectContext && (
        <p className="case-subject-context">
          {subjectContext === "company" ? "기업 사건" : "개인 사건"}
        </p>
      )}
      <header className="workspace-header">
        <h1 title={title}>{title}</h1>
      </header>
      <nav
        ref={navigation}
        className="workspace-tabs"
        aria-label="사건 메뉴"
        onFocus={(event) => {
          const nav = event.currentTarget;
          const link = event.target;
          requestAnimationFrame(() => {
            if (nav.isConnected && document.activeElement === link) revealDestination(nav, link);
          });
        }}
      >
        {menus.map(({ id, label, path }) => (
          <a
            key={id}
            href={`${base}${path}`}
            aria-current={active === id ? "page" : undefined}
            aria-label={id === "reports" ? "리포트 보기" : undefined}
          >
            {label}
            {id === "files" && fileCount !== undefined && <span>{fileCount}</span>}
          </a>
        ))}
      </nav>
    </div>
  );
}
