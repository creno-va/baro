type DemoFeature = "conversation" | "files" | "timeline" | "report";
type DemoScenario = {
  title: string;
  narrative: string;
  question: string;
  answer: string;
  fact: string;
  summary: string;
  consultation: string;
  files: { title: string; description: string }[];
  timeline: { date: string; title: string; body: string; file: number }[];
};

const demoScenarios: Record<string, DemoScenario> = {
  loan: {
    title: "돌려받지 못한 돈",
    narrative: "지인에게 빌려준 돈을 약속한 날짜에 돌려받지 못했어요.",
    question: "언제, 어떤 방식으로 빌려주셨나요? 돌려받기로 한 날짜도 함께 알려주세요.",
    answer:
      "3월 12일에 300만 원을 계좌로 보냈어요. 4월 12일까지 돌려주기로 했고, 그 약속은 메시지로 남아 있어요.",
    fact: "대여일 3월 12일 · 약속한 반환일 4월 12일",
    summary:
      "2026년 3월 12일, 지인에게 300만 원을 계좌로 보냈습니다. 메시지에서 4월 12일까지 돌려받기로 약속했습니다. 4월 16일 현재 돌려받지 못한 상황을 예시로 정리했습니다.",
    consultation: "현재 가지고 있는 자료 외에 어떤 사실과 자료를 더 확인하면 좋을까요?",
    files: [
      { title: "계좌 이체 내역.pdf", description: "3월 12일 · 보낸 날짜와 금액" },
      { title: "주고받은 메시지.png", description: "4월 12일 · 반환 약속에 관한 대화" },
      { title: "기억해 둔 내용.txt", description: "4월 16일 · 추가로 확인할 이야기" },
    ],
    timeline: [
      {
        date: "2026-03-12",
        title: "300만 원을 보냈어요",
        body: "예시 대화에서 확인한 대여 날짜와 금액이에요.",
        file: 0,
      },
      {
        date: "2026-04-12",
        title: "약속한 반환일이 지났어요",
        body: "메시지에 남아 있는 약속 날짜를 확인해요.",
        file: 1,
      },
      {
        date: "2026-04-16",
        title: "아직 돌려받지 못했다고 기록했어요",
        body: "이후에 나눈 대화나 달라진 상황이 있는지 살펴봐요.",
        file: 2,
      },
    ],
  },
  deposit: {
    title: "돌려받을 보증금",
    narrative: "임대차 계약이 끝났는데, 보증금을 아직 돌려받지 못했어요.",
    question: "계약서에 적힌 종료일은 언제인가요? 집주인과 나눈 이야기도 알려주세요.",
    answer:
      "계약은 6월 30일까지였어요. 4월 1일에 계약을 마칠 예정이라고 메시지를 보냈고, 보증금은 2,000만 원이에요.",
    fact: "계약 종료일 6월 30일 · 보증금 2,000만 원",
    summary:
      "예시 계약서의 종료일은 2026년 6월 30일이며 보증금은 2,000만 원입니다. 4월 1일에 계약을 마칠 예정이라는 메시지를 보냈습니다. 계약 종료 후 보증금을 돌려받지 못한 상황을 정리했습니다.",
    consultation: "계약 종료와 보증금 반환에 관해 어떤 사실을 추가로 확인해야 할까요?",
    files: [
      { title: "임대차 계약서.pdf", description: "계약 기간과 보증금이 적힌 예시" },
      { title: "집주인과 나눈 대화.png", description: "4월 1일 · 계약 종료에 관한 메시지" },
      { title: "보증금 이체 내역.pdf", description: "계약 당시 보증금을 보낸 예시 기록" },
    ],
    timeline: [
      {
        date: "2024-07-01",
        title: "임대차 계약을 시작했어요",
        body: "계약서와 보증금을 보낸 내역을 확인할 수 있어요.",
        file: 2,
      },
      {
        date: "2026-04-01",
        title: "계약을 마칠 예정이라고 이야기했어요",
        body: "어떤 내용을 주고받았는지 메시지 원문을 살펴봐요.",
        file: 1,
      },
      {
        date: "2026-06-30",
        title: "계약서에 적힌 종료일이에요",
        body: "반환 여부와 이후의 대화는 추가로 확인할 내용이에요.",
        file: 0,
      },
    ],
  },
  wage: {
    title: "받지 못한 급여",
    narrative: "일한 기간의 급여가 약속한 날에 들어오지 않았어요.",
    question: "언제까지 일했고, 급여는 언제 받기로 했나요? 남아 있는 기록도 함께 확인해요.",
    answer:
      "8월 1일부터 31일까지 일했어요. 9월 10일에 240만 원을 받기로 했는데, 9월 15일에도 입금되지 않았어요.",
    fact: "일한 기간 8월 1~31일 · 약속한 지급일 9월 10일",
    summary:
      "2026년 8월 1일부터 31일까지 일한 상황의 예시입니다. 9월 10일에 급여 240만 원을 받기로 했으며, 9월 15일에도 입금되지 않았다고 기록했습니다. 계약 내용과 실제 근무 기록을 함께 확인하려고 합니다.",
    consultation: "근무 기간과 지급 약속을 확인하려면 어떤 자료를 더 준비해야 할까요?",
    files: [
      { title: "근로 계약서.pdf", description: "약속한 급여와 지급일에 관한 예시" },
      { title: "근무 기록.xlsx", description: "8월 1~31일 · 일한 날짜를 적은 기록" },
      { title: "급여 관련 메시지.png", description: "9월 15일 · 지급 여부를 확인한 대화" },
    ],
    timeline: [
      {
        date: "2026-08-01",
        title: "이 기간의 근무를 시작했어요",
        body: "8월 31일까지의 근무 기록을 함께 살펴봐요.",
        file: 1,
      },
      {
        date: "2026-09-10",
        title: "약속한 급여일이에요",
        body: "계약서에 적힌 지급 약속을 확인해요.",
        file: 0,
      },
      {
        date: "2026-09-15",
        title: "입금되지 않은 상황을 기록했어요",
        body: "이후 지급된 금액이나 추가 대화가 있는지 확인해요.",
        file: 2,
      },
    ],
  },
};

const demoRoot = document.querySelector<HTMLElement>("[data-baro-demo]");
if (demoRoot) {
  const root = demoRoot;
  const features: DemoFeature[] = ["conversation", "files", "timeline", "report"];
  const labels = ["이야기", "자료 선택", "타임라인", "상담 준비"];
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector);
  const all = <T extends HTMLElement>(selector: string) => [...root.querySelectorAll<T>(selector)];
  let scenario = demoScenarios.loan as DemoScenario;
  let answered = false;
  let complete = false;
  let selected = new Set([0, 1]);
  let summary = scenario.summary;
  const textarea = find<HTMLTextAreaElement>("[data-demo-report-summary]");
  const confirms = all<HTMLInputElement>("[data-demo-confirm]");

  function text(selector: string, value: string) {
    const node = find(selector);
    if (node) node.textContent = value;
  }
  function announce(message: string) {
    text("[data-demo-live]", message);
  }
  function refreshReview() {
    const finish = find<HTMLButtonElement>("[data-demo-finish]");
    if (finish) finish.disabled = !summary.trim() || !confirms.every((input) => input.checked);
    const confirmation = find("[data-demo-complete]");
    if (confirmation) confirmation.hidden = !complete;
    const actions = find("[data-demo-report-actions]");
    if (actions) actions.hidden = complete;
    text("[data-demo-case-state]", complete ? "예시 체험 완료" : "이야기 정리 중");
  }
  function invalidateReview() {
    complete = false;
    for (const input of confirms) input.checked = false;
    refreshReview();
  }
  function refreshFiles() {
    for (const [index, file] of scenario.files.entries()) {
      text(`[data-demo-file-title="${index}"]`, file.title);
      text(`[data-demo-file-description="${index}"]`, file.description);
      const checkbox = find<HTMLInputElement>(`[data-demo-file="${index}"]`);
      if (checkbox) checkbox.checked = selected.has(index);
    }
    text(
      "[data-demo-file-count]",
      selected.size
        ? `예시 자료 ${selected.size}개를 함께 살펴봐요.`
        : "자료 없이 대화 내용만으로도 이어갈 수 있어요.",
    );
    const materialList = find("[data-demo-report-files]");
    if (materialList) {
      materialList.replaceChildren();
      if (!selected.size) {
        const note = document.createElement("p");
        note.textContent = "선택한 자료가 없어요. 예시 대화 내용을 기준으로 살펴봐요.";
        materialList.appendChild(note);
      }
      for (const index of selected) {
        const chip = document.createElement("span");
        chip.className = "demo-report-file";
        chip.textContent = scenario.files[index]?.title ?? "";
        materialList.appendChild(chip);
      }
    }
    for (const [index, event] of scenario.timeline.entries()) {
      const date = find<HTMLTimeElement>(`[data-demo-date="${index}"]`);
      if (date) {
        date.dateTime = event.date;
        const [year, month, day] = event.date.split("-");
        date.textContent = `${year}년 ${Number(month)}월 ${Number(day)}일`;
      }
      text(`[data-demo-event-title="${index}"]`, event.title);
      text(`[data-demo-event-body="${index}"]`, event.body);
      text(
        `[data-demo-event-source="${index}"]`,
        selected.has(event.file)
          ? `${scenario.files[event.file]?.title} · 선택한 가상 자료에 연결된 예시예요.`
          : "이 날짜에 연결할 자료를 선택하지 않았어요. 예시 대화에서 확인한 내용이에요.",
      );
    }
  }
  function openFeature(next: DemoFeature, focus = false) {
    for (const panel of all("[data-demo-panel]")) panel.hidden = panel.dataset.demoPanel !== next;
    for (const tab of all<HTMLButtonElement>("[data-demo-tab]")) {
      const active = tab.dataset.demoTab === next;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    const index = features.indexOf(next);
    const progress = find<HTMLProgressElement>("[data-demo-progress]");
    if (progress) progress.value = index + 1;
    text("[data-demo-progress-text]", `${index + 1} / 4 · ${labels[index]}`);
    announce(`${labels[index]} 단계예요.`);
    if (focus) {
      const heading = find(`[data-demo-panel="${next}"] [data-demo-focus]`);
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({
        behavior: motion.matches ? "instant" : "smooth",
        block: "nearest",
      });
    }
  }
  function refreshConversation() {
    const group = find("[data-demo-answer-group]");
    const button = find("[data-demo-answer-button]");
    const next = find("[data-demo-conversation-next]");
    if (group) group.hidden = !answered;
    if (button) button.hidden = answered;
    if (next) next.hidden = !answered;
    text(
      "[data-demo-conversation-hint]",
      answered
        ? "대화에서 확인한 사실을 자료와 연결해 볼게요."
        : "실제 입력 없이, 예시 답변으로 체험해요.",
    );
  }
  function reset(key: string) {
    const next = demoScenarios[key];
    if (!next) return;
    scenario = next;
    answered = false;
    selected = new Set([0, 1]);
    summary = next.summary;
    if (textarea) textarea.value = summary;
    for (const details of all<HTMLDetailsElement>(".demo-timeline details")) details.open = false;
    text("[data-demo-case-title]", next.title);
    text("[data-demo-narrative]", next.narrative);
    text("[data-demo-question]", next.question);
    text("[data-demo-answer]", next.answer);
    text("[data-demo-fact]", next.fact);
    text("[data-demo-report-question]", next.consultation);
    refreshFiles();
    refreshConversation();
    invalidateReview();
    openFeature("conversation");
  }

  for (const input of all<HTMLInputElement>('input[name="baro-demo-scenario"]'))
    input.addEventListener("change", () => {
      if (!input.checked) return;
      reset(input.value);
      announce(`${scenario.title} 예시를 시작해요.`);
    });
  find("[data-demo-restart]")?.addEventListener("click", () => {
    const chosen = find<HTMLInputElement>('input[name="baro-demo-scenario"]:checked');
    reset(chosen?.value ?? "loan");
    openFeature("conversation", true);
    announce("선택한 이야기의 체험을 처음부터 다시 시작해요.");
  });
  find("[data-demo-answer-button]")?.addEventListener("click", () => {
    answered = true;
    refreshConversation();
    find("[data-demo-conversation-next]")?.focus({ preventScroll: true });
    announce("예시 답변이 추가됐어요. 확인한 날짜와 약속을 살펴보고 자료를 선택해 보세요.");
  });
  for (const button of all<HTMLButtonElement>("[data-demo-next]"))
    button.addEventListener("click", () => {
      const next = button.dataset.demoNext;
      if (features.includes(next as DemoFeature)) openFeature(next as DemoFeature, true);
    });
  const tabs = all<HTMLButtonElement>("[data-demo-tab]");
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => openFeature(features[index] as DemoFeature));
    tab.addEventListener("keydown", (event) => {
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      openFeature(features[next] as DemoFeature);
      tabs[next]?.focus({ preventScroll: true });
    });
  }
  for (const checkbox of all<HTMLInputElement>("[data-demo-file]"))
    checkbox.addEventListener("change", () => {
      const index = Number(checkbox.dataset.demoFile);
      if (checkbox.checked) selected.add(index);
      else selected.delete(index);
      refreshFiles();
      invalidateReview();
      announce(
        selected.size
          ? `예시 자료 ${selected.size}개를 선택했어요.`
          : "자료 없이 대화 내용으로 이어갈 수 있어요.",
      );
    });
  textarea?.addEventListener("input", () => {
    summary = textarea.value;
    invalidateReview();
  });
  textarea?.addEventListener("change", () =>
    announce("요약을 수정했어요. 사실과 자료를 다시 확인해 주세요."),
  );
  for (const input of confirms)
    input.addEventListener("change", () => {
      if (!confirms.every((item) => item.checked)) complete = false;
      refreshReview();
    });
  find("[data-demo-finish]")?.addEventListener("click", () => {
    if (!summary.trim() || !confirms.every((input) => input.checked)) return;
    complete = true;
    refreshReview();
    find("[data-demo-complete] a")?.focus({ preventScroll: true });
    find("[data-demo-complete]")?.scrollIntoView({
      behavior: motion.matches ? "instant" : "smooth",
      block: "nearest",
    });
    announce("예시 체험을 마쳤어요. 실제 내 이야기로 시작할 수 있어요.");
  });
  window.addEventListener("baro:demo-feature", (event) => {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    if (!detail || typeof detail !== "object" || !("feature" in detail)) return;
    const next = detail.feature;
    if (typeof next !== "string" || !features.includes(next as DemoFeature)) return;
    if (next !== "conversation") {
      answered = true;
      refreshConversation();
    }
    openFeature(next as DemoFeature, true);
    root.scrollIntoView({ behavior: motion.matches ? "instant" : "smooth", block: "start" });
  });

  reset("loan");
  const interactive = find("[data-demo-interactive]");
  const fallback = find("[data-demo-fallback]");
  if (interactive) interactive.hidden = false;
  if (fallback) fallback.hidden = true;
  root.classList.add("demo-lab-ready");
  // Keep the initial page load quiet; announce only after a visitor interacts.
  text("[data-demo-live]", "");
}

export {};
