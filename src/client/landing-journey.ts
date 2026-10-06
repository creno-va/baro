/** The footage plays continuously; only its framing and the DOM scene follow scroll. */
const journey = document.querySelector<HTMLElement>("[data-journey-hero]");
if (journey) {
  const scene = journey;
  const pin = scene.querySelector<HTMLElement>(".journey-pin");
  const video = scene.querySelector<HTMLVideoElement>("[data-scroll-film]");
  const button = scene.querySelector<HTMLButtonElement>("[data-journey-toggle]");
  const opening = scene.querySelector<HTMLElement>(".journey-opening");
  const app = scene.querySelector<HTMLElement>("[data-journey-app]");
  const enter = scene.querySelector<HTMLAnchorElement>("[data-journey-enter]");
  const cue = scene.querySelector<HTMLElement>("[data-journey-cue]");
  const messages = [...scene.querySelectorAll<HTMLElement>("[data-journey-message]")];
  const chapters = [...scene.querySelectorAll<HTMLElement>(".journey-chapters > span")];
  const motionViewport = window.matchMedia(
    "(min-width: 768px) and (min-height: 600px), (min-width: 320px) and (max-width: 767px) and (min-height: 520px)",
  );
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    ?.saveData;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  let enabled = false;
  let visible = false;
  let progress = 0;
  let frame = 0;
  let userPaused = false;
  let explicitlyStarted = false;
  let failed = false;
  let playingRequest = false;

  function shouldPlay() {
    return (
      enabled &&
      visible &&
      progress < 0.62 &&
      !document.hidden &&
      !userPaused &&
      !failed &&
      (!saveData || explicitlyStarted)
    );
  }

  function syncButton() {
    if (!button) return;
    const paused = userPaused || failed || (saveData && !explicitlyStarted);
    button.dataset.paused = String(Boolean(paused));
    button.setAttribute("aria-label", `첫 화면 영상 ${paused ? "재생하기" : "일시정지"}`);
    const label = button.querySelector("[data-journey-toggle-label]");
    if (label) label.textContent = paused ? "영상 재생" : "영상 일시정지";
  }

  function reconcileVideo() {
    if (!video) return;
    if (!shouldPlay()) {
      if (!video.paused) video.pause();
      syncButton();
      return;
    }
    if (!video.getAttribute("src") && video.dataset.videoSrc) {
      video.src = video.dataset.videoSrc;
      video.muted = true;
    }
    if (video.paused && !playingRequest) {
      playingRequest = true;
      void video
        .play()
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) userPaused = true;
        })
        .finally(() => {
          playingRequest = false;
          // A pending autoplay request must not restart a hidden or visitor-paused film.
          if (!shouldPlay()) video.pause();
          syncButton();
        });
    }
    syncButton();
  }

  function render() {
    frame = 0;
    if (!enabled || !pin) return;
    const bounds = scene.getBoundingClientRect();
    if (window.innerWidth < 768)
      scene.style.setProperty(
        "--journey-mobile-scale",
        Math.min(0.64, Math.max(0.38, (pin.clientHeight - 246) / 615)).toFixed(3),
      );
    const top = Number.parseFloat(getComputedStyle(pin).top) || 76;
    const distance = Math.max(1, scene.offsetHeight - pin.offsetHeight);
    progress = clamp((top - bounds.top) / distance);
    scene.style.setProperty("--journey-progress", progress.toFixed(4));
    scene.style.setProperty("--journey-film-scale", (1 + progress * 0.45).toFixed(3));
    scene.style.setProperty(
      "--journey-film-opacity",
      (1 - clamp((progress - 0.48) / 0.14)).toFixed(3),
    );
    scene.style.setProperty("--journey-opening-opacity", (1 - clamp(progress / 0.18)).toFixed(3));
    scene.style.setProperty("--journey-opening-y", `${-progress * 150}px`);
    const portal = clamp((progress - 0.42) / 0.17);
    scene.style.setProperty("--journey-portal-opacity", portal.toFixed(3));
    scene.style.setProperty("--journey-portal-scale", (0.08 + portal * 0.92).toFixed(3));
    scene.style.setProperty("--journey-portal-radius", `${45 * (1 - portal)}%`);
    scene.style.setProperty("--journey-app-opacity", clamp((progress - 0.55) / 0.09).toFixed(3));
    scene.style.setProperty("--journey-app-y", `${70 * (1 - clamp((progress - 0.55) / 0.15))}px`);
    scene.style.setProperty(
      "--journey-device-turn",
      `${-12 * (1 - clamp((progress - 0.6) / 0.4))}deg`,
    );
    scene.dataset.stage = progress > 0.52 ? "app" : "film";
    if (opening) {
      opening.inert = progress > 0.18;
      opening.setAttribute("aria-hidden", String(progress > 0.18));
    }
    if (app) {
      app.inert = progress < 0.6;
      app.setAttribute("aria-hidden", String(progress < 0.6));
    }
    messages.forEach((message, index) => {
      message.classList.toggle("is-shown", progress >= 0.6 + index * 0.065);
    });
    const current = progress < 0.15 ? 0 : progress < 0.56 ? 1 : 2;
    chapters.forEach((chapter, index) => {
      chapter.classList.toggle("is-active", index === current);
    });
    if (cue)
      cue.textContent =
        current === 2 ? "이제 직접 눌러서 체험해 보세요" : "스크롤해 BARO를 만나보세요";
    if (enter) enter.href = current === 2 ? "#try-baro" : "#hero-experience";
    reconcileVideo();
  }
  function schedule() {
    if (enabled && !frame) frame = requestAnimationFrame(render);
  }
  function configure() {
    enabled = motionViewport.matches && !reduced.matches;
    scene.classList.toggle("journey-ready", enabled);
    if (button) button.hidden = !enabled;
    if (!enabled) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      scene.removeAttribute("style");
      scene.removeAttribute("data-stage");
      for (const section of [opening, app]) {
        if (section) {
          section.inert = false;
          section.removeAttribute("aria-hidden");
        }
      }
      for (const message of messages) message.classList.add("is-shown");
      video?.pause();
    } else schedule();
    syncButton();
  }
  video?.addEventListener("loadeddata", () => {
    video.classList.add("is-ready");
    schedule();
  });
  video?.addEventListener("play", () => {
    // Native autoplay can fire after viewport or motion preferences have changed.
    if (!shouldPlay()) video.pause();
  });
  video?.addEventListener("error", () => {
    failed = true;
    video.classList.remove("is-ready");
    syncButton();
  });
  button?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    // Keep focus inside the clipped sticky panel without scrolling its flow position.
    event.preventDefault();
    button.focus({ preventScroll: true });
  });
  button?.addEventListener("click", () => {
    if (userPaused || failed || (saveData && !explicitlyStarted)) {
      userPaused = false;
      explicitlyStarted = true;
      if (failed) {
        failed = false;
        video?.load();
      }
    } else userPaused = true;
    reconcileVideo();
  });
  enter?.addEventListener("click", (event) => {
    if (!enabled || progress > 0.55 || !pin) return;
    event.preventDefault();
    const top = Number.parseFloat(getComputedStyle(pin).top) || 76;
    window.scrollTo({
      top:
        scrollY +
        scene.getBoundingClientRect().top -
        top +
        (scene.offsetHeight - pin.offsetHeight) * 0.76,
      behavior: "smooth",
    });
  });
  if (pin && "IntersectionObserver" in window)
    new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? false;
        schedule();
      },
      { threshold: 0.01 },
    ).observe(pin);
  else visible = true;
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("pageshow", configure);
  window.addEventListener("pagehide", () => video?.pause());
  document.addEventListener("visibilitychange", reconcileVideo);
  motionViewport.addEventListener("change", configure);
  reduced.addEventListener("change", configure);
  configure();
}

export {};
