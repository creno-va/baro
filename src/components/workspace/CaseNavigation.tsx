import { ChevronLeft, Ellipsis, FileChartColumn, FolderClosed } from "lucide-react";
import type { ReactNode } from "react";
import { Popover, PopoverButton, PopoverPanel } from "../ui/popover";

const tools = [
  { id: "summary", label: "요약 보기 · 재확인", path: "/summary" },
  { id: "timeline", label: "타임라인", path: "/timeline" },
  { id: "actions", label: "다음 행동", path: "/actions" },
  { id: "precedents", label: "유사 판례", path: "/precedents" },
  { id: "files", label: "자료", path: "/files" },
  { id: "reports", label: "리포트 보기", path: "/reports" },
] as const;
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
  const base = "/cases/" + encodeURIComponent(caseId);
  return (
    <header className="case-navigation case-header">
      <div className="case-header__identity">
        {active !== "chat" && (
          <a className="case-header__back" href={base} aria-label="대화로 돌아가기">
            <ChevronLeft size={18} aria-hidden="true" />
          </a>
        )}
        <FolderClosed size={18} aria-hidden="true" />
        <h1 title={title}>{title}</h1>
      </div>
      <div className="case-header__actions">
        {active !== "reports" && (
          <a className="case-report-link" href={base + "/reports?mode=conversation"}>
            <FileChartColumn size={17} aria-hidden="true" /> 리포트
          </a>
        )}
        {actions}
        <Popover className="case-tools">
          <PopoverButton
            className="ui-control case-tools__trigger"
            data-popover-button=""
            aria-label="사건 도구"
          >
            <Ellipsis size={19} aria-hidden="true" />
          </PopoverButton>
          <PopoverPanel
            as="nav"
            anchor={{ to: "bottom end", gap: 8, padding: 12 }}
            portal
            className="case-tools__menu ui-menu"
            aria-label="사건 도구"
          >
            {tools.map(({ id, label, path }) => (
              <a
                className="ui-menu__item"
                key={id}
                href={base + path}
                aria-current={active === id ? "page" : undefined}
              >
                <span>{label}</span>
                {id === "files" && fileCount !== undefined && <small>{fileCount}</small>}
              </a>
            ))}
          </PopoverPanel>
        </Popover>
      </div>
    </header>
  );
}
