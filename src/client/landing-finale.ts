/** Four ways to prepare become one coherent app, then hand the next step to the visitor. */
for (const root of document.querySelectorAll<HTMLElement>("[data-finale]")) {
  const pin = root.querySelector<HTMLElement>("[data-finale-pin]");
  const scene = root.querySelector<HTMLElement>("[data-finale-scene]");
  const replay = root.querySelector<HTMLButtonElement>("[data-finale-replay]");
  if (!pin || !scene) continue;

  const desktop = window.matchMedia("(min-width: 768px) and (min-height: 640px)");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const ease = (value: number) => value * value * (3 - 2 * value);
  const features = [...root.querySelectorAll<HTMLElement>("[data-finale-feature]")].map((node) => ({
    node,
    x: Number(node.dataset.x) || 0,
    y: Number(node.dataset.y) || 0,
    rotate: Number(node.dataset.rotate) || 0,
  }));
  const steps = [...root.querySelectorAll<HTMLElement>("[data-finale-step]")];
  const stageLabel = root.querySelector<HTMLElement>("[data-finale-stage]");
  const replayLabel = root.querySelector<HTMLElement>("[data-finale-replay-label]");
  let enabled = false;
  let frame = 0;
  let progress = 0;
  let stage = -1;

  function render() {
    frame = 0;
    if (!enabled || !pin || !scene) return;
    const top = Number.parseFloat(getComputedStyle(pin).top) || 76;
    const bounds = root.getBoundingClientRect();
    if (bounds.top > window.innerHeight || bounds.bottom < 0) return;
    const distance = Math.max(1, root.offsetHeight - pin.offsetHeight);
    progress = clamp((top - bounds.top) / distance);
    const merge = ease(clamp((progress - 0.045) / 0.34));
    const open = ease(clamp((progress - 0.35) / 0.23));
    const end = ease(clamp((progress - 0.75) / 0.2));
    const fit = Math.min(1, Math.max(0.5, (scene.clientHeight - 14) / 440));
    const spreadX = Math.max(200, scene.clientWidth - 300);
    const spreadY = Math.max(130, scene.clientHeight - 116);

    root.style.setProperty("--finale-merge", merge.toFixed(4));
    root.style.setProperty("--finale-app-open", open.toFixed(4));
    root.style.setProperty("--finale-end", end.toFixed(4));
    root.style.setProperty("--finale-logo-scale", (1 + merge * 0.18 - open * 0.62).toFixed(4));
    root.style.setProperty("--finale-logo-opacity", (1 - open).toFixed(4));
    root.style.setProperty(
      "--finale-device-scale",
      (fit * (0.2 + open * 0.8 - end * 0.1)).toFixed(4),
    );
    root.style.setProperty("--finale-device-turn", `${(-24 * (1 - open) + end * 8).toFixed(2)}deg`);
    root.style.setProperty("--finale-device-opacity", (open * (1 - end)).toFixed(4));

    for (const [index, feature] of features.entries()) {
      const gather = ease(clamp((progress - 0.045 - index * 0.014) / 0.34));
      const remaining = 1 - gather;
      const vanish = ease(clamp((progress - 0.29 - index * 0.014) / 0.13));
      const x = (feature.x * spreadX * remaining) / 2;
      const y = (feature.y * spreadY * remaining) / 2;
      feature.node.style.transform = `translate(calc(-50% + ${x.toFixed(2)}px), calc(-50% + ${y.toFixed(2)}px)) rotate(${(feature.rotate * remaining).toFixed(2)}deg) scale(${(1 - gather * 0.7).toFixed(4)})`;
      feature.node.style.opacity = (1 - vanish).toFixed(4);
    }
    for (const [index, step] of steps.entries()) {
      const reveal = ease(clamp((progress - 0.44 - index * 0.045) / 0.1));
      step.style.setProperty("--finale-step-y", `${((1 - reveal) * 15).toFixed(2)}px`);
      step.style.setProperty("--finale-step-opacity", reveal.toFixed(4));
    }
    const nextStage = progress < 0.39 ? 0 : progress < 0.82 ? 1 : 2;
    if (stage !== nextStage) {
      stage = nextStage;
      if (stageLabel)
        stageLabel.textContent =
          [
            "네 가지 경험, 하나의 시작",
            "흩어진 이야기가, 준비할 수 있는 내용으로",
            "다음은, 당신의 이야기",
          ][nextStage] ?? "네 가지 경험, 하나의 시작";
      if (replayLabel)
        replayLabel.textContent = nextStage === 2 ? "처음부터 다시 보기" : "정리되는 과정 보기";
    }
  }

  function schedule() {
    if (enabled && !frame) frame = window.requestAnimationFrame(render);
  }

  function configure() {
    enabled = desktop.matches && !reduced.matches;
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    stage = -1;
    root.classList.toggle("finale-motion-ready", enabled);
    if (replay) replay.hidden = !enabled;
    if (enabled) render();
    else {
      root.removeAttribute("style");
      for (const feature of features) {
        feature.node.style.removeProperty("transform");
        feature.node.style.removeProperty("opacity");
      }
      for (const step of steps) {
        step.style.removeProperty("--finale-step-y");
        step.style.removeProperty("--finale-step-opacity");
      }
      if (stageLabel) stageLabel.textContent = "네 가지 경험, 하나의 시작";
    }
  }

  replay?.addEventListener("click", () => {
    if (!enabled || !pin) return;
    const top = Number.parseFloat(getComputedStyle(pin).top) || 76;
    const sectionTop = root.getBoundingClientRect().top + window.scrollY;
    const distance = Math.max(1, root.offsetHeight - pin.offsetHeight);
    window.scrollTo({
      top: sectionTop - top + distance * (progress >= 0.82 ? 0 : 0.98),
      behavior: "smooth",
    });
  });
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("pageshow", configure);
  desktop.addEventListener("change", configure);
  reduced.addEventListener("change", configure);
  configure();
}

export {};
