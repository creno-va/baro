import { type RefObject, useEffect, useRef } from "react";

/** Explicit return refs can change when the responsive opener disappears. Keep
 * the existing deferred return behavior while respecting a newer focus action. */
export function useNavigationReturnFocus(
  open: boolean,
  destination: RefObject<HTMLElement | null>,
) {
  const previous = useRef(open);
  useEffect(() => {
    const closed = previous.current && !open;
    previous.current = open;
    if (!closed) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      const settled = document.activeElement;
      second = requestAnimationFrame(() => {
        const target = destination.current;
        const active = document.activeElement;
        if (
          active !== settled &&
          active !== target &&
          active instanceof HTMLElement &&
          active !== document.body &&
          active !== document.documentElement &&
          active.isConnected &&
          !active.closest("[hidden], [inert]")
        )
          return;
        if (
          target?.isConnected &&
          !target.closest("[hidden], [inert]") &&
          target.getClientRects().length
        )
          target.focus({ preventScroll: true });
      });
    });
    return () => {
      cancelAnimationFrame(first);
      if (second) cancelAnimationFrame(second);
    };
  }, [open, destination]);
}
