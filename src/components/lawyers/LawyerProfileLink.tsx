import { useEffect, useState } from "react";
import { api } from "../../client/api";

export function LawyerProfileLink({ children }: { children: string }) {
  const [lawyer, setLawyer] = useState(false);
  useEffect(() => {
    let active = true;
    let request = 0;
    const refresh = async () => {
      const ticket = ++request;
      setLawyer(false);
      try {
        const session = await api.session.get();
        if (active && ticket === request) setLawyer(session.user?.accountType === "lawyer");
      } catch {
        // A profile entry is only shown after a successful role check.
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("baro-session-changed", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      ++request;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("baro-session-changed", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return lawyer ? <a href="/lawyer">{children}</a> : null;
}
