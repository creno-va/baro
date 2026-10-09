import type { AccountType, SessionView } from "./api/types";

/** Only application routes, never arbitrary URLs, survive authentication. */
export function safeReturnPath(
  value: string | null | undefined,
  role?: AccountType,
): string | null {
  if (!value || value.length > 500 || /[%\\\\\s?#]/.test(value)) return null;
  const customer =
    /^\/(app|cases(?:\/(?:new|[A-Za-z0-9_-]+(?:\/(?:intake|summary|files|timeline|actions|reports))?))?)\/?$/.test(
      value,
    );
  const lawyer = value === "/lawyer" || value === "/lawyer/";
  const common = value === "/settings";
  if (role === "lawyer" && customer) return null;
  if (role === "customer" && lawyer) return null;
  return customer || lawyer || common ? value : null;
}
export function returnPathFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return safeReturnPath(new URLSearchParams(window.location.search).get("returnTo"));
}
export function accessHref(page: "login" | "consent", path?: string): string {
  const target = safeReturnPath(
    path ?? (typeof window !== "undefined" ? window.location.pathname : ""),
  );
  return `/${page}${target ? `?returnTo=${encodeURIComponent(target)}` : ""}`;
}
export function sessionDestination(
  session: SessionView,
  target = returnPathFromLocation(),
): string {
  const allowed = safeReturnPath(target, session.user?.accountType);
  if (!session.user) return accessHref("login", allowed ?? undefined);
  if (session.needsConsent) return accessHref("consent", allowed ?? undefined);
  return allowed ?? (session.user.accountType === "lawyer" ? "/lawyer" : "/app");
}
