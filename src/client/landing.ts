/** Scroll direction and distance visibly drive the page; all copy remains available without JS. */
const landing = document.querySelector<HTMLElement>(".landing");

if (landing) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const desktop = window.matchMedia("(min-width: 768px)");
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const scenes = [...landing.querySelectorAll<HTMLElement>("[data-scroll-scene]")].map((node) => ({
    node,
    layers: [...node.querySelectorAll<HTMLElement>("[data-parallax], [data-scale]")].map(
      (layer) => ({
        node: layer,
        distance: Number(layer.dataset.parallax) || 0,
        drift: Number(layer.dataset.drift) || 0,
        rotation: Number(layer.dataset.rotate) || 0,
        scale: Number(layer.dataset.scale) || 0,
      }),
    ),
  }));
  const reveals = [
    ...landing.querySelectorAll<HTMLElement>("[data-reveal], .landing-timeline > li"),
  ];
  const inkLines = [...landing.querySelectorAll<HTMLElement>("[data-ink-line]")];
  const hero = landing.querySelector<HTMLElement>("[data-hero-scene]");
  const progress = landing.querySelector<HTMLElement>(".landing-scroll-progress");
  let frame = 0;
  let revealObserver: IntersectionObserver | undefined;
  let enabled = false;

  const films = [...landing.querySelectorAll<HTMLVideoElement>("[data-film]")].map((video) => ({
    video,
    container: video.closest<HTMLElement>("[data-film-container]"),
    button: landing.querySelector<HTMLButtonElement>(`[data-film-toggle="${video.dataset.film}"]`),
    visible: false,
    userPaused: false,
    userStarted: false,
    failed: false,
  }));
  const dataSaver =
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ===
    true;

  function syncFilm(film: (typeof films)[number]) {
    const label = film.button?.querySelector("[data-film-label]");
    const playing = !film.video.paused;
    film.button?.setAttribute("data-playing", String(playing));
    film.button?.setAttribute(
      "aria-label",
      `${film.video.dataset.film === "hero" ? "첫 화면" : "일상"} 영상 ${playing ? "일시정지" : "재생하기"}`,
    );
    if (label) label.textContent = playing ? "영상 일시정지" : "영상 재생";
  }

  function reconcileFilm(film: (typeof films)[number]) {
    const shouldPlay =
      desktop.matches &&
      film.visible &&
      !document.hidden &&
      !film.userPaused &&
      !film.failed &&
      ((!motion.matches && !dataSaver) || film.userStarted);
    if (!shouldPlay) {
      film.video.pause();
      syncFilm(film);
      return;
    }
    if (!film.video.getAttribute("src") && film.video.dataset.videoSrc) {
      film.video.src = film.video.dataset.videoSrc;
      film.video.muted = true;
    }
    if (film.video.paused) {
      void film.video.play().catch((error: unknown) => {
        // Leaving the viewport can cancel an in-flight play request; that is not a user pause.
        if (error instanceof DOMException && error.name === "AbortError") return;
        // A browser may require a gesture. The poster and explicit play control remain usable.
        film.userPaused = true;
        syncFilm(film);
      });
    }
  }

  const filmObserver =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const film = films.find((item) => item.container === entry.target);
              if (!film) continue;
              film.visible = entry.isIntersecting;
              reconcileFilm(film);
            }
          },
          { threshold: 0.08 },
        )
      : undefined;

  for (const film of films) {
    if (film.button) film.button.hidden = false;
    film.video.addEventListener("playing", () => {
      film.video.classList.add("is-playing");
      syncFilm(film);
    });
    film.video.addEventListener("pause", () => syncFilm(film));
    film.video.addEventListener("error", () => {
      film.failed = true;
      film.video.classList.remove("is-playing");
      syncFilm(film);
    });
    film.button?.addEventListener("click", () => {
      if (film.video.paused) {
        film.failed = false;
        film.userPaused = false;
        film.userStarted = true;
        if (film.video.error) film.video.load();
      } else {
        film.userPaused = true;
      }
      reconcileFilm(film);
    });
    if (film.container && filmObserver) filmObserver.observe(film.container);
    else {
      film.visible = true;
      reconcileFilm(film);
    }
  }

  function render() {
    frame = 0;
    if (!enabled) return;
    const viewport = window.innerHeight;
    const scrollRange = Math.max(1, document.documentElement.scrollHeight - viewport);
    progress?.style.setProperty("--page-progress", String(clamp(window.scrollY / scrollRange)));
    for (const scene of scenes) {
      const bounds = scene.node.getBoundingClientRect();
      if (bounds.bottom < -200 || bounds.top > viewport + 200) continue;
      const position = clamp((viewport - bounds.top) / (viewport + bounds.height));
      const travel = (position - 0.5) * 2;
      scene.node.style.setProperty("--scene-progress", position.toFixed(4));
      for (const layer of scene.layers) {
        layer.node.style.setProperty(
          "--parallax-offset",
          `${(travel * layer.distance).toFixed(2)}px`,
        );
        layer.node.style.setProperty("--parallax-x", `${(travel * layer.drift).toFixed(2)}px`);
        layer.node.style.setProperty(
          "--parallax-rotate",
          `${(travel * layer.rotation).toFixed(2)}deg`,
        );
        layer.node.style.setProperty("--parallax-scale", (1 + position * layer.scale).toFixed(4));
      }
    }
    for (const line of inkLines) {
      const top = line.getBoundingClientRect().top;
      line.style.setProperty(
        "--ink-progress",
        `${(clamp((viewport * 0.82 - top) / (viewport * 0.33)) * 100).toFixed(1)}%`,
      );
    }
    if (hero) {
      const bounds = hero.getBoundingClientRect();
      const exit = clamp(-bounds.top / Math.max(1, bounds.height));
      hero.style.setProperty("--hero-copy-y", `${(-exit * 115).toFixed(2)}px`);
      hero.style.setProperty("--hero-copy-opacity", String(1 - exit * 0.7));
      hero.style.setProperty("--hero-signal-y", `${(-exit * 180).toFixed(2)}px`);
    }
  }

  function schedule() {
    if (enabled && !frame) frame = window.requestAnimationFrame(render);
  }

  function configure() {
    enabled = desktop.matches && !motion.matches;
    revealObserver?.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    for (const film of films) reconcileFilm(film);
    if (!enabled) {
      landing?.classList.remove("landing-motion-ready");
      for (const node of reveals) node.classList.add("is-visible");
      for (const scene of scenes) {
        scene.node.style.removeProperty("--scene-progress");
        for (const layer of scene.layers) {
          for (const property of [
            "--parallax-offset",
            "--parallax-x",
            "--parallax-rotate",
            "--parallax-scale",
          ])
            layer.node.style.removeProperty(property);
        }
      }
      for (const property of ["--hero-copy-y", "--hero-copy-opacity", "--hero-signal-y"])
        hero?.style.removeProperty(property);
      for (const line of inkLines) line.style.removeProperty("--ink-progress");
      progress?.style.removeProperty("--page-progress");
      return;
    }
    if ("IntersectionObserver" in window) {
      revealObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              revealObserver?.unobserve(entry.target);
            }
          }
        },
        { threshold: 0.08, rootMargin: "0px 0px -12px 0px" },
      );
      for (const node of reveals) {
        if (node.getBoundingClientRect().top < window.innerHeight) node.classList.add("is-visible");
        else revealObserver.observe(node);
      }
    } else {
      for (const node of reveals) node.classList.add("is-visible");
    }
    landing?.classList.add("landing-motion-ready");
    schedule();
  }

  document.addEventListener("visibilitychange", () => {
    for (const film of films) reconcileFilm(film);
    if (!document.hidden) schedule();
  });
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("pageshow", configure);
  desktop.addEventListener("change", configure);
  motion.addEventListener("change", configure);
  configure();
}
