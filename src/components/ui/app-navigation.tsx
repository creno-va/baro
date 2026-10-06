import {
  BriefcaseBusiness,
  CircleHelp,
  FileText,
  House,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CaseView, SessionView } from "../../client/api";
import { api, apiMode, roleStart } from "../../client/api";
import { Brand } from "./brand";
import { Button } from "./button";
import { Sheet } from "./dialog";

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
    { href: "/cases", label: "내 사건", icon: "cases" },
    { href: "/lawyers", label: "변호사 찾기", icon: "lawyers" },
    { href: "/settings", label: "계정 설정", icon: "settings" },
  ],
  lawyer: [
    { href: "/lawyer", label: "변호사 프로필", icon: "profile" },
    { href: "/lawyers", label: "공개 디렉터리", icon: "lawyers" },
    { href: "/settings", label: "계정 설정", icon: "settings" },
  ],
  moderator: [
    { href: "/admin/reviews", label: "검토 대기", icon: "reviews" },
    { href: "/settings", label: "계정 설정", icon: "settings" },
  ],
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
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
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
        if (owner !== next.user?.id || next.needsConsent || next.user?.accountType !== "customer") {
          setRecent([]);
        }
        owner = next.user?.id;
        setSession(next);
        if (next.user?.accountType !== "customer" || next.needsConsent) return;
        try {
          const items = await api.cases.list();
          if (current())
            setRecent(
              [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5),
            );
        } catch {
          if (current()) setRecent([]);
        }
      } catch {
        if (!current()) return;
        owner = undefined;
        setRecent([]);
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
    resolvedRole === "user" && (
      <div className="sidebar-recent">
        <p className="sidebar-caption">최근 이야기</p>
        {recent.length ? (
          <nav aria-label="최근 사건">
            {recent.map((item) => (
              <a key={item.id} href={caseLink(item)} title={item.title}>
                <MessageCircle size={16} aria-hidden="true" />
                <span>{item.title}</span>
              </a>
            ))}
          </nav>
        ) : (
          <p className="sidebar-empty">여기서 이야기를 이어갈 수 있어요.</p>
        )}
      </div>
    );
  const renderAccount = () => (
    <div className="sidebar-account">
      <a href="/help" className="sidebar-help">
        <CircleHelp size={17} aria-hidden="true" />
        도움말
      </a>
      {session?.user ? (
        <>
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
              <LogOut size={18} aria-hidden="true" />
            </Button>
          </div>
          <a href="/login" className="sidebar-help">
            이용 유형 변경
          </a>
        </>
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
            onClick={() => setOpen(true)}
          >
            <Menu aria-hidden="true" size={22} />
          </Button>
        </div>
        <div className="sidebar-desktop">
          <nav className="app-nav app-nav--desktop" aria-label="주 메뉴">
            {renderLinks()}
          </nav>
          {renderRecent()}
          <div className="sidebar-note">
            <span>조금 더 가벼운 마음으로.</span>
            <p>
              복잡한 일의 시작부터
              <br />
              BARO가 함께 정리해요.
            </p>
          </div>
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
    </>
  );
}
