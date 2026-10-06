/** The clock approaches; a blue circle opens into the time-saving message. */
const timeExperience = document.querySelector<HTMLElement>("[data-time-experience]");

if (timeExperience) {
  const root = timeExperience;
  const pin = root.querySelector<HTMLElement>("[data-time-pin]");
  const clock = root.querySelector<HTMLElement>("[data-time-clock]");
  const message = root.querySelector<HTMLElement>("[data-time-message]");
  const benefits = [...root.querySelectorAll<HTMLElement>("[data-time-benefit]")];
  const desktop = window.matchMedia("(min-width: 900px) and (min-height: 720px)");
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
    const zoom = ease(progress / 0.58);
    const wipe = ease((progress - 0.55) / 0.2);
    const reveal = ease((progress - 0.755) / 0.115);
    const cover = (Math.hypot(pin.clientWidth, pin.clientHeight) / 80) * 1.04;

    root.style.setProperty("--time-progress", progress.toFixed(4));
    root.style.setProperty("--time-clock-scale", (6.4 ** zoom).toFixed(4));
    root.style.setProperty("--time-clock-opacity", (1 - ease((progress - 0.69) / 0.07)).toFixed(3));
    root.style.setProperty("--time-wipe-cover", cover.toFixed(4));
    root.style.setProperty("--time-wipe-scale", (cover * wipe).toFixed(4));
    root.style.setProperty("--time-message-opacity", reveal.toFixed(3));
    root.style.setProperty("--time-message-rise", `${((1 - reveal) * 38).toFixed(2)}px`);
    root.classList.toggle("time-experience-ready", reveal >= 0.95);

    for (const [index, benefit] of benefits.entries()) {
      const appear = ease((progress - 0.845 - index * 0.024) / 0.075);
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
    // Keep a compact reader if larger text makes the message too tall to pin.
    const availableHeight = Math.max(1, window.innerHeight - 76);
    const contentHeight = message?.firstElementChild?.getBoundingClientRect().height ?? 0;
    animated = desktop.matches && !reduced.matches && contentHeight + 52 <= availableHeight;
    root.classList.toggle("time-experience-motion", animated);
    root.classList.toggle("time-experience-ready", !animated);
    if (animated && pin) {
      const cover = (Math.hypot(pin.clientWidth, pin.clientHeight) / 80) * 1.04;
      root.style.setProperty("--time-wipe-cover", cover.toFixed(4));
      render();
    }
  }

  // Every update comes from navigation; there is no timer or background render loop.
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", configure, { passive: true });
  window.addEventListener("pageshow", configure);
  desktop.addEventListener("change", configure);
  reduced.addEventListener("change", configure);
  void document.fonts.ready.then(configure);
  configure();
}

export {};
