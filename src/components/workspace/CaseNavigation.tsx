import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

const menus = [
  { id: "chat", label: "대화", path: "" },
  { id: "files", label: "자료", path: "/files" },
  { id: "timeline", label: "타임라인", path: "/timeline" },
  { id: "actions", label: "다음 행동", path: "/actions" },
  { id: "precedents", label: "판례", path: "/precedents" },
  { id: "reports", label: "리포트", path: "/reports" },
] as const;

export function CaseNavigation({
  caseId,
  title,
  active,
  fileCount,
  action,
}: {
  caseId: string;
  title: string;
  active: (typeof menus)[number]["id"];
  fileCount?: number | undefined;
  action?: ReactNode;
}) {
  const base = `/cases/${encodeURIComponent(caseId)}`;
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navigation.current;
    const selected = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && selected && nav.scrollWidth > nav.clientWidth)
      nav.scrollLeft = Math.max(0, selected.offsetLeft - 12);
  }, []);
  return (
    <div className="case-navigation">
      <a className="workspace-back" href="/cases">
        <ArrowLeft size={16} aria-hidden="true" /> 내 사건
      </a>
      <header className="workspace-header">
        <h1 title={title}>{title}</h1>
        {action && (
          <details className="case-options">
            <summary aria-label="사건 관리">
              <MoreHorizontal size={22} aria-hidden="true" />
            </summary>
            <div>{action}</div>
          </details>
        )}
      </header>
      <nav ref={navigation} className="workspace-tabs" aria-label="사건 메뉴">
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
