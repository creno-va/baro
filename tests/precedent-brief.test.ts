import { expect, test } from "bun:test";
import { precedentBrief } from "../src/client/precedent-brief";

test("brief prefers the stated judgment holding and retains source wording", () => {
  const holding = "합성 판결은 당사자가 약속한 물품을 전달했는지에 관한 사정을 확인했습니다.";
  expect(precedentBrief(`사건번호: 합성123\n【판결요지】\n${holding}\n참조조문: 합성`)).toBe(
    holding,
  );
});
test("a short or missing original never produces an invented summary", () => {
  expect(precedentBrief("")).toBe("");
  expect(precedentBrief("합성 짧은 원문")).toBe("합성 짧은 원문");
  const brief = precedentBrief("🙂".repeat(300));
  expect([...brief]).toHaveLength(241);
  expect(brief.endsWith("…")).toBe(true);
});
