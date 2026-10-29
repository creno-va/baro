/** Track keyboard navigation separately from pointer interaction and text editing. */
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
      if (event.key !== "Tab") {
        if (
          ![
            "Enter",
            " ",
            "Escape",
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "Home",
            "End",
            "PageUp",
            "PageDown",
          ].includes(event.key) ||
          (event.target instanceof Element &&
            event.target.closest(
              'textarea, input:not([type="radio"]):not([type="checkbox"]), [contenteditable]:not([contenteditable="false"])',
            ))
        )
          return;
      }
      root.dataset.focusInput = "keyboard";
    },
    true,
  );
}
