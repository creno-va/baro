/** Native scrolling compares two aligned portraits; explicit buttons work with pointer or keyboard. */
for (const root of document.querySelectorAll<HTMLElement>("[data-ceo-greeting]")) {
  const scrollStage = root.querySelector<HTMLElement>("[data-ceo-scroll]");
  const visual = root.querySelector<HTMLElement>("[data-ceo-visual]");
  const letter = root.querySelector<HTMLElement>("[data-ceo-letter]");
  const controls = [...root.querySelectorAll<HTMLElement>("[data-ceo-controls]")];
  const live = root.querySelector<HTMLElement>("[data-ceo-live]");
  if (!scrollStage || !visual) continue;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const compact = window.matchMedia("(max-width: 767px)");
  const photos = [...root.querySelectorAll<HTMLElement>("[data-ceo-photo]")];
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("[data-ceo-show]")];
  const messages = [...root.querySelectorAll<HTMLElement>("[data-ceo-message]")];
  const summaries = [...root.querySelectorAll<HTMLElement>("[data-ceo-summary]")];
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  let enabled = false;
  let frame = 0;
  let manual: number | undefined;
  let manualScrollY = 0;
  let selected = "";
  let currentBlend = 0;

  function setBlend(value: number) {
    currentBlend = value;
    root.style.setProperty("--ceo-blend", value.toFixed(4));
    const next = value >= 0.5 ? "crenova" : "suit";
    if (selected === next) return;
    selected = next;
    for (const button of buttons)
      button.setAttribute("aria-pressed", String(button.dataset.ceoShow === next));
    for (const photo of photos)
      photo.setAttribute("aria-hidden", String(photo.dataset.ceoPhoto !== next));
    for (const message of messages) {
      const inactive = message.dataset.ceoMessage !== next;
      message.setAttribute("aria-hidden", String(inactive));
      message.inert = inactive;
    }
    for (const summary of summaries) summary.hidden = summary.dataset.ceoSummary !== next;
  }

  function render() {
    frame = 0;
    if (!enabled || !scrollStage || !visual) return;
    if (manual !== undefined) {
      setBlend(manual);
      return;
    }
    const bounds = scrollStage.getBoundingClientRect();
    if (bounds.top > window.innerHeight || bounds.bottom < 0) return;
    const top = Number.parseFloat(getComputedStyle(visual).top) || 0;
    const distance = Math.max(1, scrollStage.offsetHeight - visual.offsetHeight);
    const progress = clamp((top - bounds.top) / distance);
    const blend = clamp((progress - 0.15) / 0.65);
    setBlend(blend * blend * (3 - 2 * blend));
  }

  function schedule() {
    if (enabled && !frame) frame = window.requestAnimationFrame(render);
  }

  function configure() {
    if (!visual) return;
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    manual = undefined;
    selected = "";
    root.classList.add("ceo-interactive");
    for (const control of controls) control.hidden = false;
    enabled = !reduced.matches && window.innerHeight >= 480;
    root.classList.toggle("ceo-motion-ready", enabled);
    if (enabled) {
      const top = Number.parseFloat(getComputedStyle(visual).top) || 0;
      // If text is enlarged, keep every comparison control in the normal document flow.
      enabled = visual.offsetHeight <= window.innerHeight - top - 8;
      root.classList.toggle("ceo-motion-ready", enabled);
    }
    const letterFits = !letter || letter.offsetHeight <= window.innerHeight - 130;
    root.classList.toggle("ceo-letter-static", !compact.matches && !letterFits);
    if (enabled) {
      setBlend(currentBlend);
      render();
    } else {
      // Reduced-motion and short screens keep the same accessible, static comparison.
      setBlend(currentBlend >= 0.5 ? 1 : 0);
    }
    if (live) live.textContent = "";
  }

  for (const button of buttons) {
    button.addEventListener("click", () => {
      manual = button.dataset.ceoShow === "crenova" ? 1 : 0;
      manualScrollY = window.scrollY;
      setBlend(manual);
      if (live)
        live.textContent =
          manual === 1
            ? "CRENOVA 티셔츠 사진과 일상 가까이 인사말을 선택했습니다."
            : "정장 사진과 원칙과 책임 인사말을 선택했습니다.";
    });
  }

  window.addEventListener(
    "scroll",
    () => {
      if (manual !== undefined && visual && Math.abs(window.scrollY - manualScrollY) > 24) {
        const bounds = visual.getBoundingClientRect();
        // Reading the full letter below the mobile portrait must retain the chosen message.
        if (bounds.bottom > 90 && bounds.top < window.innerHeight) manual = undefined;
      }
      schedule();
    },
    { passive: true },
  );
  window.addEventListener("resize", configure, { passive: true });
  window.addEventListener("pageshow", configure);
  reduced.addEventListener("change", configure);
  compact.addEventListener("change", configure);
  void document.fonts.ready.then(configure);
  configure();
}

export {};
