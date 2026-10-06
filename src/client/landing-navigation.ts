/** Native modal navigation keeps focus and background interaction inside the open menu. */
const navigationDialog = document.querySelector<HTMLDialogElement>("[data-landing-menu-dialog]");
const navigationTrigger = document.querySelector<HTMLButtonElement>("[data-landing-menu-trigger]");
const navigationFallback = document.querySelector<HTMLDetailsElement>("[data-landing-menu]");
const navigationPanel = document.querySelector<HTMLElement>("[data-landing-menu-panel]");

if (navigationDialog && navigationTrigger && navigationFallback && navigationPanel) {
  const dialog = navigationDialog;
  const trigger = navigationTrigger;
  const fallback = navigationFallback;
  const panel = navigationPanel;
  const dismiss = dialog.querySelector<HTMLButtonElement>("[data-landing-menu-dismiss]");
  const mobile = window.matchMedia("(max-width: 1023px)");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let closeTimer = 0;

  function finishClose(restoreFocus = false) {
    window.clearTimeout(closeTimer);
    closeTimer = 0;
    dialog.classList.remove("is-closing");
    dialog.close();
    trigger.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("landing-menu-is-open");
    if (restoreFocus && mobile.matches) trigger.focus({ preventScroll: true });
  }

  function close() {
    if (!dialog.open || closeTimer) return;
    if (reduced.matches) finishClose(true);
    else {
      dialog.classList.add("is-closing");
      closeTimer = window.setTimeout(() => finishClose(true), 180);
    }
  }

  function open() {
    if (!mobile.matches || dialog.open) return;
    dialog.showModal();
    panel.scrollTop = 0;
    trigger.setAttribute("aria-expanded", "true");
    document.documentElement.classList.add("landing-menu-is-open");
    dismiss?.focus({ preventScroll: true });
  }

  // Move the existing links, so the same navigation also works without JavaScript.
  if (typeof dialog.showModal === "function") {
    dialog.appendChild(panel);
    fallback.open = false;
    fallback.hidden = true;
    trigger.hidden = false;
    trigger.addEventListener("click", open);
    dismiss?.addEventListener("click", close);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener("close", () => {
      if (dialog.open) return;
      trigger.setAttribute("aria-expanded", "false");
      document.documentElement.classList.remove("landing-menu-is-open");
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const controls = [
        ...dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
      ].filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    });
    panel.addEventListener("click", (event) => {
      if (!(event.target instanceof Element) || !event.target.closest("a[href]")) return;
      // Unlock before the anchor's native action; never restore an old scroll position over it.
      finishClose();
    });
    mobile.addEventListener("change", () => {
      if (!mobile.matches && dialog.open) {
        finishClose();
        document
          .querySelector<HTMLElement>(".landing-header .brand")
          ?.focus({ preventScroll: true });
      }
    });
    window.addEventListener("pagehide", () => finishClose());
  }
}

export {};
