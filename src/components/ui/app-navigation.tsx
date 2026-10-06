import {
  BriefcaseBusiness,
  FileText,
  House,
  Menu,
  Plus,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { SessionView } from "../../client/api";
import { api, apiMode } from "../../client/api";
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
    { href: "/", label: "홈", icon: "home" },
    { href: "/lawyers", label: "변호사 찾기", icon: "lawyers" },
  ],
  user: [
    { href: "/cases", label: "내 사건", icon: "cases" },
    { href: "/cases/new", label: "새 사건 입력", icon: "new" },
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
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    api.session
      .get()
      .then(setSession)
      .catch(() => setSession({ user: null, needsConsent: false }));
  }, []);
  const resolvedRole = session?.user
    ? session.user.accountType === "lawyer"
      ? "lawyer"
      : "user"
    : role;
  const items = availableNavigation(resolvedRole, [
    ...availableRoutes,
    "/",
    "/cases",
    "/cases/new",
    "/lawyer",
    "/lawyers",
    "/settings",
  ]);
  async function signOut() {
    setSigningOut(true);
    setError("");
    try {
      await api.session.signOut();
      window.location.assign("/login");
    } catch {
      setError("로그아웃하지 못했어요. 다시 시도해 주세요.");
      setSigningOut(false);
    }
  }
  const renderLinks = () =>
    items.map((item) => {
      const Icon = icons[item.icon];
      const active =
        pathname === item.href ||
        (item.href === "/cases" && pathname.startsWith("/cases/") && pathname !== "/cases/new");
      return (
        <a
          className="app-nav__link"
          key={item.href}
          href={item.href}
          aria-current={active ? "page" : undefined}
        >
          <Icon aria-hidden="true" size={18} strokeWidth={1.75} />
          <span>{item.label}</span>
        </a>
      );
    });
  return (
    <header className="app-header">
      {apiMode === "mock" && (
        <div className="api-mode-notice">
          API 예시 응답으로 보기 · 합성 데이터로 이용 흐름을 확인하세요.
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="app-header__inner">
        <Brand />
        <nav className="app-nav app-nav--desktop" aria-label="주 메뉴">
          {renderLinks()}
        </nav>
        <div className="app-header__actions">
          {session?.user ? (
            <Button variant="outline" onClick={() => void signOut()} disabled={signingOut}>
              {signingOut ? "로그아웃 중…" : "로그아웃"}
            </Button>
          ) : (
            (showLogin || session !== null) && (
              <a className="ui-button ui-button--primary" href="/login">
                로그인
              </a>
            )
          )}
          <Button
            className="app-menu-trigger"
            variant="outline"
            size="icon"
            aria-label="메뉴 열기"
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          >
            <Menu aria-hidden="true" size={20} />
          </Button>
        </div>
      </div>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="메뉴"
        description="이용할 화면을 선택해 주세요."
      >
        <Brand />
        <nav className="app-nav app-nav--mobile" aria-label="모바일 주 메뉴">
          {renderLinks()}
          {showLogin && (
            <a className="app-nav__link" href="/login">
              로그인
            </a>
          )}
        </nav>
      </Sheet>
    </header>
  );
}
