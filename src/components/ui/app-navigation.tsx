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
import { useState } from "react";
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
  const items = availableNavigation(role, availableRoutes);
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
      <div className="app-header__inner">
        <Brand />
        <nav className="app-nav app-nav--desktop" aria-label="주 메뉴">
          {renderLinks()}
        </nav>
        <div className="app-header__actions">
          {showLogin && (
            <a className="ui-button ui-button--primary" href="/login">
              로그인
            </a>
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
