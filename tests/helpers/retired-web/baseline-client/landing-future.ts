/** The final story moves at the visitor's pace; the shared film controller owns playback. */
for (const section of document.querySelectorAll<HTMLElement>("[data-everyday-future]")) {
  const desktop = window.matchMedia("(min-width: 320px)");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const scenes = [...section.querySelectorAll<HTMLElement>("[data-future-scene]")].map((node) => ({
    node,
    layers: [...node.querySelectorAll<HTMLElement>("[data-future-layer]")].map((layer) => ({
      node: layer,
      x: Number(layer.dataset.futureX) || 0,
      y: Number(layer.dataset.futureY) || 0,
      scale: Number(layer.dataset.futureScale) || 0,
    })),
  }));
  const reveals = [...section.querySelectorAll<HTMLElement>("[data-future-reveal]")];
  const inkLines = [...section.querySelectorAll<HTMLElement>("[data-future-ink]")];
  let enabled = false;
  let frame = 0;
  let observer: IntersectionObserver | undefined;

  function render() {
    frame = 0;
    if (!enabled) return;
    const viewport = window.innerHeight;
    for (const scene of scenes) {
      const bounds = scene.node.getBoundingClientRect();
      if (bounds.bottom < -150 || bounds.top > viewport + 150) continue;
      const progress = clamp((viewport - bounds.top) / (viewport + bounds.height));
      const travel = (progress - 0.5) * (window.innerWidth < 768 ? 0.7 : 2);
      for (const layer of scene.layers) {
        layer.node.style.setProperty("--future-x", `${(travel * layer.x).toFixed(2)}px`);
        layer.node.style.setProperty("--future-y", `${(travel * layer.y).toFixed(2)}px`);
        layer.node.style.setProperty("--future-scale", (1 + progress * layer.scale).toFixed(4));
      }
    }
    for (const line of inkLines) {
      const bounds = line.getBoundingClientRect();
      const progress = clamp((viewport * 0.85 - bounds.top) / (viewport * 0.37));
      line.style.setProperty("--future-ink", `${(progress * 100).toFixed(2)}%`);
    }
  }

  function schedule() {
    if (enabled && !frame) frame = window.requestAnimationFrame(render);
  }

  function configure() {
    enabled = desktop.matches && !reduced.matches;
    observer?.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    section.classList.toggle("future-motion-ready", enabled);
    if (!enabled) {
      for (const reveal of reveals) reveal.classList.add("is-visible");
      for (const scene of scenes)
        for (const layer of scene.layers)
          for (const property of ["--future-x", "--future-y", "--future-scale"])
            layer.node.style.removeProperty(property);
      for (const line of inkLines) line.style.removeProperty("--future-ink");
      return;
    }
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("is-visible");
            observer?.unobserve(entry.target);
          }
        },
        { threshold: 0.08, rootMargin: "0px 0px -24px 0px" },
      );
      for (const reveal of reveals) {
        if (reveal.getBoundingClientRect().top < window.innerHeight)
          reveal.classList.add("is-visible");
        else observer.observe(reveal);
      }
    } else {
      for (const reveal of reveals) reveal.classList.add("is-visible");
    }
    render();
  }

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("pageshow", configure);
  desktop.addEventListener("change", configure);
  reduced.addEventListener("change", configure);
  configure();
}

export {};
