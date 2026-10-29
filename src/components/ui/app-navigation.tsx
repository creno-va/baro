import {
  BriefcaseBusiness,
  FileText,
  House,
  LogOut,
  Menu,
  MessageCircle,
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
  const [session, setSession] = useState<SessionView | null>(null);
  const [recent, setRecent] = useState<CaseView[]>([]);
  const [recentState, setRecentState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [deletion, setDeletion] = useState<{ item: CaseView; ownerId: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
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
        <section
          className="sidebar-recent__list"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the bounded recent list.
          tabIndex={0}
          aria-label="최근 이야기 목록"
        >
          {recentState === "loading" ? (
            <LoadingContent title="최근 이야기를 불러오는 중" />
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="sidebar-story-delete"
                    aria-label={`${item.title} 사건 삭제`}
                    title="사건 삭제"
                    disabled={deleting || signingOut}
                    onClick={(event) => {
                      event.currentTarget.focus();
                      setError("");
                      if (session?.user) setDeletion({ item, ownerId: session.user.id });
                    }}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </nav>
          ) : (
            <div className="sidebar-empty">
              <MessageCircle size={20} aria-hidden="true" />
              <p>
                나누던 이야기는 여기에.
                <br />
                언제든 이어서 정리할 수 있어요.
              </p>
            </div>
          )}
        </section>
      </div>
    );
  const renderAccount = () => (
    <div className="sidebar-account">
      {session?.user ? (
        <div className="sidebar-account__row">
          <a href={session.needsConsent ? "/consent" : "/settings"} className="sidebar-profile">
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
      <header className="app-header">
        <div className="app-header__inner">
          <Brand href={session?.user ? roleStart(session) : "/"} />
          <span className="mobile-caption">생각이 정리되는 곳</span>
          {apiMode === "mock" && <span className="mobile-mode">API 예시</span>}
          <Button
            className="app-menu-trigger"
            variant="ghost"
            size="icon"
            aria-label="메뉴 열기"
            aria-expanded={open}
            aria-haspopup="dialog"
            disabled={!ready}
            onClick={(event) => {
              // Pointer activation does not always focus the button before the sheet opens.
              event.currentTarget.focus();
              setOpen(true);
            }}
          >
            <Menu aria-hidden="true" size={22} />
          </Button>
        </div>
        <div className="sidebar-desktop">
          <nav className="app-nav app-nav--desktop" aria-label="주 메뉴">
            {renderLinks()}
          </nav>
          {renderRecent()}
          {renderAccount()}
        </div>
      </header>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="메뉴"
        description="이야기를 시작하거나 이어가세요."
      >
        <Brand href={session?.user ? roleStart(session) : "/"} />
        <nav className="app-nav app-nav--mobile" aria-label="모바일 주 메뉴">
          {renderLinks()}
        </nav>
        {renderRecent()}
        {renderAccount()}
      </Sheet>
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
