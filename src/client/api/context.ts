import { createSessionScope } from "@baro/client-core";

export const browserSessionScope = createSessionScope();
if (typeof window !== "undefined") {
  window.addEventListener("baro-session-changed", () => browserSessionScope.invalidate());
  window.addEventListener("storage", (event) => {
    if (
      event.key === null ||
      event.key === "baro-session-changed" ||
      event.key === "better-auth.message"
    )
      browserSessionScope.invalidate();
  });
}
