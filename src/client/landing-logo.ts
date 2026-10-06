/** The real brand mark becomes six explorable features; all motion follows the page scroll. */
const logoExperience = document.querySelector<HTMLElement>("[data-logo-experience]");

if (logoExperience) {
  const scene = logoExperience;
  const pin = scene.querySelector<HTMLElement>(".logo-experience-sticky");
  const tiles = [...scene.querySelectorAll<HTMLButtonElement>("[data-logo-feature]")];
  const panels = [...scene.querySelectorAll<HTMLElement>("[data-logo-panel]")];
  const pieces = [...scene.querySelectorAll<SVGElement>("[data-logo-piece]")];
  const motionViewport = window.matchMedia(
    "(min-width: 900px) and (min-height: 720px), (min-width: 320px) and (max-width: 899px) and (min-height: 520px)",
  );
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const positions = [
    [0, -182],
    [165, -91],
    [165, 91],
    [0, 182],
    [-165, 91],
    [-165, -91],
  ];
  const separations = [
    [-174, -15, -31],
    [112, -142, 29],
    [133, 135, -24],
  ];
  let moving = false;
  let manual = false;
  let selected = -1;
  let frame = 0;

  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const ease = (value: number) => 1 - (1 - clamp(value)) ** 3;

  function select(index: number) {
    if (selected === index) return;
    selected = index;
    scene.dataset.logoSelected = String(index);
    for (const [position, tile] of tiles.entries()) {
      tile.setAttribute("aria-pressed", String(position === index));
    }
    for (const [position, panel] of panels.entries()) panel.hidden = position !== index;
  }

  function render() {
    frame = 0;
    if (!moving) return;
    const bounds = scene.getBoundingClientRect();
    if (!manual && (bounds.bottom < 0 || bounds.top > window.innerHeight)) return;
    const stickyTop = pin ? Number.parseFloat(window.getComputedStyle(pin).top) || 0 : 0;
    const distance = Math.max(1, scene.offsetHeight - (pin?.offsetHeight ?? window.innerHeight));
    const actual = clamp((stickyTop - bounds.top) / distance);
    const progress = manual ? Math.max(0.51, actual) : actual;
    const turn = ease((progress - 0.015) / 0.245);
    const split = ease((progress - 0.255) / 0.18);
    const disappear = clamp((progress - 0.405) / 0.095);
    const expand = ease((progress - 0.325) / 0.15);
    const reveal = clamp((progress - 0.36) / 0.065);
    const featureProgress = clamp((progress - 0.45) / 0.55);
    const compact = window.innerWidth < 900;
    const mobileSpan = Math.min(108, (scene.clientWidth - 32) * 0.32);
    const next = Math.min(5, Math.floor(featureProgress * 6));
    scene.style.setProperty("--logo-turn", `${(turn * 360).toFixed(2)}deg`);
    scene.style.setProperty("--logo-tilt", `${(Math.sin(turn * Math.PI * 2) * 12).toFixed(2)}deg`);
    scene.style.setProperty("--logo-opacity", (1 - disappear).toFixed(3));
    scene.style.setProperty("--logo-ring-opacity", expand.toFixed(3));
    scene.style.setProperty("--logo-detail-opacity", reveal.toFixed(3));
    scene.style.setProperty("--logo-intro-opacity", (1 - reveal).toFixed(3));
    scene.classList.toggle("logo-experience-expanded", reveal > 0.5);
    for (const [index, piece] of pieces.entries()) {
      const [x = 0, y = 0, spin = 0] = separations[index] ?? [];
      piece.style.transform = `translate3d(${(x * split).toFixed(2)}px, ${(y * split).toFixed(2)}px, ${(split * 80).toFixed(2)}px) rotateZ(${(spin * split).toFixed(2)}deg)`;
    }
    for (const [index, tile] of tiles.entries()) {
      const [x = 0, y = 0] = compact
        ? [((index % 3) - 1) * mobileSpan, index < 3 ? -39 : 39]
        : (positions[index] ?? []);
      const appear = ease((progress - 0.32 - index * 0.012) / 0.095);
      const individual = ease(featureProgress * 6 - index);
      tile.style.setProperty("--tile-x", `${(x * expand).toFixed(2)}px`);
      tile.style.setProperty("--tile-y", `${(y * expand).toFixed(2)}px`);
      tile.style.setProperty("--tile-opacity", appear.toFixed(3));
      tile.style.setProperty("--tile-scale", (0.35 + 0.65 * appear).toFixed(3));
      // The collapsed tiles overlap behind the brand mark. They remain keyboard
      // reachable, but become pointer targets only once visually separated.
      tile.style.pointerEvents = expand >= 0.95 && appear >= 0.9 ? "auto" : "none";
      tile.style.setProperty(
        "--tile-turn",
        `${((appear - 1) * 160 + individual * 360).toFixed(2)}deg`,
      );
    }
    if (!manual) select(next);
  }

  function schedule() {
    if (moving && !frame) frame = window.requestAnimationFrame(render);
  }

  function selectManually(index: number) {
    manual = true;
    scene.classList.add("logo-experience-manual");
    select(index);
    schedule();
  }

  function configure() {
    moving = motionViewport.matches && !reduceMotion.matches;
    scene.classList.add("logo-experience-enhanced");
    scene.classList.toggle("logo-experience-motion", moving);
    manual = false;
    scene.classList.remove("logo-experience-manual");
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    select(selected < 0 ? 0 : selected);
    if (moving) schedule();
    else for (const tile of tiles) tile.style.removeProperty("pointer-events");
  }

  for (const [index, tile] of tiles.entries()) {
    tile.addEventListener("click", () => selectManually(index));
    tile.addEventListener("focus", () => {
      // Pointer focus precedes click. Expanding here would move the pressed tile
      // underneath the pointer and could activate an entirely different feature.
      if (tile.matches(":focus-visible")) selectManually(index);
    });
    tile.addEventListener("keydown", (event) => {
      let next = index;
      if (event.key === "ArrowRight" || event.key === "ArrowDown")
        next = (index + 1) % tiles.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
        next = (index - 1 + tiles.length) % tiles.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tiles.length - 1;
      else return;
      event.preventDefault();
      tiles[next]?.focus({ preventScroll: true });
      selectManually(next);
    });
  }

  for (const link of scene.querySelectorAll<HTMLAnchorElement>("[data-logo-demo]")) {
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const request = new CustomEvent("baro:demo-feature", {
        detail: { feature: link.dataset.logoDemo },
        cancelable: true,
      });
      if (!window.dispatchEvent(request)) event.preventDefault();
    });
  }

  function resumeScrollSelection() {
    if (manual) {
      manual = false;
      scene.classList.remove("logo-experience-manual");
    }
    schedule();
  }

  // Scroll anchoring and focusing a CTA can produce scroll events. Keep a visitor's
  // explicit choice until they deliberately resume navigating the page.
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("wheel", resumeScrollSelection, { passive: true });
  window.addEventListener("touchmove", resumeScrollSelection, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].includes(event.key))
      return;
    const target = event.target;
    if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]"))
      return;
    if (
      event.key === " " &&
      target instanceof Element &&
      target.closest("a, button, [role='button']")
    )
      return;
    resumeScrollSelection();
  });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("pageshow", configure);
  motionViewport.addEventListener("change", configure);
  reduceMotion.addEventListener("change", configure);
  configure();
}

export {};
