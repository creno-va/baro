import { useCallback, useEffect, useRef, useState } from "react";

/** Stage a real response briefly; never delay requests or replace the user's draft. */
export function useSceneTransition() {
  const [leaving, setLeaving] = useState(false);
  const mounted = useRef(false);
  const pending = useRef<{ timer: number; finish: (ready: boolean) => void } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pending.current) {
        window.clearTimeout(pending.current.timer);
        pending.current.finish(false);
        pending.current = null;
      }
    };
  }, []);
  const transition = useCallback(async (commit: () => void, current: () => boolean) => {
    if (!mounted.current || !current()) return;
    if (pending.current) {
      window.clearTimeout(pending.current.timer);
      pending.current.finish(false);
      pending.current = null;
    }
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setLeaving(true);
      const ready = await new Promise<boolean>((finish) => {
        const timer = window.setTimeout(() => {
          pending.current = null;
          finish(true);
        }, 160);
        pending.current = { timer, finish };
      });
      if (!ready) return;
    }
    if (mounted.current) {
      if (current()) commit();
      setLeaving(false);
    }
  }, []);
  return { leaving, transition };
}
