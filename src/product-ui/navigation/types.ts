import type { CaseView } from "../../client/api/types";

export type NavigationRole = "visitor" | "user" | "lawyer" | "moderator";
export interface NavigationItem {
  href: string;
  label: string;
  icon: "home" | "cases" | "new" | "lawyers" | "profile" | "reviews" | "settings";
}
export interface AppNavigationProps {
  role?: NavigationRole;
  pathname?: string;
  availableRoutes: readonly string[];
  showLogin?: boolean;
  appearance?: "default" | "workbench";
}
export const ROLE_NAVIGATION: Record<NavigationRole, readonly NavigationItem[]> = {
  visitor: [
    { href: "/", label: "서비스 소개", icon: "home" },
    { href: "/login", label: "이야기 시작하기", icon: "new" },
  ],
  user: [{ href: "/new", label: "새 사건 입력", icon: "new" }],
  lawyer: [{ href: "/new", label: "새 사건 입력", icon: "new" }],
  moderator: [{ href: "/admin/reviews", label: "검토 대기", icon: "reviews" }],
};
export function availableNavigation(role: NavigationRole, availableRoutes: readonly string[]) {
  return ROLE_NAVIGATION[role].filter((item) => availableRoutes.includes(item.href));
}
export function caseLink(item: CaseView) {
  const base = `/cases/${encodeURIComponent(item.id)}`;
  return item.schemaVersion === "1" || item.stage === "active" || item.stage === "archived"
    ? base
    : `${base}/${item.stage}`;
}
export function navigationActive(item: NavigationItem, pathname: string) {
  return (
    pathname === item.href ||
    (item.href === "/new" && pathname === "/cases/new") ||
    (item.href === "/cases" && pathname.startsWith("/cases/") && pathname !== "/cases/new")
  );
}
