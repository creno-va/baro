import type { ReviewSection } from "./review-sections";

/** Excerpts of the user's current text, never a fresh analysis or a saved rewrite. */
export function reportOrientation(sections: readonly ReviewSection[]) {
  return [
    {
      label: "어디까지 이해했나요",
      titles: ["내 사건 한눈에", "사건 개요", "사건 요약", "사건의 사실과 주장"],
    },
    { label: "지금 준비할 일", titles: ["다음 행동과 필요 자료", "준비할 행동"] },
    {
      label: "더 확인할 내용",
      titles: ["추가 확인 사항", "미확인·상반되는 내용", "미확인 사항", "우리 측 약점과 보완"],
    },
  ].map(({ label, titles }) => {
    const index =
      titles
        .map((title) =>
          sections.findIndex((section) => section.title === title && section.text.trim()),
        )
        .find((index) => index >= 0) ?? -1;
    const section = sections[index];
    const text = section?.text.trim() ?? "";
    // A bounded, explicitly labelled excerpt must not turn an omitted condition into a complete summary.
    return { label, index, text: text.slice(0, 400), truncated: text.length > 400 };
  });
}
