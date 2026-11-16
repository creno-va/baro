import { type ReactNode, useSyncExternalStore } from "react";
import { subscribeTheme } from "../client/theme";
import { ProductThemeScope } from "./Theme";

const serverTheme = () => "light" as const;
function resolvedTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Existing product preferences and system/cross-tab updates remain authoritative.
 * Context follows that resolved palette through Headless UI portals. */
export function GlobalProductTheme({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const theme = useSyncExternalStore(subscribeTheme, resolvedTheme, serverTheme);
  return (
    <ProductThemeScope theme={theme} {...(className ? { className } : {})}>
      {children}
    </ProductThemeScope>
  );
}
