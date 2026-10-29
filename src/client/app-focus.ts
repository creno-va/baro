/** Native dialog autofocus can inherit focus-visible after a pointer activation. */
export function installAppFocus(document: Document) {
  const root = document.documentElement;
  if (root.dataset.focusInput) return;
  root.dataset.focusInput = "pointer";
  document.addEventListener(
    "pointerdown",
    () => {
      root.dataset.focusInput = "pointer";
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        ["Shift", "Control", "Alt", "Meta"].includes(event.key)
      )
        return;
      root.dataset.focusInput = "keyboard";
    },
    true,
  );
}
