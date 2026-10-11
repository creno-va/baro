type SessionChangeReason = "changed" | "signout";

/** Invalidation only: no session, identity, role or token is shared between tabs. */
export function notifySessionChanged(reason: SessionChangeReason = "changed") {
  try {
    const id = crypto.randomUUID();
    localStorage.setItem(
      "baro-session-changed",
      reason === "signout" ? JSON.stringify({ id, reason }) : id,
    );
  } catch {
    // Same-tab invalidation still works when optional cross-tab storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent("baro-session-changed", { detail: { reason } }));
}

/** Untrusted notifications can revoke local access, never grant it. */
export function isExplicitSignOut(event: Event): boolean {
  if (event.type === "baro-session-changed")
    return (event as CustomEvent<{ reason?: unknown }>).detail?.reason === "signout";
  if (event.type !== "storage") return false;
  const { key, newValue } = event as StorageEvent;
  if (key !== "baro-session-changed" && key !== "better-auth.message") return false;
  try {
    const message = JSON.parse(newValue ?? "null");
    return key === "baro-session-changed"
      ? message?.reason === "signout"
      : message?.event === "session" && message?.data?.trigger === "signout";
  } catch {
    return false;
  }
}
