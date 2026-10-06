/** Keep the handwritten source intact; a restrained approach dissolves into the next step. */
const originSection = document.querySelector<HTMLElement>("[data-origin-story]");

if (originSection) {
  const root = originSection;
  const pin = root.querySelector<HTMLElement>(".origin-pin");
  const opening = root.querySelector<HTMLElement>(".origin-opening");
  const skip = root.querySelector<HTMLButtonElement>("[data-origin-open]");
  const arrival = root.querySelector<HTMLElement>(".origin-arrival");
  const arrivalInner = root.querySelector<HTMLElement>(".origin-arrival-inner");
  const roomy = matchMedia("(min-height: 560px)");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const smooth = (value: number) => {
    const t = clamp(value);
    return t * t * (3 - 2 * t);
  };
  let active = false;
  let frame = 0;

  function render() {
    frame = 0;
    if (!active || !pin) return;
    const bounds = root.getBoundingClientRect();
    if (bounds.top > innerHeight || bounds.bottom < 0) return;
    const top = Number.parseFloat(getComputedStyle(pin).top) || 0;
    const progress = clamp((top - bounds.top) / Math.max(1, root.offsetHeight - pin.offsetHeight));
    const approach = smooth((progress - 0.12) / 0.48);
    const dissolve = smooth((progress - 0.4) / 0.28);
    const appear = smooth((progress - 0.62) / 0.2);
    root.style.setProperty("--origin-progress", progress.toFixed(4));
    root.style.setProperty("--origin-zoom", (1 + approach * 0.72).toFixed(4));
    root.style.setProperty(
      "--origin-copy-opacity",
      (1 - smooth((progress - 0.27) / 0.22)).toFixed(3),
    );
    root.style.setProperty(
      "--origin-photo-opacity",
      (1 - smooth((progress - 0.49) / 0.23)).toFixed(3),
    );
    root.style.setProperty("--origin-blur", `${(dissolve * 14).toFixed(2)}px`);
    root.style.setProperty("--origin-wash-opacity", smooth((progress - 0.45) / 0.29).toFixed(3));
    root.style.setProperty("--origin-arrival-opacity", appear.toFixed(3));
    root.style.setProperty("--origin-arrival-y", `${((1 - appear) * 22).toFixed(2)}px`);
    root.classList.toggle("origin-arrived", appear > 0.95);
  }

  function schedule() {
    if (active && !frame) frame = requestAnimationFrame(render);
  }

  function configure() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    active = roomy.matches && !reduced.matches;
    root.classList.toggle("origin-motion", active);
    // Enlarged text falls back to the regular reader instead of being clipped.
    if (active && pin && arrival && arrivalInner) {
      const inset = getComputedStyle(arrival);
      const padding = Number.parseFloat(inset.paddingTop) + Number.parseFloat(inset.paddingBottom);
      const openingHeight = opening?.getBoundingClientRect().height ?? 0;
      if (
        arrivalInner.scrollHeight + padding > pin.clientHeight ||
        openingHeight + 180 > pin.clientHeight
      )
        active = false;
    }
    root.classList.toggle("origin-motion", active);
    root.classList.remove("origin-arrived");
    if (skip) skip.hidden = !active;
    if (active) render();
    else root.removeAttribute("style");
  }

  skip?.addEventListener("click", () => {
    if (!active || !pin) return;
    const top = Number.parseFloat(getComputedStyle(pin).top) || 0;
    arrival?.querySelector<HTMLAnchorElement>("a[href]")?.focus({ preventScroll: true });
    window.scrollTo({
      top:
        scrollY +
        root.getBoundingClientRect().top -
        top +
        (root.offsetHeight - pin.offsetHeight) * 0.9,
      behavior: "smooth",
    });
  });
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", configure, { passive: true });
  window.addEventListener("pageshow", configure);
  roomy.addEventListener("change", configure);
  reduced.addEventListener("change", configure);
  void document.fonts.ready.then(configure);
  configure();
}

export {};
