/** Read each full letter before turning both its portrait and message to the left. */
for (const root of document.querySelectorAll<HTMLElement>("[data-ceo-greeting]")) {
  const stage = root.querySelector<HTMLElement>("[data-ceo-scroll]");
  const viewport = root.querySelector<HTMLElement>("[data-ceo-viewport]");
  const letters = [...root.querySelectorAll<HTMLElement>("[data-ceo-message]")];
  const [frontLetter, backLetter] = letters;
  const chapters = [...root.querySelectorAll<HTMLElement>("[data-ceo-chapter]")];
  if (!stage || !viewport || !frontLetter || !backLetter || chapters.length !== 2) continue;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const ease = (value: number) => {
    const progress = clamp(value);
    return progress * progress * (3 - 2 * progress);
  };
  let enabled = false;
  let frame = 0;
  let top = 0;
  let hold = 0;
  let frontOverflow = 0;
  let backOverflow = 0;
  let flipStart = 0;
  let flipLength = 0;
  let backStart = 0;
  let travel = 0;
  let current = "";

  function render() {
    frame = 0;
    if (!enabled || !stage) return;
    const distance = Math.max(0, Math.min(travel, top - stage.getBoundingClientRect().top));
    const flip = clamp((distance - flipStart) / flipLength);
    const turn = ease(flip);
    let read = Math.min(frontOverflow, Math.max(0, distance - hold));
    if (flip > 0 && flip < 1) {
      // Reset the reading position while the faces are edge-on, so the next letter starts at its heading.
      read = frontOverflow * (1 - ease((turn - 0.46) / 0.08));
    } else if (flip === 1) {
      read = Math.min(backOverflow, Math.max(0, distance - backStart));
    }
    root.style.setProperty("--ceo-turn", `${(-180 * turn).toFixed(3)}deg`);
    root.style.setProperty("--ceo-read-y", `${(-read).toFixed(2)}px`);
    root.style.setProperty("--ceo-photo-follow", `${read.toFixed(2)}px`);
    const next = turn < 0.5 ? "suit" : "crenova";
    if (current === next) return;
    current = next;
    // Both noninteractive letters remain in reading order for assistive technology.
    root.dataset.ceoCurrent = next;
  }

  function schedule() {
    if (enabled && !frame) frame = window.requestAnimationFrame(render);
  }

  function configure() {
    if (!stage || !viewport || !frontLetter || !backLetter) return;
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    enabled = !reduced.matches;
    root.classList.toggle("ceo-motion-ready", enabled);
    current = "";
    if (!enabled) {
      for (const property of ["--ceo-turn", "--ceo-read-y", "--ceo-photo-follow"]) {
        root.style.removeProperty(property);
      }
      stage.style.removeProperty("height");
      delete root.dataset.ceoCurrent;
      return;
    }
    const styles = getComputedStyle(viewport);
    top = Number.parseFloat(styles.top) || 0;
    const room =
      viewport.clientHeight -
      Number.parseFloat(styles.paddingTop) -
      Number.parseFloat(styles.paddingBottom);
    // Untransformed heights also handle narrow screens, text zoom, and late font loading.
    frontOverflow = Math.max(0, frontLetter.offsetHeight - room);
    backOverflow = Math.max(0, backLetter.offsetHeight - room);
    hold = Math.max(80, viewport.clientHeight * 0.2);
    flipStart = hold + frontOverflow + hold;
    flipLength = Math.max(360, viewport.clientHeight * 0.85);
    backStart = flipStart + flipLength + hold;
    travel = backStart + backOverflow + hold;
    stage.style.height = `${Math.ceil(viewport.clientHeight + travel)}px`;
    render();
  }

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", configure, { passive: true });
  window.addEventListener("pageshow", configure);
  reduced.addEventListener("change", configure);
  const observer = new ResizeObserver(configure);
  observer.observe(viewport);
  for (const letter of letters) observer.observe(letter);
  void document.fonts.ready.then(configure);
  configure();
}

export {};
