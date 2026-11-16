import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { ChevronLeft, Ellipsis, FileChartColumn, FolderClosed } from "lucide-react";
import type { ReactNode } from "react";
import { Button, ButtonLink } from "../Button";
import { useProductTheme } from "../Theme";
import { useClientReady } from "../utils";

const tools = [
  { id: "summary", label: "요약 보기 · 재확인", path: "/summary" },
  { id: "timeline", label: "타임라인", path: "/timeline" },
  { id: "actions", label: "다음 행동", path: "/actions" },
  { id: "precedents", label: "유사 판례", path: "/precedents" },
  { id: "files", label: "자료", path: "/files" },
  { id: "reports", label: "리포트 보기", path: "/reports" },
] as const;
export type CaseHeaderProps = {
  caseId: string;
  title: string;
  active: "chat" | (typeof tools)[number]["id"];
  fileCount?: number | undefined;
  actions?: ReactNode;
};

export function CaseHeader({ caseId, title, active, fileCount, actions }: CaseHeaderProps) {
  const base = "/cases/" + encodeURIComponent(caseId);
  const clientReady = useClientReady();
  const theme = useProductTheme();
  const trigger = <Ellipsis size={19} aria-hidden="true" />;
  return (
    <header
      data-product-case-navigation=""
      className="flex min-h-14 min-w-0 items-center gap-2 text-[var(--pui-text)]"
    >
      <div data-product-case-identity="" className="flex min-w-0 flex-1 items-center gap-2">
        {active !== "chat" && (
          <ButtonLink href={base} variant="ghost" size="icon" aria-label="대화로 돌아가기">
            <ChevronLeft size={18} aria-hidden="true" />
          </ButtonLink>
        )}
        <FolderClosed
          size={18}
          className="hidden shrink-0 text-[var(--pui-muted)] sm:block"
          aria-hidden="true"
        />
        <h1 title={title} className="min-w-0 truncate text-sm font-medium leading-6">
          {title}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {active !== "reports" && (
          <ButtonLink
            href={base + "/reports?mode=conversation"}
            variant="ghost"
            size="sm"
            className="gap-1.5 px-2"
          >
            <FileChartColumn size={17} aria-hidden="true" />
            <span>리포트</span>
          </ButtonLink>
        )}
        {actions}
        {clientReady ? (
          <Popover className="contents">
            <PopoverButton
              as={Button}
              variant="ghost"
              size="icon"
              data-popover-button=""
              aria-label="사건 도구"
            >
              {trigger}
            </PopoverButton>
            <PopoverPanel
              as="nav"
              portal
              anchor={{ to: "bottom end", gap: 8, padding: 12 }}
              data-product-ui=""
              data-theme={theme}
              data-product-case-tools=""
              aria-label="사건 도구"
              className="z-[80] grid max-h-[60dvh] w-64 max-w-[calc(100vw-24px)] gap-0.5 overflow-auto rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-1.5 text-[var(--pui-text)] shadow-lg focus:outline-none"
            >
              {tools.map(({ id, label, path }) => (
                <ButtonLink
                  key={id}
                  href={base + path}
                  variant="ghost"
                  className="justify-start rounded-lg px-3 text-sm aria-[current=page]:bg-[var(--pui-background)]"
                  aria-current={active === id ? "page" : undefined}
                >
                  <span>{label}</span>
                  {id === "files" && fileCount !== undefined && (
                    <small className="ml-auto text-xs text-[var(--pui-muted)]">{fileCount}</small>
                  )}
                </ButtonLink>
              ))}
            </PopoverPanel>
          </Popover>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label="사건 도구"
            data-popover-button=""
            disabled
          >
            {trigger}
          </Button>
        )}
      </div>
    </header>
  );
}
