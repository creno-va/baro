/** One small blue opening expands into a workspace; four features turn in on scroll. */
const blueReveal = document.querySelector<HTMLElement>("[data-blue-reveal]");

if (blueReveal) {
  const root = blueReveal;
  const pin = root.querySelector<HTMLElement>(".blue-reveal-pin");
  const experience = root.querySelector<HTMLElement>(".blue-reveal-experience");
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-blue-tab]")];
  const panels = [...root.querySelectorAll<HTMLElement>("[data-blue-panel]")];
  const titles = [
    "잘 정리하지 않아도, 이야기는 시작돼요.",
    "여기저기 흩어진 기록을, 한곳에서.",
    "뒤섞인 기억에도, 순서가 생겨요.",
    "다시 설명할 걱정은, 한결 가볍게.",
  ];
  const descriptions = [
    "어려운 말 대신, 지금 겪은 일을 편하게 들려주세요.",
    "이야기에 필요한 자료를 모아, 확인할 사실과 연결해요.",
    "언제 어떤 일이 있었는지, 확인한 내용부터 차근차근.",
    "내가 검토한 이야기와 선택한 자료로 상담을 준비해요.",
  ];
  const motionViewport = window.matchMedia(
    "(min-width: 900px) and (min-height: 720px), (min-width: 320px) and (max-width: 899px) and (min-height: 520px)",
  );
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const ease = (value: number) => {
    const t = clamp(value);
    return t * t * (3 - 2 * t);
  };
  let animated = false;
  let manual = false;
  let selected = -1;
  let frame = 0;

  function select(index: number) {
    if (selected === index) return;
    selected = index;
    root.dataset.blueSelected = String(index);
    for (const [position, tab] of tabs.entries()) {
      tab.setAttribute("aria-selected", String(position === index));
      tab.tabIndex = position === index ? 0 : -1;
    }
    for (const [position, panel] of panels.entries()) panel.hidden = position !== index;
    const heading = root.querySelector("[data-blue-lead]");
    const description = root.querySelector("[data-blue-description]");
    const counter = root.querySelector("[data-blue-counter]");
    if (heading) heading.textContent = titles[index] ?? titles[0] ?? "";
    if (description) description.textContent = descriptions[index] ?? descriptions[0] ?? "";
    if (counter) counter.textContent = `0${index + 1} / 04`;
  }

  function render() {
    frame = 0;
    if (!animated || !pin) return;
    const bounds = root.getBoundingClientRect();
    if (!manual && (bounds.bottom < 0 || bounds.top > window.innerHeight)) return;
    const top = Number.parseFloat(getComputedStyle(pin).top) || 76;
    const range = Math.max(1, root.offsetHeight - pin.offsetHeight);
    const actual = clamp((top - bounds.top) / range);
    const progress = manual ? Math.max(0.4, actual) : actual;
    const expansion = ease(progress / 0.285);
    const appear = ease((progress - 0.245) / 0.1);
    const opening = 1 - ease((progress - 0.015) / 0.16);
    const radius = Math.hypot(pin.clientWidth / 2, pin.clientHeight * 0.57);
    const scale = 1 + expansion * ((radius / 40) * 1.06 - 1);
    const featureProgress = clamp((progress - 0.32) / 0.68);
    const next = Math.min(3, Math.floor(featureProgress * 4));
    root.style.setProperty("--blue-progress", progress.toFixed(4));
    root.style.setProperty("--blue-circle-scale", scale.toFixed(4));
    root.style.setProperty("--blue-opening-opacity", opening.toFixed(3));
    root.style.setProperty("--blue-seed-opacity", (1 - ease(progress / 0.1)).toFixed(3));
    root.style.setProperty("--blue-app-opacity", appear.toFixed(3));
    root.style.setProperty("--blue-app-rise", `${((1 - appear) * 75).toFixed(2)}px`);
    root.style.setProperty("--blue-app-scale", (0.86 + appear * 0.14).toFixed(4));
    root.style.setProperty("--blue-app-tilt", `${((1 - appear) * 13).toFixed(2)}deg`);
    root.classList.toggle("blue-reveal-open", appear > 0.95);
    if (experience) experience.style.pointerEvents = appear > 0.95 ? "auto" : "none";
    for (const [index, tab] of tabs.entries()) {
      const turn = ease((featureProgress * 4 - index) / 0.48);
      tab.style.setProperty("--blue-feature-turn", `${(turn * 360).toFixed(2)}deg`);
      tab.style.setProperty(
        "--blue-feature-lift",
        `${(-Math.sin(turn * Math.PI) * 14).toFixed(2)}px`,
      );
    }
    if (!manual) select(next);
  }

  function schedule() {
    if (animated && !frame) frame = requestAnimationFrame(render);
  }

  function choose(index: number) {
    manual = true;
    root.classList.add("blue-reveal-manual");
    select(index);
    schedule();
  }

  function resume() {
    manual = false;
    root.classList.remove("blue-reveal-manual");
    schedule();
  }

  function configure() {
    animated = motionViewport.matches && !reduced.matches;
    root.classList.add("blue-reveal-enhanced");
    root.classList.toggle("blue-reveal-motion", animated);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    manual = false;
    root.classList.remove("blue-reveal-manual");
    const controls = root.querySelector<HTMLElement>("[data-blue-tabs]");
    if (controls) controls.hidden = false;
    for (const [index, panel] of panels.entries()) {
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tabs[index]?.id ?? "blue-reveal-title");
      panel.tabIndex = 0;
    }
    select(selected < 0 ? 0 : selected);
    if (animated) schedule();
    else {
      experience?.style.removeProperty("pointer-events");
      for (const tab of tabs) {
        tab.style.removeProperty("--blue-feature-turn");
        tab.style.removeProperty("--blue-feature-lift");
      }
    }
  }

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => choose(index));
    tab.addEventListener("focus", () => {
      if (tab.matches(":focus-visible")) choose(index);
    });
    tab.addEventListener("keydown", (event) => {
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      tabs[next]?.focus({ preventScroll: true });
      choose(next);
    });
  }

  for (const link of root.querySelectorAll<HTMLAnchorElement>("[data-blue-demo]")) {
    link.addEventListener("focus", () => {
      if (link.matches(":focus-visible")) choose(selected < 0 ? 0 : selected);
    });
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const request = new CustomEvent("baro:demo-feature", {
        detail: { feature: link.dataset.blueDemo },
        cancelable: true,
      });
      if (!window.dispatchEvent(request)) event.preventDefault();
    });
  }
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("wheel", resume, { passive: true });
  window.addEventListener("touchmove", resume, { passive: true });
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
      target.closest("button, a, [role='button']")
    )
      return;
    resume();
  });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("pageshow", configure);
  motionViewport.addEventListener("change", configure);
  reduced.addEventListener("change", configure);
  configure();
}

export {};
