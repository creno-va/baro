/** A reversible scroll illustration, with a compact before/after interaction on small screens. */
type ClarityTopic = "deposit" | "money" | "work";
type ClarityCopy = {
  quotes: string[];
  files: string[];
  results: string[];
  details: string[];
};

const clarityCopy: Record<ClarityTopic, ClarityCopy> = {
  deposit: {
    quotes: [
      "계약은 끝났는데,\n보증금을 못 받았어요.",
      "어떤 이야기부터\n꺼내야 할까요?",
      "연락했던 날짜가\n잘 기억나지 않아요.",
      "무슨 자료부터\n준비해야 하죠?",
    ],
    files: ["임대차 계약서.pdf", "주고받은 문자.png"],
    results: [
      "계약일과 종료일, 연락한 날짜를 차례로 모아요.",
      "계약 내용과 보증금, 확인한 대화를 구분해요.",
      "아직 모르는 내용과 상담에서 확인할 질문을 남겨요.",
    ],
    details: [
      "계약 → 대화 → 지금의 상황",
      "내가 말한 사실 · 자료에서 확인한 내용",
      "확인할 내용 · 필요한 자료 · 상담 질문",
    ],
  },
  money: {
    quotes: [
      "빌려준 돈을\n아직 못 받았어요.",
      "약속했던 날짜가\n언제였더라?",
      "이체 내역이랑 대화가\n서로 다른 곳에 있어요.",
      "처음부터 다시\n설명해야 할까요?",
    ],
    files: ["계좌 이체 내역.pdf", "빌려줄 때의 대화.png"],
    results: [
      "돈을 보낸 날과 약속한 날, 이후의 연락을 연결해요.",
      "이체 금액과 약속한 내용, 자료에서 확인한 사실을 나눠요.",
      "추가로 확인할 자료와 상담에서 묻고 싶은 내용을 모아요.",
    ],
    details: [
      "이체 → 반환 약속 → 이후의 대화",
      "이체 기록 · 약속한 내용 · 확인이 필요한 부분",
      "추가 자료 · 아직 모르는 내용 · 상담 질문",
    ],
  },
  work: {
    quotes: [
      "일터에서 있었던 일,\n어디서부터 말하죠?",
      "그날 어떤 말을\n들었는지 정리하고 싶어요.",
      "메시지와 계약서가\n따로 흩어져 있어요.",
      "상담할 때 중요한 걸\n잊을까 걱정돼요.",
    ],
    files: ["근로 계약서.pdf", "업무 관련 메시지.png"],
    results: [
      "일이 있었던 날짜와 나눈 대화를 순서대로 기록해요.",
      "직접 겪은 일과 자료로 확인한 내용을 구분해요.",
      "꺼내기 어려웠던 이야기와 확인하고 싶은 질문을 준비해요.",
    ],
    details: [
      "처음 있었던 일 → 대화 → 현재 상황",
      "내가 겪은 사실 · 관련 기록 · 확인할 부분",
      "전달하고 싶은 이야기 · 준비 자료 · 상담 질문",
    ],
  },
};

const clarityClamp = (value: number) => Math.max(0, Math.min(1, value));
const clarityEase = (value: number) => value * value * (3 - 2 * value);

for (const section of document.querySelectorAll<HTMLElement>("[data-clarity]")) {
  const pin = section.querySelector<HTMLElement>("[data-clarity-pin]");
  const visual = section.querySelector<HTMLElement>("[data-clarity-visual]");
  const action = section.querySelector<HTMLButtonElement>("[data-clarity-play]");
  if (!pin || !visual || !action) continue;

  // The same story has a compact touch layout; short landscape screens use the static controls.
  const motionViewport = window.matchMedia(
    "(min-width: 768px) and (min-height: 640px), (min-width: 320px) and (max-width: 767px) and (min-height: 520px)",
  );
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const inputs = [...section.querySelectorAll<HTMLElement>("[data-clarity-input]")].map((node) => ({
    node,
    x: Number(node.dataset.x) || 0,
    y: Number(node.dataset.y) || 0,
    turn: Number(node.dataset.turn) || 0,
  }));
  const outputs = [...section.querySelectorAll<HTMLElement>("[data-clarity-output]")];
  const topics = [...section.querySelectorAll<HTMLButtonElement>("[data-clarity-topic]")];
  const phaseNumber = section.querySelector<HTMLElement>("[data-clarity-phase-number]");
  const phaseLabel = section.querySelector<HTMLElement>("[data-clarity-phase-label]");
  const actionLabel = section.querySelector<HTMLElement>("[data-clarity-play-label]");
  let frame = 0;
  let animated = false;
  let stage = -1;
  let progress = 0;
  let staticAfter = false;

  function setPhase(next: number) {
    if (stage === next) return;
    stage = next;
    if (phaseNumber) phaseNumber.textContent = `0${next + 1}`;
    if (phaseLabel)
      phaseLabel.textContent =
        ["흩어진 이야기를 모아요", "BARO에서 하나씩 정리해요", "내가 확인할 준비가 돼요"][next] ??
        "흩어진 이야기를 모아요";
    if (actionLabel)
      actionLabel.textContent = next === 2 ? "처음부터 다시 보기" : "정리되는 과정 보기";
    action?.setAttribute("aria-expanded", String(next === 2));
  }

  function showStatic(after: boolean) {
    staticAfter = after;
    section.dataset.clarityView = after ? "after" : "before";
    section.style.setProperty("--clarity-progress", after ? "1" : "0");
    setPhase(after ? 2 : 0);
  }

  function render() {
    frame = 0;
    if (!animated || !pin || !visual) return;
    const bounds = section.getBoundingClientRect();
    const top = Number.parseFloat(getComputedStyle(pin).top) || 76;
    const range = Math.max(1, section.offsetHeight - pin.offsetHeight);
    progress = clarityClamp((top - bounds.top) / range);
    const converge = clarityEase(clarityClamp((progress - 0.04) / 0.45));
    const opening = clarityEase(clarityClamp((progress - 0.54) / 0.3));
    const vanish = clarityEase(clarityClamp((progress - 0.37) / 0.13));
    const width = Math.max(150, visual.clientWidth - (window.innerWidth < 768 ? 135 : 265));
    const height = Math.max(160, visual.clientHeight - 104);

    section.style.setProperty("--clarity-progress", progress.toFixed(4));
    section.style.setProperty("--clarity-converge", converge.toFixed(4));
    section.style.setProperty("--clarity-open", opening.toFixed(4));
    section.style.setProperty(
      "--clarity-brand-scale",
      (1 + converge * 0.16 - opening * 0.38).toFixed(4),
    );
    section.style.setProperty("--clarity-brand-opacity", (1 - opening).toFixed(4));

    for (const input of inputs) {
      const remaining = 1 - converge;
      const x = (input.x * width * remaining) / 2;
      const y = (input.y * height * remaining) / 2;
      input.node.style.transform = `translate(calc(-50% + ${x.toFixed(2)}px), calc(-50% + ${y.toFixed(2)}px)) rotate(${(input.turn * remaining).toFixed(2)}deg) scale(${(1 - converge * 0.75).toFixed(4)})`;
      input.node.style.opacity = (1 - vanish).toFixed(4);
    }

    for (const [index, output] of outputs.entries()) {
      const unfold = clarityEase(clarityClamp((progress - 0.56 - index * 0.055) / 0.26));
      output.style.setProperty("--clarity-card-open", unfold.toFixed(4));
      output.style.setProperty("--clarity-card-x", `${(-105 * (1 - unfold)).toFixed(2)}px`);
      output.style.setProperty(
        "--clarity-card-y",
        `${((1 - index) * 110 * (1 - unfold)).toFixed(2)}px`,
      );
      output.style.setProperty("--clarity-card-scale", (0.72 + unfold * 0.28).toFixed(4));
    }
    setPhase(progress < 0.31 ? 0 : progress < 0.9 ? 1 : 2);
  }

  function schedule() {
    if (animated && !frame) frame = window.requestAnimationFrame(render);
  }

  function configure() {
    animated = motionViewport.matches && !reducedMotion.matches;
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    section.classList.toggle("clarity-motion-ready", animated);
    section.classList.toggle("clarity-static-ready", !animated);
    stage = -1;
    for (const input of inputs) {
      input.node.style.removeProperty("transform");
      input.node.style.removeProperty("opacity");
    }
    if (animated) {
      delete section.dataset.clarityView;
      render();
    } else {
      showStatic(staticAfter);
    }
  }

  function changeTopic(topic: ClarityTopic) {
    const copy = clarityCopy[topic];
    for (const button of topics)
      button.setAttribute("aria-pressed", String(button.dataset.clarityTopic === topic));
    for (const [selector, values] of [
      ["[data-clarity-quote]", copy.quotes],
      ["[data-clarity-file]", copy.files],
      ["[data-clarity-result]", copy.results],
      ["[data-clarity-detail]", copy.details],
    ] as const) {
      for (const [index, node] of section.querySelectorAll<HTMLElement>(selector).entries()) {
        node.textContent = values[index] ?? "";
        if (selector === "[data-clarity-quote]") node.style.whiteSpace = "pre-line";
      }
    }
  }

  for (const button of topics) {
    button.addEventListener("click", () => {
      const topic = button.dataset.clarityTopic;
      if (topic === "deposit" || topic === "money" || topic === "work") changeTopic(topic);
    });
  }

  action.addEventListener("click", () => {
    if (!animated || !pin) {
      showStatic(!staticAfter);
      return;
    }
    const top = Number.parseFloat(getComputedStyle(pin).top) || 76;
    const sectionTop = section.getBoundingClientRect().top + window.scrollY;
    const range = Math.max(1, section.offsetHeight - pin.offsetHeight);
    window.scrollTo({
      top: sectionTop - top + range * (progress >= 0.9 ? 0 : 0.96),
      behavior: "smooth",
    });
  });

  const controls = section.querySelector<HTMLElement>("[data-clarity-controls]");
  if (controls) controls.hidden = false;
  action.hidden = false;
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("pageshow", configure);
  motionViewport.addEventListener("change", configure);
  reducedMotion.addEventListener("change", configure);
  configure();
}
