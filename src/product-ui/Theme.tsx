import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import { useProductUI } from "./Provider";

type ResolvedTheme = "light" | "dark";
const ProductThemeContext = createContext<ResolvedTheme>("light");
const serverDark = () => false;
const clientDark = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

function subscribeSystemTheme(callback: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

/** Scope colors to this island and carry the resolved theme across portals.
 * The server snapshot is stable; browser preferences are read after hydration. */
export function ProductTheme({ children, className }: { children: ReactNode; className?: string }) {
  const preference = useProductUI((state) => state.theme);
  const systemDark = useSyncExternalStore(subscribeSystemTheme, clientDark, serverDark);
  const theme = preference === "system" ? (systemDark ? "dark" : "light") : preference;
  return (
    <ProductThemeContext.Provider value={theme}>
      <div data-product-ui="" data-theme={theme} className={className}>
        {children}
      </div>
    </ProductThemeContext.Provider>
  );
}

export function useProductTheme() {
  return useContext(ProductThemeContext);
}
