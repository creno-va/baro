import {
  BriefcaseBusiness,
  FileText,
  History,
  House,
  LogOut,
  Menu,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Settings,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CaseView, SessionView } from "../../client/api";
import { api, apiMode, roleStart } from "../../client/api";
import { Brand } from "./brand";
import { Button } from "./button";
import { Dialog, Sheet } from "./dialog";
import { LoadingContent, Spinner } from "./loading";

export type NavigationRole = "visitor" | "user" | "lawyer" | "moderator";
export interface NavigationItem {
  href: string;
  label: string;
  icon: "home" | "cases" | "new" | "lawyers" | "profile" | "reviews" | "settings";
}
const icons = {
  home: House,
  cases: FileText,
  new: Plus,
  lawyers: Users,
  profile: BriefcaseBusiness,
  reviews: ShieldCheck,
  settings: Settings,
};
export const ROLE_NAVIGATION: Record<NavigationRole, readonly NavigationItem[]> = {
  visitor: [
    { href: "/", label: "서비스 소개", icon: "home" },
    { href: "/login", label: "이야기 시작하기", icon: "new" },
    { href: "/lawyers", label: "변호사 찾기", icon: "lawyers" },
  ],
  user: [
    { href: "/app", label: "새 사건 입력", icon: "new" },
    { href: "/lawyers", label: "변호사 찾기", icon: "lawyers" },
  ],
  lawyer: [
    { href: "/app", label: "새 사건 입력", icon: "new" },
    { href: "/lawyer", label: "변호사 프로필", icon: "profile" },
  ],
  moderator: [{ href: "/admin/reviews", label: "검토 대기", icon: "reviews" }],
};
export function availableNavigation(role: NavigationRole, availableRoutes: readonly string[]) {
  return ROLE_NAVIGATION[role].filter((item) => availableRoutes.includes(item.href));
}
function caseLink(item: CaseView) {
  const base = `/cases/${encodeURIComponent(item.id)}`;
  return item.schemaVersion === "1" || item.stage === "active" || item.stage === "archived"
    ? base
    : `${base}/${item.stage}`;
}
export function AppNavigation({
  role = "visitor",
  pathname = "/",
  availableRoutes,
  showLogin = false,
}: {
  role?: NavigationRole;
  pathname?: string;
  availableRoutes: readonly string[];
  showLogin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navigationRoot = useRef<HTMLElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const menuReturn = useRef<HTMLElement | null>(null);
  const mobileMenuButton = useRef<HTMLButtonElement>(null);
  const lastNavigationFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("baro-sidebar-collapsed") === "true");
    } catch {
      // A blocked preference store must not block navigation.
    }
    const desktop = window.matchMedia("(min-width: 1200px)");
    const mobile = window.matchMedia("(max-width: 767px)");
    const updateNavigationFocus = () => {
      // CSS can blur a disappearing rail control before the media-query event.
      const focused =
        document.activeElement === document.body
          ? lastNavigationFocus.current
          : document.activeElement;
      if (desktop.matches) {
        menuReturn.current = collapseButton.current;
        setOpen(false);
      } else if (menuReturn.current && !menuReturn.current.getClientRects().length) {
        menuReturn.current = mobileMenuButton.current;
      }
      if (
        focused instanceof HTMLElement &&
        navigationRoot.current?.contains(focused) &&
        !focused.getClientRects().length
      )
        (desktop.matches ? collapseButton.current : mobileMenuButton.current)?.focus();
    };
    const clearPointerFocus = (event: PointerEvent) => {
      if (event.target instanceof Node && !navigationRoot.current?.contains(event.target))
        lastNavigationFocus.current = null;
    };
    document.addEventListener("pointerdown", clearPointerFocus, true);
    desktop.addEventListener("change", updateNavigationFocus);
    mobile.addEventListener("change", updateNavigationFocus);
    return () => {
      document.removeEventListener("pointerdown", clearPointerFocus, true);
      desktop.removeEventListener("change", updateNavigationFocus);
      mobile.removeEventListener("change", updateNavigationFocus);
    };
  }, []);
  useEffect(() => {
    const frame = navigationRoot.current?.closest<HTMLElement>("[data-app-workspace]");
    if (frame) frame.dataset.sidebarCollapsed = String(collapsed);
  }, [collapsed]);
  function toggleSidebar() {
    setCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem("baro-sidebar-collapsed", String(next));
      } catch {
        // This is a display preference only; keep the control usable without storage.
      }
      return next;
    });
  }
  function openDrawer(opener: HTMLElement) {
    opener.focus();
    menuReturn.current = opener;
    setOpen(true);
  }
  const [session, setSession] = useState<SessionView | null>(null);
  const [recent, setRecent] = useState<CaseView[]>([]);
  const [recentState, setRecentState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [deletion, setDeletion] = useState<{ item: CaseView; ownerId: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState<{ item: CaseView; ownerId: string } | null>(null);
  const [caseTitle, setCaseTitle] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const renameLock = useRef(false);
  const deleteLock = useRef(false);
  const sessionRequest = useRef(0);
  const signingOutRef = useRef(false);
  useEffect(() => {
    let active = true;
    let owner: string | undefined;
    setReady(true);
    async function refresh() {
      if (signingOutRef.current) return;
      const ticket = ++sessionRequest.current;
      const current = () => active && ticket === sessionRequest.current;
      try {
        const next = await api.session.get();
        if (!current()) return;
        if (owner !== next.user?.id || next.needsConsent || !next.user) {
          setRecent([]);
          setRecentState("loading");
          setDeletion(null);
          setEditing(null);
        }
        owner = next.user?.id;
        setSession(next);
        if (!next.user || next.needsConsent) return;
        try {
          const items = await api.cases.list();
          if (current()) {
            setRecent([...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
            setRecentState("ready");
          }
        } catch {
          if (current()) {
            setRecent([]);
            setRecentState("error");
          }
        }
      } catch {
        if (!current()) return;
        owner = undefined;
        setRecent([]);
        setDeletion(null);
        setEditing(null);
        setSession({ user: null, needsConsent: false });
      }
    }
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const storage = (event: StorageEvent) => {
      if (
        !event.key ||
        ["baro-api-mock-v1:session", "baro-session-changed", "better-auth.message"].includes(
          event.key,
        )
      )
        void refresh();
    };
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", storage);
    window.addEventListener("baro-session-changed", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      ++sessionRequest.current;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", storage);
      window.removeEventListener("baro-session-changed", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  const resolvedRole: NavigationRole =
    session === null
      ? role
      : session.user
        ? session.user.accountType === "lawyer"
          ? "lawyer"
          : "user"
        : "visitor";
  const items = availableNavigation(resolvedRole, [
    ...availableRoutes,
    "/",
    "/app",
    "/login",
    "/cases",
    "/cases/new",
    "/lawyer",
    "/lawyers",
    "/settings",
  ]);
  async function signOut() {
    signingOutRef.current = true;
    ++sessionRequest.current;
    setRecent([]);
    setDeletion(null);
    setEditing(null);
    setSigningOut(true);
    setError("");
    try {
      await api.session.signOut();
      setRecent([]);
      window.location.assign("/login");
    } catch {
      signingOutRef.current = false;
      setError("로그아웃하지 못했어요. 다시 시도해 주세요.");
      setSigningOut(false);
    }
  }
  async function deleteRecent() {
    if (!deletion || deleteLock.current) return;
    const target = deletion;
    deleteLock.current = true;
    setDeleting(true);
    setError("");
    const sameOwner = async () => {
      const fresh = await api.session.get();
      if (fresh.user?.id !== target.ownerId) {
        setDeletion(null);
        setRecent([]);
        throw new Error("계정이 변경됐어요. 현재 계정의 사건을 다시 확인해 주세요.");
      }
    };
    try {
      await sameOwner();
      await api.account.deleteCase(target.item.id, "DELETE", target.item.schemaVersion ?? "2");
      await sameOwner();
      setRecent((items) => items.filter((item) => item.id !== target.item.id));
      setDeletion(null);
      window.location.assign("/app");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "삭제를 접수하지 못했어요. 다시 확인해 주세요.",
      );
    } finally {
      deleteLock.current = false;
      setDeleting(false);
    }
  }
  async function renameRecent() {
    if (!editing || renameLock.current || !caseTitle.trim()) return;
    const target = editing;
    renameLock.current = true;
    setRenaming(true);
    setRenameError("");
    const sameOwner = async () => {
      const fresh = await api.session.get();
      if (fresh.user?.id !== target.ownerId || fresh.needsConsent) {
        setEditing(null);
        setRecent([]);
        throw new Error("현재 계정의 사건을 다시 확인해 주세요.");
      }
    };
    try {
      await sameOwner();
      const next = await api.cases.rename(target.item.id, {
        title: caseTitle,
        expectedTitle: target.item.title,
      });
      await sameOwner();
      setRecent((items) => items.map((item) => (item.id === next.id ? next : item)));
      setEditing(null);
      window.dispatchEvent(new CustomEvent("baro-case-title-changed", { detail: { id: next.id } }));
    } catch (cause) {
      setRenameError(
        cause instanceof Error ? cause.message : "제목을 저장하지 못했어요. 다시 시도해 주세요.",
      );
      if ((cause as { code?: string })?.code === "CONFLICT") {
        try {
          await sameOwner();
          const next = await api.cases.get(target.item.id);
          await sameOwner();
          setEditing((value) => (value?.item.id === next.id ? { ...value, item: next } : value));
        } catch {
          /* Keep the entered title for an explicit retry. */
        }
      }
    } finally {
      renameLock.current = false;
      setRenaming(false);
    }
  }
  const renderLinks = () =>
    items.map((item) => {
      const Icon = icons[item.icon];
      const active =
        pathname === item.href ||
        (item.href === "/app" && pathname === "/cases/new") ||
        (item.href === "/cases" && pathname.startsWith("/cases/") && pathname !== "/cases/new");
      return (
        <a
          className={`app-nav__link${item.icon === "new" ? " app-nav__link--new" : ""}`}
          key={item.href}
          href={item.href}
          aria-current={active ? "page" : undefined}
          aria-label={item.label}
          title={item.label}
        >
          <Icon aria-hidden="true" size={19} strokeWidth={1.65} />
          <span>{item.label}</span>
        </a>
      );
    });
  const renderRecent = () =>
    (resolvedRole === "user" || resolvedRole === "lawyer") &&
    !session?.needsConsent && (
      <div className="sidebar-recent">
        <h2 className="sr-only">최근 사건</h2>
        <section
          className="sidebar-recent__list"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the bounded recent list.
          tabIndex={0}
          aria-label="최근 사건 목록"
        >
          {recentState === "loading" ? (
            <LoadingContent title="최근 사건을 불러오는 중" />
          ) : recentState === "error" ? (
            <p className="sidebar-empty" role="status">
              사건을 불러오지 못했어요.
              <Button variant="ghost" onClick={() => window.dispatchEvent(new Event("focus"))}>
                다시 불러오기
              </Button>
            </p>
          ) : recent.length ? (
            <nav aria-label="최근 사건">
              {recent.map((item) => (
                <div className="sidebar-story-row" key={item.id}>
                  <a
                    href={caseLink(item)}
                    title={item.title}
                    className="sidebar-story"
                    aria-current={
                      pathname === `/cases/${encodeURIComponent(item.id)}` ||
                      pathname.startsWith(`/cases/${encodeURIComponent(item.id)}/`)
                        ? "page"
                        : undefined
                    }
                  >
                    <span className="sidebar-story__copy">
                      <strong>{item.title}</strong>
                    </span>
                  </a>
                  <div className="sidebar-story-actions">
                    {item.schemaVersion !== "1" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="sidebar-story-edit"
                        aria-label={`${item.title} 제목 수정`}
                        title="제목 수정"
                        disabled={deleting || renaming || signingOut}
                        onClick={(event) => {
                          event.currentTarget.focus();
                          if (!session?.user) return;
                          setRenameError("");
                          setCaseTitle(item.title);
                          setEditing({ item, ownerId: session.user.id });
                        }}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="sidebar-story-delete"
                      aria-label={`${item.title} 사건 삭제`}
                      title="사건 삭제"
                      disabled={deleting || renaming || signingOut}
                      onClick={(event) => {
                        event.currentTarget.focus();
                        setError("");
                        if (session?.user) setDeletion({ item, ownerId: session.user.id });
                      }}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
            </nav>
          ) : (
            <div className="sidebar-empty">
              <MessageCircle size={20} aria-hidden="true" />
              <p>
                아직 사건이 없어요.
                <br />새 사건을 만들면 여기에 표시돼요.
              </p>
            </div>
          )}
        </section>
      </div>
    );
  const renderAccount = () => (
    <div className="sidebar-account">
      {session?.user && !session.needsConsent && (
        <a
          href="/settings"
          className="app-nav__link sidebar-settings"
          aria-label="설정"
          title="설정"
          aria-current={pathname === "/settings" ? "page" : undefined}
        >
          <Settings size={18} aria-hidden="true" />
          <span>설정</span>
        </a>
      )}
      {session?.user ? (
        <div className="sidebar-account__row">
          <a
            href={session.needsConsent ? "/consent" : "/settings"}
            className="sidebar-profile"
            aria-label={`${session.user.name || "내 계정"} · 계정 관리`}
            title="계정 관리"
          >
            <span className="sidebar-avatar" aria-hidden="true">
              {session.user.name.slice(0, 1) || "B"}
            </span>
            <span>
              <strong>{session.user.name || "내 계정"}</strong>
              <small>
                {session.needsConsent
                  ? "필수 확인 필요"
                  : session.user.accountType === "lawyer"
                    ? "변호사 계정"
                    : "나의 BARO"}
              </small>
            </span>
          </a>
          <Button
            variant="ghost"
            size="icon"
            aria-label={signingOut ? "로그아웃 중…" : "로그아웃"}
            title="로그아웃"
            onClick={() => void signOut()}
            disabled={signingOut}
          >
            {signingOut ? <Spinner /> : <LogOut size={18} aria-hidden="true" />}
          </Button>
        </div>
      ) : (
        (showLogin || session !== null) && (
          <a className="ui-button ui-button--primary sidebar-login" href="/login">
            로그인하고 시작하기
          </a>
        )
      )}
      {apiMode === "mock" && (
        <p className="api-mode-notice">
          <span aria-hidden="true" />
          API 예시 모드 · 합성 데이터
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
  return (
    <>
      <header
        ref={navigationRoot}
        className="app-header"
        data-collapsed={collapsed}
        onFocusCapture={(event) => {
          if (event.target instanceof HTMLElement) lastNavigationFocus.current = event.target;
        }}
        onBlurCapture={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            !event.currentTarget.contains(event.relatedTarget)
          )
            lastNavigationFocus.current = null;
        }}
      >
        <div className="app-header__inner">
          <Brand href={session?.user ? roleStart(session) : "/"} />
          <Button
            ref={collapseButton}
            className="sidebar-collapse"
            variant="ghost"
            size="icon"
            aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            aria-expanded={!collapsed}
            aria-controls="app-desktop-navigation"
            title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            onClick={toggleSidebar}
          >
            {collapsed ? (
              <PanelLeftOpen size={19} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={19} aria-hidden="true" />
            )}
          </Button>
          {apiMode === "mock" && <span className="mobile-mode">API 예시</span>}
          <Button
            ref={mobileMenuButton}
            className="app-menu-trigger"
            variant="ghost"
            size="icon"
            aria-label="메뉴 열기"
            aria-expanded={open}
            aria-haspopup="dialog"
            disabled={!ready}
            onClick={(event) => {
              // Pointer activation does not always focus the button before the sheet opens.
              openDrawer(event.currentTarget);
            }}
          >
            <Menu aria-hidden="true" size={22} />
          </Button>
        </div>
        <div className="sidebar-desktop" id="app-desktop-navigation">
          <nav className="app-nav app-nav--desktop" aria-label="주 메뉴">
            {renderLinks()}
          </nav>
          <Button
            className="sidebar-history-trigger"
            variant="ghost"
            size="icon"
            aria-label="최근 사건 열기"
            title="최근 사건 열기"
            onClick={(event) => openDrawer(event.currentTarget)}
          >
            <History size={19} aria-hidden="true" />
          </Button>
          {renderRecent()}
          {renderAccount()}
        </div>
      </header>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="메뉴"
        description="사건을 시작하거나 이어서 정리하세요."
        returnFocusRef={menuReturn}
      >
        <Brand href={session?.user ? roleStart(session) : "/"} />
        <nav className="app-nav app-nav--mobile" aria-label="모바일 주 메뉴">
          {renderLinks()}
        </nav>
        {renderRecent()}
        {renderAccount()}
      </Sheet>
      <Dialog
        open={!!editing}
        onOpenChange={(value) => {
          if (!value && !renaming) setEditing(null);
        }}
        title="사건 제목 수정"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void renameRecent();
          }}
        >
          <label className="sidebar-title-field">
            제목
            <input
              autoFocus
              value={caseTitle}
              maxLength={40}
              required
              disabled={renaming}
              onChange={(event) => setCaseTitle(event.target.value)}
            />
          </label>
          {renameError && (
            <p className="sidebar-title-error" role="alert">
              {renameError}
            </p>
          )}
          <div className="sidebar-title-actions">
            <Button variant="outline" disabled={renaming} onClick={() => setEditing(null)}>
              취소
            </Button>
            <Button
              type="submit"
              loading={renaming}
              disabled={
                !editing || renaming || !caseTitle.trim() || caseTitle.trim() === editing.item.title
              }
            >
              저장
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={Boolean(deletion)}
        onOpenChange={(value) => {
          if (!value && !deleting) setDeletion(null);
        }}
        title="이 사건을 삭제할까요?"
        description="삭제하면 이 사건과 연결된 자료·리포트에 접근할 수 없어요. 필요한 파일은 먼저 보관해 주세요."
      >
        {error && <p role="alert">{error}</p>}
        <div className="deletion-dialog-actions">
          <Button
            variant="destructive"
            loading={deleting}
            disabled={!deletion || deleting}
            onClick={() => void deleteRecent()}
          >
            {deleting ? "삭제 접수 중…" : "사건 삭제"}
          </Button>
          <Button variant="outline" autoFocus disabled={deleting} onClick={() => setDeletion(null)}>
            취소
          </Button>
        </div>
      </Dialog>
    </>
  );
}
