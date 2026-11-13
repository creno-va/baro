export type ThemePreference = "system" | "light" | "dark";
const key = "baro-theme";
let memory: ThemePreference | null = null;
let paletteChange = 0;
export function themePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const value = localStorage.getItem(key);
    return value === "light" || value === "dark" ? value : (memory ?? "system");
  } catch {
    return memory ?? "system";
  }
}
export function applyTheme(preference: ThemePreference) {
  if (!document.documentElement.hasAttribute("data-baro-ui")) return;
  const dark =
    preference === "dark" ||
    (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  const theme = dark ? "dark" : "light";
  if (root.dataset.theme !== theme) {
    const change = ++paletteChange;
    root.dataset.themeSwitching = "";
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (change === paletteChange) delete root.dataset.themeSwitching;
      }),
    );
  }
  root.dataset.theme = theme;
  document.documentElement.dataset.themePreference = preference;
  window.dispatchEvent(new Event("baro-theme-changed"));
}
export function setTheme(preference: ThemePreference) {
  memory = preference;
  try {
    localStorage.setItem(key, preference);
  } catch {
    /* The current page still supports the preference. */
  }
  applyTheme(preference);
}
export function subscribeTheme(callback: () => void) {
  const query = matchMedia("(prefers-color-scheme: dark)");
  const update = () => {
    applyTheme(themePreference());
    callback();
  };
  const storage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) {
      memory = null;
      update();
    }
  };
  window.addEventListener("baro-theme-changed", callback);
  window.addEventListener("storage", storage);
  query.addEventListener("change", update);
  return () => {
    window.removeEventListener("baro-theme-changed", callback);
    window.removeEventListener("storage", storage);
    query.removeEventListener("change", update);
  };
}
