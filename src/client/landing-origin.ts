const originSection = document.querySelector<HTMLElement>("[data-origin-story]");
if (originSection) {
  const root = originSection;
  const pin = root.querySelector<HTMLElement>(".origin-pin");
  const stage = root.querySelector<HTMLElement>(".origin-photo-stage");
  const photo = root.querySelector<HTMLElement>("[data-origin-photo]");
  const skip = root.querySelector<HTMLButtonElement>("[data-origin-open]");
  const arrival = root.querySelector<HTMLElement>(".origin-arrival");
  const desktop = matchMedia("(min-width: 900px) and (min-height: 720px)");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const smooth = (v: number) => {
    const t = clamp(v);
    return t * t * (3 - 2 * t);
  };
  let active = false;
  let frame = 0;
  function render() {
    frame = 0;
    if (!active || !pin || !photo || !stage) return;
    const bounds = root.getBoundingClientRect();
    if (bounds.top > innerHeight || bounds.bottom < 0) return;
    const top = Number.parseFloat(getComputedStyle(pin).top) || 76;
    const p = clamp((top - bounds.top) / Math.max(1, root.offsetHeight - pin.offsetHeight));
    const zoom = smooth((p - 0.1) / 0.49);
    const stageBounds = stage.getBoundingClientRect();
    const pinBounds = pin.getBoundingClientRect();
    const dx =
      pin.clientWidth / 2 - (stageBounds.left - pinBounds.left + photo.clientWidth * 0.678);
    const dy = pin.clientHeight / 2 - (stageBounds.top - pinBounds.top + photo.clientHeight * 0.48);
    const portal = smooth((p - 0.55) / 0.15);
    const appear = smooth((p - 0.68) / 0.15);
    root.style.setProperty("--origin-progress", p.toFixed(4));
    root.style.setProperty("--origin-zoom", (1 + zoom * 7).toFixed(4));
    root.style.setProperty("--origin-shift-x", `${(dx * zoom).toFixed(2)}px`);
    root.style.setProperty("--origin-shift-y", `${(dy * zoom).toFixed(2)}px`);
    root.style.setProperty("--origin-copy-opacity", (1 - smooth(p / 0.18)).toFixed(3));
    root.style.setProperty("--origin-photo-opacity", (1 - smooth((p - 0.65) / 0.1)).toFixed(3));
    root.style.setProperty(
      "--origin-portal-scale",
      ((portal * Math.hypot(pin.clientWidth, pin.clientHeight)) / 85).toFixed(3),
    );
    root.style.setProperty("--origin-arrival-opacity", appear.toFixed(3));
    root.style.setProperty("--origin-arrival-y", `${((1 - appear) * 36).toFixed(2)}px`);
    root.classList.toggle("origin-arrived", appear > 0.95);
  }
  function schedule() {
    if (active && !frame) frame = requestAnimationFrame(render);
  }
  function configure() {
    active = desktop.matches && !reduced.matches;
    root.classList.toggle("origin-motion", active);
    root.classList.remove("origin-arrived");
    if (skip) skip.hidden = !active;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (active) render();
    else root.removeAttribute("style");
  }
  skip?.addEventListener("click", () => {
    if (!active || !pin) return;
    const top = Number.parseFloat(getComputedStyle(pin).top) || 76;
    // The skip control disappears on arrival; keep focus on its visible destination.
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
  arrival?.addEventListener("focusin", () => root.classList.add("origin-arrived"));
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("pageshow", configure);
  desktop.addEventListener("change", configure);
  reduced.addEventListener("change", configure);
  configure();
}

export {};
