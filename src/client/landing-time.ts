/** The photograph gently approaches, blurs, and dissolves into a clear next step. */
const timeExperience = document.querySelector<HTMLElement>("[data-time-experience]");

if (timeExperience) {
  const root = timeExperience;
  const pin = root.querySelector<HTMLElement>("[data-time-pin]");
  const clock = root.querySelector<HTMLElement>("[data-time-clock]");
  const message = root.querySelector<HTMLElement>("[data-time-message]");
  const opening = root.querySelector<HTMLElement>(".time-opening");
  const benefits = [...root.querySelectorAll<HTMLElement>("[data-time-benefit]")];
  const roomy = window.matchMedia("(min-height: 560px)");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const focusPercent = (value: string | undefined) => {
    const coordinate = Number.parseFloat(value ?? "50");
    return `${Number.isFinite(coordinate) ? clamp(coordinate / 100) * 100 : 50}%`;
  };
  // CSSOM properties preserve a supplied photo's focus without a CSP-blocked style attribute.
  clock?.style.setProperty("--time-focus-x", focusPercent(clock.dataset.timeFocusX));
  clock?.style.setProperty("--time-focus-y", focusPercent(clock.dataset.timeFocusY));
  const ease = (value: number) => {
    const t = clamp(value);
    return t * t * (3 - 2 * t);
  };
  let animated = false;
  let frame = 0;

  function render() {
    frame = 0;
    if (!animated || !pin) return;
    const bounds = root.getBoundingClientRect();
    if (bounds.bottom < 0 || bounds.top > window.innerHeight) return;
    const top = Number.parseFloat(getComputedStyle(pin).top) || 0;
    const range = Math.max(1, root.offsetHeight - pin.offsetHeight);
    const progress = clamp((top - bounds.top) / range);
    const zoom = ease((progress - 0.1) / 0.5);
    const dissolve = ease((progress - 0.4) / 0.3);
    const reveal = ease((progress - 0.62) / 0.2);

    root.style.setProperty("--time-progress", progress.toFixed(4));
    root.style.setProperty("--time-clock-scale", (1 + zoom * 0.8).toFixed(4));
    root.style.setProperty("--time-clock-blur", `${(dissolve * 14).toFixed(2)}px`);
    root.style.setProperty("--time-copy-opacity", (1 - ease((progress - 0.27) / 0.22)).toFixed(3));
    root.style.setProperty("--time-clock-opacity", (1 - ease((progress - 0.49) / 0.23)).toFixed(3));
    root.style.setProperty("--time-wipe-opacity", ease((progress - 0.45) / 0.29).toFixed(3));
    root.style.setProperty("--time-message-opacity", reveal.toFixed(3));
    root.style.setProperty("--time-message-rise", `${((1 - reveal) * 22).toFixed(2)}px`);
    root.classList.toggle("time-experience-ready", reveal >= 0.95);

    for (const [index, benefit] of benefits.entries()) {
      const appear = ease((progress - 0.74 - index * 0.035) / 0.12);
      benefit.style.setProperty("--time-benefit-opacity", appear.toFixed(3));
      benefit.style.setProperty("--time-benefit-rise", `${((1 - appear) * 22).toFixed(2)}px`);
    }
  }

  function schedule() {
    if (animated && !frame) frame = requestAnimationFrame(render);
  }

  function configure() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    animated = roomy.matches && !reduced.matches;
    root.classList.toggle("time-experience-motion", animated);
    // Measure the compact presentation itself before deciding whether it can be pinned.
    if (animated && pin && message) {
      const contentHeight = message.firstElementChild?.getBoundingClientRect().height ?? 0;
      const inset = getComputedStyle(message);
      const padding = Number.parseFloat(inset.paddingTop) + Number.parseFloat(inset.paddingBottom);
      const openingHeight = opening?.getBoundingClientRect().height ?? 0;
      if (contentHeight + padding > pin.clientHeight || openingHeight + 150 > pin.clientHeight)
        animated = false;
    }
    root.classList.toggle("time-experience-motion", animated);
    root.classList.toggle("time-experience-ready", !animated);
    if (animated) render();
  }

  // Every update comes from navigation; there is no timer or background render loop.
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", configure, { passive: true });
  window.addEventListener("pageshow", configure);
  roomy.addEventListener("change", configure);
  reduced.addEventListener("change", configure);
  void document.fonts.ready.then(configure);
  configure();
}

export {};
