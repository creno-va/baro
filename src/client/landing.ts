/** Scroll-linked decoration. Semantic content is visible even if JavaScript is unavailable. */
const landing = document.querySelector<HTMLElement>(".landing");

if (landing) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const desktop = window.matchMedia("(min-width: 768px)");
  const scenes = [...landing.querySelectorAll<HTMLElement>("[data-scroll-scene]")].map((node) => ({
    node,
    layers: [...node.querySelectorAll<HTMLElement>("[data-parallax]")].map((layer) => ({
      node: layer,
      distance: Number(layer.dataset.parallax) || 0,
    })),
  }));
  const reveals = [...landing.querySelectorAll<HTMLElement>("[data-reveal]")];
  const progress = landing.querySelector<HTMLElement>(".landing-scroll-progress");
  let frame = 0;
  let revealObserver: IntersectionObserver | undefined;
  let enabled = false;

  function render() {
    frame = 0;
    if (!enabled) return;
    const viewport = window.innerHeight;
    const scrollRange = Math.max(1, document.documentElement.scrollHeight - viewport);
    progress?.style.setProperty(
      "--page-progress",
      String(Math.min(1, Math.max(0, window.scrollY / scrollRange))),
    );
    for (const scene of scenes) {
      const bounds = scene.node.getBoundingClientRect();
      if (bounds.bottom < -150 || bounds.top > viewport + 150) continue;
      const position = Math.max(
        0,
        Math.min(1, (viewport - bounds.top) / (viewport + bounds.height)),
      );
      scene.node.style.setProperty("--scene-progress", position.toFixed(4));
      for (const layer of scene.layers) {
        layer.node.style.setProperty(
          "--parallax-offset",
          `${((position - 0.5) * 2 * layer.distance).toFixed(2)}px`,
        );
      }
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
    if (!enabled) {
      landing?.classList.remove("landing-motion-ready");
      for (const node of reveals) node.classList.add("is-visible");
      for (const scene of scenes) {
        scene.node.style.removeProperty("--scene-progress");
        for (const layer of scene.layers) layer.node.style.removeProperty("--parallax-offset");
      }
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
        { threshold: 0.08, rootMargin: "0px 0px -24px 0px" },
      );
      for (const node of reveals) {
        // Keep restored scroll positions and above-fold content immediately readable.
        if (node.getBoundingClientRect().top < window.innerHeight) node.classList.add("is-visible");
        else revealObserver.observe(node);
      }
    } else {
      for (const node of reveals) node.classList.add("is-visible");
    }
    landing?.classList.add("landing-motion-ready");
    schedule();
  }

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("pageshow", configure);
  desktop.addEventListener("change", configure);
  motion.addEventListener("change", configure);
  configure();
}
