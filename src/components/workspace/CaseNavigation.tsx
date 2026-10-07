import { ArrowLeft } from "lucide-react";

const menus = [
  { id: "chat", label: "대화", path: "" },
  { id: "files", label: "자료", path: "/files" },
  { id: "timeline", label: "타임라인", path: "/timeline" },
  { id: "actions", label: "다음 행동", path: "/actions" },
  { id: "reports", label: "리포트", path: "/reports" },
] as const;

export function CaseNavigation({
  caseId,
  title,
  active,
  fileCount,
}: {
  caseId: string;
  title: string;
  active: (typeof menus)[number]["id"];
  fileCount?: number | undefined;
}) {
  const base = `/cases/${encodeURIComponent(caseId)}`;
  return (
    <div className="case-navigation">
      <a className="workspace-back" href="/cases">
        <ArrowLeft size={16} aria-hidden="true" /> 내 사건
      </a>
      <header className="workspace-header">
        <h1>{title}</h1>
      </header>
      <nav className="workspace-tabs" aria-label="사건 메뉴">
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
