/** A scroll-driven, full 360° device turn. Mobile and reduced motion use a static feature list. */
const phoneStory = document.querySelector<HTMLElement>("[data-phone-story]");

if (phoneStory) {
  const scene = phoneStory;
  const desktop = window.matchMedia("(min-width: 768px) and (min-height: 600px)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const chapters = [...scene.querySelectorAll<HTMLElement>("[data-phone-chapter]")];
  const screens = [...scene.querySelectorAll<HTMLElement>("[data-phone-screen]")];
  const floats = [...scene.querySelectorAll<HTMLElement>("[data-phone-float]")];
  const buttons = [...scene.querySelectorAll<HTMLButtonElement>("[data-phone-step]")];
  let enabled = false;
  let frame = 0;
  let chapter = -1;

  function selectChapter(next: number) {
    if (chapter === next) return;
    chapter = next;
    scene.dataset.chapter = String(next);
    for (const [index, node] of chapters.entries()) node.hidden = enabled && index !== next;
    for (const [index, node] of screens.entries())
      node.classList.toggle("is-current", index === next);
    for (const [index, node] of floats.entries())
      node.classList.toggle("is-current", index === next);
    for (const [index, button] of buttons.entries()) {
      button.setAttribute("aria-pressed", String(index === next));
    }
  }

  function render() {
    frame = 0;
    if (!enabled) return;
    const bounds = scene.getBoundingClientRect();
    if (bounds.bottom < 0 || bounds.top > window.innerHeight) return;
    const pin = scene.querySelector<HTMLElement>(".phone-story-sticky");
    const stickyTop = pin ? Number.parseFloat(window.getComputedStyle(pin).top) || 0 : 0;
    const distance = Math.max(1, scene.offsetHeight - (pin?.offsetHeight || window.innerHeight));
    const progress = Math.min(1, Math.max(0, (stickyTop - bounds.top) / distance));
    scene.style.setProperty("--phone-progress", progress.toFixed(4));
    // The full turn is continuous. Front, polished back and metal edges all take their turn.
    scene.style.setProperty("--phone-turn", `${(-18 - progress * 360).toFixed(2)}deg`);
    scene.style.setProperty(
      "--phone-tilt",
      `${(5 - Math.sin(progress * Math.PI * 2) * 8).toFixed(2)}deg`,
    );
    scene.style.setProperty("--phone-rise", `${(-Math.sin(progress * Math.PI) * 36).toFixed(2)}px`);
    scene.style.setProperty(
      "--phone-card-drift",
      `${(Math.sin(progress * Math.PI * 2) * 24).toFixed(2)}px`,
    );
    selectChapter(Math.min(3, Math.floor(progress * 4)));
  }

  function schedule() {
    if (enabled && !frame) frame = window.requestAnimationFrame(render);
  }

  function configure() {
    enabled = desktop.matches && !reduceMotion.matches;
    scene.classList.toggle("phone-story-ready", enabled);
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    chapter = -1;
    selectChapter(0);
    if (enabled) schedule();
    else {
      for (const node of chapters) node.hidden = false;
      scene.style.removeProperty("--phone-turn");
      scene.style.removeProperty("--phone-tilt");
      scene.style.removeProperty("--phone-rise");
      scene.style.removeProperty("--phone-card-drift");
    }
  }

  function goToChapter(index: number) {
    if (!enabled) return;
    const pin = scene.querySelector<HTMLElement>(".phone-story-sticky");
    const stickyTop = pin ? Number.parseFloat(window.getComputedStyle(pin).top) || 0 : 0;
    const distance = Math.max(1, scene.offsetHeight - (pin?.offsetHeight || window.innerHeight));
    // Keep selected chapters clear of boundaries, including floating-point rounding on restore.
    const progress = index === 0 ? 0 : (index + 0.15) / 4;
    const top =
      window.scrollY + scene.getBoundingClientRect().top - stickyTop + distance * progress;
    window.scrollTo({ top, behavior: "smooth" });
  }

  for (const [index, button] of buttons.entries()) {
    button.addEventListener("click", () => goToChapter(index));
    button.addEventListener("keydown", (event) => {
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = buttons.length - 1;
      else return;
      event.preventDefault();
      buttons[next]?.focus({ preventScroll: true });
      goToChapter(next);
    });
  }

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("pageshow", configure);
  desktop.addEventListener("change", configure);
  reduceMotion.addEventListener("change", configure);
  configure();
}

export {};
