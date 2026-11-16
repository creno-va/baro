export type DemoFeature = "conversation" | "files" | "timeline" | "report";
export type DemoScenario = {
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

export const demoScenarios: Record<string, DemoScenario> = {
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
