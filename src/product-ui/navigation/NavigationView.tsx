import {
  Description,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Dialog as HeadlessDialog,
  Menu as HeadlessMenu,
  MenuButton,
  MenuItem,
  MenuItems,
} from "@headlessui/react";
import {
  Bell,
  BriefcaseBusiness,
  Check,
  CircleHelp,
  FileText,
  History,
  House,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircle,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useRef } from "react";
import { Button, ButtonLink } from "../Button";
import { Dialog } from "../Dialog";
import { InputField } from "../Field";
import { useProductTheme } from "../Theme";
import { cn, useClientReady } from "../utils";
import { useNavigationReturnFocus } from "./focus";
import { navigationActive } from "./types";
import type { NavigationController } from "./useNavigationController";

const icons = {
  home: House,
  cases: FileText,
  new: Plus,
  lawyers: Users,
  profile: BriefcaseBusiness,
  reviews: ShieldCheck,
  settings: Settings,
};
const themeChoices = [
  { value: "light", label: "라이트 모드", icon: Sun },
  { value: "dark", label: "다크 모드", icon: Moon },
  { value: "system", label: "시스템 설정", icon: Monitor },
] as const;
type Props = { controller: NavigationController };

function NavigationBrand({ controller: c, drawer = false }: Props & { drawer?: boolean }) {
  return (
    <a
      href={c.brandHref}
      aria-label="BARO 홈"
      {...(!drawer ? { ref: c.refs.brandRef } : {})}
      className="pui-nav-brand flex min-h-11 min-w-0 items-center gap-2.5 rounded-lg text-[var(--pui-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)]"
    >
      <img src="/brand/logo.svg" width="28" height="28" alt="" className="h-7 w-7 shrink-0" />
      <span
        className={cn(
          "text-base font-semibold tracking-wide",
          !drawer && c.collapsed && "min-[1200px]:sr-only",
        )}
      >
        BARO
      </span>
    </a>
  );
}

function ThemeMenu({ controller: c }: Props) {
  const theme = useProductTheme();
  const Icon = themeChoices.find((choice) => choice.value === c.theme)?.icon ?? Monitor;
  return (
    <HeadlessMenu>
      <MenuButton
        as={Button}
        variant="ghost"
        size="icon"
        aria-label="화면 테마 변경"
        title="화면 테마 변경"
      >
        <Icon size={18} aria-hidden="true" />
      </MenuButton>
      <MenuItems
        anchor={{ to: "bottom end", gap: 8, padding: 12 }}
        portal
        data-product-ui=""
        data-theme={theme}
        className="z-[70] min-w-44 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-1 text-[var(--pui-text)] shadow-lg focus:outline-none"
      >
        {themeChoices.map((choice) => (
          <MenuItem key={choice.value}>
            <Button
              variant="ghost"
              className="w-full justify-start rounded-lg px-3 data-focus:bg-[var(--pui-background)]"
              aria-current={c.theme === choice.value ? "true" : undefined}
              onClick={() => c.actions.setTheme(choice.value)}
            >
              <choice.icon size={16} aria-hidden="true" />
              <span>{choice.label}</span>
              {c.theme === choice.value && (
                <Check size={16} className="ml-auto" aria-hidden="true" />
              )}
            </Button>
          </MenuItem>
        ))}
      </MenuItems>
    </HeadlessMenu>
  );
}

function Utilities({ controller: c, compact = false }: Props & { compact?: boolean }) {
  if (c.appearance !== "workbench") return null;
  return (
    <div className={cn("flex gap-1", compact && "flex-col items-center")}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="확인할 일"
        title="확인할 일"
        onClick={(event) => c.actions.openUtility("attention", event.currentTarget)}
      >
        <Bell size={18} aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="최근 사건 검색"
        title="최근 사건 검색"
        onClick={(event) => c.actions.openUtility("search", event.currentTarget)}
      >
        <Search size={18} aria-hidden="true" />
      </Button>
    </div>
  );
}

function MainLinks({
  controller: c,
  compact = false,
  drawer = false,
}: Props & { compact?: boolean; drawer?: boolean }) {
  return (
    <nav aria-label={drawer ? "모바일 주 메뉴" : "주 메뉴"} className="grid gap-1">
      {c.items.map((item) => {
        const Icon = icons[item.icon];
        return (
          <ButtonLink
            key={item.href}
            href={item.href}
            variant={item.icon === "new" ? "secondary" : "ghost"}
            size={compact ? "icon" : "default"}
            aria-label={item.label}
            title={item.label}
            aria-current={navigationActive(item, c.pathname) ? "page" : undefined}
            className={cn(
              "justify-start rounded-lg text-sm",
              compact && "justify-center",
              item.icon === "new" &&
                "border-transparent bg-[var(--pui-text)] text-[var(--pui-surface)]",
            )}
          >
            <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
            {!compact && <span>{item.label}</span>}
          </ButtonLink>
        );
      })}
    </nav>
  );
}

function RecentCases({ controller: c, compact = false }: Props & { compact?: boolean }) {
  if (!c.canShowRecent) return null;
  return (
    <div
      data-navigation-recent=""
      className={cn("flex min-h-0 flex-1 flex-col", compact && "hidden")}
    >
      <h2 className="px-2 pb-2 text-xs font-medium text-[var(--pui-muted)]">최근 사건</h2>
      <section
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users scroll this bounded recent-case list independently.
        tabIndex={0}
        aria-label="최근 사건 목록"
        className="min-h-0 flex-1 overflow-y-auto rounded-lg [scrollbar-width:thin] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)]"
      >
        {c.recentState === "loading" ? (
          <p
            role="status"
            className="flex items-center gap-2 px-2 py-4 text-xs text-[var(--pui-muted)]"
          >
            <LoaderCircle
              size={15}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            최근 사건을 불러오는 중
          </p>
        ) : c.recentState === "error" ? (
          <div className="px-2 py-3 text-xs text-[var(--pui-muted)]">
            <p role="status">사건을 불러오지 못했어요.</p>
            <Button variant="ghost" size="sm" onClick={c.actions.retryRecent}>
              다시 불러오기
            </Button>
          </div>
        ) : c.recent.length ? (
          <nav aria-label="최근 사건" className="grid gap-0.5">
            {c.recent.map((item) => (
              <div
                key={item.id}
                data-navigation-case-row=""
                className="group relative flex min-w-0 items-center rounded-lg hover:bg-[var(--pui-surface)] focus-within:bg-[var(--pui-surface)]"
              >
                <a
                  href={c.caseLink(item)}
                  title={item.title}
                  aria-current={
                    c.pathname === `/cases/${encodeURIComponent(item.id)}` ||
                    c.pathname.startsWith(`/cases/${encodeURIComponent(item.id)}/`)
                      ? "page"
                      : undefined
                  }
                  className="flex min-h-11 min-w-0 flex-1 items-center rounded-lg py-2 pl-2 pr-[92px] text-sm text-[var(--pui-text)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--pui-focus)]"
                >
                  <span className="min-w-0 truncate">{item.title}</span>
                </a>
                <div
                  data-navigation-case-actions=""
                  className="absolute right-0.5 top-1/2 flex -translate-y-1/2 items-center rounded-lg bg-[var(--pui-surface)] opacity-100 min-[1200px]:opacity-0 min-[1200px]:group-hover:opacity-100 min-[1200px]:group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  {item.schemaVersion !== "1" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${item.title} 제목 수정`}
                      title="제목 수정"
                      disabled={c.deleting || c.renaming || c.signingOut}
                      onClick={(event) => c.actions.beginRename(item, event.currentTarget)}
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${item.title} 사건 삭제`}
                    title="사건 삭제"
                    disabled={c.deleting || c.renaming || c.signingOut}
                    onClick={(event) => c.actions.beginDelete(item, event.currentTarget)}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </nav>
        ) : (
          <div className="px-2 py-6 text-xs leading-relaxed text-[var(--pui-muted)]">
            <MessageCircle size={18} className="mb-2" aria-hidden="true" />
            <p>
              아직 사건이 없어요.
              <br />새 사건을 만들면 여기에 표시돼요.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function Account({ controller: c, compact = false }: Props & { compact?: boolean }) {
  return (
    <div
      data-navigation-account=""
      className={cn(
        "relative mt-auto border-t border-[var(--pui-border)] pt-3",
        compact ? "grid justify-items-center gap-1" : "grid gap-1",
      )}
    >
      <div className={cn("flex items-center gap-1", compact && "flex-col")}>
        <ButtonLink
          href="/help"
          variant="ghost"
          size={compact ? "icon" : "sm"}
          aria-label="도움말"
          title="도움말"
          onClick={() => c.actions.setDrawerOpen(false)}
          className={cn("justify-start text-[var(--pui-muted)]", compact && "justify-center")}
        >
          <CircleHelp size={17} aria-hidden="true" />
          {!compact && <span>도움말</span>}
        </ButtonLink>
        {c.session?.user && !c.session.needsConsent && (
          <ButtonLink
            href="/settings"
            variant="ghost"
            size={compact ? "icon" : "sm"}
            aria-label="설정"
            title="설정"
            aria-current={c.pathname === "/settings" ? "page" : undefined}
            className={cn("justify-start text-[var(--pui-muted)]", compact && "justify-center")}
          >
            <Settings size={17} aria-hidden="true" />
            {!compact && <span>설정</span>}
          </ButtonLink>
        )}
      </div>
      {c.session?.user ? (
        <div className={cn("flex min-w-0 items-center gap-1", compact && "flex-col")}>
          <a
            href={c.session.needsConsent ? "/consent" : "/settings"}
            aria-label={`${c.session.user.name || "내 계정"} · 계정 관리`}
            title="계정 관리"
            className={cn(
              "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-[var(--pui-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)]",
              compact && "flex-none justify-center px-0",
            )}
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--pui-border)] bg-[var(--pui-surface)] text-xs font-medium"
            >
              {c.session.user.name.slice(0, 1) || "B"}
            </span>
            {!compact && (
              <span className="min-w-0">
                <strong className="block truncate text-xs font-medium">
                  {c.session.user.name || "내 계정"}
                </strong>
                <small className="block text-[11px] text-[var(--pui-muted)]">
                  {c.session.needsConsent ? "필수 확인 필요" : "나의 BARO"}
                </small>
              </span>
            )}
          </a>
          <Button
            variant="ghost"
            size="icon"
            aria-label={c.signingOut ? "로그아웃 중…" : "로그아웃"}
            title="로그아웃"
            disabled={c.signingOut}
            onClick={() => void c.actions.signOut()}
          >
            {c.signingOut ? (
              <LoaderCircle
                size={17}
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <LogOut size={17} aria-hidden="true" />
            )}
          </Button>
        </div>
      ) : (
        (c.showLogin || c.session !== null) && (
          <ButtonLink
            href="/login"
            variant="secondary"
            size={compact ? "icon" : "default"}
            aria-label="로그인하고 시작하기"
          >
            {compact ? <LogOut size={17} aria-hidden="true" /> : "로그인하고 시작하기"}
          </ButtonLink>
        )
      )}
      {c.mock && !compact && (
        <p className="px-2 pt-1 text-[10px] text-[var(--pui-muted)]">API 예시 모드 · 합성 데이터</p>
      )}
      {c.error && !c.deletion && (
        <p
          role="alert"
          className={cn(
            "text-xs text-[var(--pui-danger)] [overflow-wrap:anywhere]",
            compact
              ? "absolute bottom-0 left-full ml-4 w-72 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-3 shadow-lg"
              : "px-2",
          )}
        >
          {c.error}
        </p>
      )}
    </div>
  );
}

function Drawer({ controller: c }: Props) {
  const clientReady = useClientReady();
  const theme = useProductTheme();
  const closeRef = useRef<HTMLButtonElement>(null);
  useNavigationReturnFocus(c.open, c.refs.menuReturn);
  if (!clientReady) return null;
  return (
    <HeadlessDialog
      open={c.open}
      onClose={() => c.actions.setDrawerOpen(false)}
      initialFocus={closeRef}
      className="relative z-50"
      data-product-ui=""
      data-theme={theme}
    >
      <DialogBackdrop className="fixed inset-0 bg-black/30" />
      <DialogPanel className="fixed inset-y-0 left-0 flex h-[100dvh] w-80 max-w-[calc(100vw-1rem)] flex-col border-r border-[var(--pui-border)] bg-[var(--pui-background)] px-3 pb-4 text-[var(--pui-text)] shadow-xl">
        <DialogTitle className="sr-only">메뉴</DialogTitle>
        <Description className="sr-only">사건을 시작하거나 이어서 정리하세요.</Description>
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-1">
          <NavigationBrand controller={c} drawer />
          <Button
            ref={closeRef}
            variant="ghost"
            size="icon"
            aria-label="닫기"
            onClick={() => c.actions.setDrawerOpen(false)}
          >
            <X size={20} aria-hidden="true" />
          </Button>
        </div>
        <div className="flex items-center justify-between border-t border-[var(--pui-border)] py-2">
          <Utilities controller={c} />
          <ThemeMenu controller={c} />
        </div>
        <MainLinks controller={c} drawer />
        <div className="my-4 flex min-h-0 flex-1 flex-col">
          <RecentCases controller={c} />
        </div>
        <Account controller={c} />
      </DialogPanel>
    </HeadlessDialog>
  );
}

export function NavigationView({ controller: c }: Props) {
  useNavigationReturnFocus(c.utility !== null, c.refs.utilityReturn);
  return (
    <>
      <header
        ref={c.refs.navigationRoot}
        data-product-navigation=""
        data-collapsed={c.collapsed}
        className="pui-navigation fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--pui-border)] bg-[var(--pui-background)] px-3 text-[var(--pui-text)] min-[1200px]:inset-y-0 min-[1200px]:right-auto min-[1200px]:h-[var(--app-viewport-height,100dvh)] min-[1200px]:w-[var(--wb-sidebar-width)] min-[1200px]:flex-col min-[1200px]:items-stretch min-[1200px]:justify-start min-[1200px]:border-r min-[1200px]:border-b-0 min-[1200px]:pb-4"
        onFocusCapture={c.actions.focusCapture}
        onBlurCapture={c.actions.blurCapture}
      >
        <div
          className={cn(
            "flex h-14 min-w-0 shrink-0 items-center gap-2 min-[1200px]:px-1",
            c.collapsed &&
              "min-[1200px]:h-28 min-[1200px]:flex-col min-[1200px]:justify-center min-[1200px]:gap-0",
          )}
        >
          <NavigationBrand controller={c} />
          <Button
            ref={c.refs.collapseButton}
            variant="ghost"
            size="icon"
            className={cn(
              "ml-auto hidden min-[1200px]:inline-flex",
              c.collapsed && "min-[1200px]:ml-0",
            )}
            aria-label={c.collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            aria-expanded={!c.collapsed}
            aria-controls="app-desktop-navigation"
            title={c.collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            onClick={c.actions.toggleSidebar}
          >
            {c.collapsed ? (
              <PanelLeftOpen size={18} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={18} aria-hidden="true" />
            )}
          </Button>
        </div>
        <div className="flex items-center gap-1 min-[1200px]:hidden">
          <ThemeMenu controller={c} />
          {c.mock && <span className="text-[10px] text-[var(--pui-muted)]">API 예시</span>}
          <Button
            ref={c.refs.mobileMenuButton}
            variant="ghost"
            size="icon"
            aria-label="메뉴 열기"
            aria-expanded={c.open}
            aria-haspopup="dialog"
            disabled={!c.ready}
            onClick={(event) => c.actions.openDrawer(event.currentTarget)}
          >
            <Menu size={20} aria-hidden="true" />
          </Button>
        </div>
        <div
          id="app-desktop-navigation"
          className="hidden min-h-0 flex-1 flex-col gap-4 pt-2 min-[1200px]:flex"
        >
          <MainLinks controller={c} compact={c.collapsed} />
          <div className={cn("flex items-center justify-between", c.collapsed && "flex-col gap-1")}>
            <Utilities controller={c} compact={c.collapsed} />
            <ThemeMenu controller={c} />
          </div>
          {c.collapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="mx-auto"
              aria-label="최근 사건 열기"
              title="최근 사건 열기"
              onClick={(event) => c.actions.openDrawer(event.currentTarget)}
            >
              <History size={18} aria-hidden="true" />
            </Button>
          )}
          <RecentCases controller={c} compact={c.collapsed} />
          <Account controller={c} compact={c.collapsed} />
        </div>
      </header>
      <Dialog
        open={c.utility !== null}
        onClose={c.actions.closeUtility}
        title={c.utility === "search" ? "최근 사건 검색" : "확인할 일"}
        description={
          c.utility === "search"
            ? "불러온 내 사건의 제목으로 검색해요."
            : "입력이나 요약 확인을 마치지 않은 사건을 이어서 준비하세요."
        }
      >
        {c.utility === "search" && (
          <InputField
            label="사건 제목 검색"
            autoFocus
            placeholder="사건 제목을 입력하세요"
            value={c.query}
            onChange={(event) => c.actions.setQuery(event.currentTarget.value)}
          />
        )}
        <div aria-live="polite" className="mt-4 grid max-h-[50dvh] gap-1 overflow-y-auto">
          {c.recentState === "loading" ? (
            <p className="text-sm text-[var(--pui-muted)]">사건을 불러오는 중이에요.</p>
          ) : c.recentState === "error" ? (
            <p className="text-sm text-[var(--pui-muted)]">
              사건 목록을 불러오지 못했어요. 사이드바에서 다시 불러와 주세요.
            </p>
          ) : c.matches.length ? (
            c.matches.map((item) => (
              <a
                key={item.id}
                href={c.caseLink(item)}
                className="flex min-h-11 min-w-0 items-center gap-3 rounded-lg px-2 py-3 hover:bg-[var(--pui-background)] focus-visible:outline-2 focus-visible:outline-[var(--pui-focus)]"
              >
                <FileText
                  size={18}
                  className="shrink-0 text-[var(--pui-muted)]"
                  aria-hidden="true"
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {item.title}
                  <small className="mt-1 block text-xs text-[var(--pui-muted)]">
                    {c.utility === "attention" ? "이어서 준비하기" : "사건 열기"}
                  </small>
                </span>
              </a>
            ))
          ) : (
            <p className="text-sm text-[var(--pui-muted)]">
              {c.utility === "search"
                ? "검색 결과가 없어요."
                : "이어서 입력하거나 확인할 사건이 없어요."}
            </p>
          )}
        </div>
      </Dialog>
      <Drawer controller={c} />
      <Dialog open={Boolean(c.editing)} onClose={c.actions.cancelRename} title="사건 제목 수정">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void c.actions.renameRecent();
          }}
          className="grid gap-4"
        >
          <InputField
            label="제목"
            autoFocus
            value={c.caseTitle}
            maxLength={40}
            required
            disabled={c.renaming}
            error={c.renameError || undefined}
            onChange={(event) => c.actions.setCaseTitle(event.currentTarget.value)}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" disabled={c.renaming} onClick={c.actions.cancelRename}>
              취소
            </Button>
            <Button
              type="submit"
              disabled={
                !c.editing ||
                c.renaming ||
                !c.caseTitle.trim() ||
                c.caseTitle.trim() === c.editing.item.title
              }
              aria-busy={c.renaming || undefined}
            >
              {c.renaming && (
                <LoaderCircle
                  size={16}
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              저장
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={Boolean(c.deletion)}
        onClose={c.actions.cancelDelete}
        title="이 사건을 삭제할까요?"
        description="삭제하면 이 사건과 연결된 자료·리포트에 접근할 수 없어요. 필요한 파일은 먼저 보관해 주세요."
        footer={
          <>
            <Button
              variant="danger"
              disabled={!c.deletion || c.deleting}
              aria-busy={c.deleting || undefined}
              onClick={() => void c.actions.deleteRecent()}
            >
              {c.deleting && (
                <LoaderCircle
                  size={16}
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              {c.deleting ? "삭제 접수 중…" : "사건 삭제"}
            </Button>
            <Button
              variant="secondary"
              autoFocus
              disabled={c.deleting}
              onClick={c.actions.cancelDelete}
            >
              취소
            </Button>
          </>
        }
      >
        {c.error && (
          <p role="alert" className="text-sm text-[var(--pui-danger)]">
            {c.error}
          </p>
        )}
      </Dialog>
    </>
  );
}
