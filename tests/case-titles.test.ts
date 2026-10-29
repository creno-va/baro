import { expect, test } from "bun:test";
import { caseDisplayTitle, caseTitleSchema, v2IntakeSchema } from "../src/contracts/v2";
import { customerWorkspaceFixture, runCustomerJob } from "./helpers/customer-workspace";

test("case labels summarize existing issues without copying names, amounts or dates", () => {
  const narrative =
    "기능 연결용 합성 사건입니다. 2026년 9월 1일 지인에게 10만 원을 빌려줬고 9월 30일까지 돌려받기로 했어요.";
  expect(caseDisplayTitle(narrative)).toBe("빌려준 돈과 반환 약속");
  expect(caseDisplayTitle("촬영용 카메라를 대여했는데 반납 관련 분쟁이 생겼어요.")).toBe(
    "대여 물품과 이용 문제",
  );
  expect(caseDisplayTitle("상해보험 처리에 필요한 기록을 확인하고 싶어요.")).not.toContain("폭행");
  expect(caseDisplayTitle("임대차 계약이 끝났는데 보증금을 받지 못했습니다.")).toBe(
    "임대차 보증금과 반환 문제",
  );
  expect(caseDisplayTitle(narrative, "지인에게 빌려준 돈의 반환 문제")).toBe(
    "지인에게 빌려준 돈의 반환 문제",
  );
  expect(caseTitleSchema.safeParse("가".repeat(41)).success).toBe(false);
  expect(caseTitleSchema.safeParse("제목\n다음 줄").success).toBe(false);
});

for (const approved of [true, false])
  test(`summary title publication keeps encryption, wire compatibility and audit approval=${approved}`, async () => {
    const f = await customerWorkspaceFixture();
    try {
      await runCustomerJob(f, "intake_questions");
      const intake = await f.service.intake(f.owner.userId, f.workspace.id);
      if (!intake) throw new Error("Missing synthetic intake");
      await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
        expectedRevision: intake.revision,
        answers: intake.batches[0]?.questions.map((q) => ({ questionId: q.id, status: "unknown" })),
      });
      const title = "거래 자료와 계약 이행 확인";
      const result = await runCustomerJob(f, "intake_summary", approved, undefined, 1, title);
      const stored = await f.service.intake(f.owner.userId, f.workspace.id);
      if (!approved) {
        expect(result.result.status).not.toBe("completed");
        expect(stored?.caseTitle).toBeUndefined();
        expect(stored?.narrative).toBe(intake.narrative);
        return;
      }
      expect(result.result.status).toBe("completed");
      expect(stored?.caseTitle).toBe(title);
      const full = await f.repository.readIntake(
        { ownerId: f.owner.userId, now: f.now },
        f.workspace.id,
      );
      expect(v2IntakeSchema.safeParse(full).success).toBe(true);
      expect(full?.summary).not.toHaveProperty("caseTitle");
      expect(full?.narrative).toBe(intake.narrative);
      const preview = await f.service.previews(
        f.owner.userId,
        await f.service.list(f.owner.userId),
      );
      expect(preview[0]?.title).toBe(title);
      const row = f.db.sqlite
        .query("SELECT encrypted_payload FROM v2_intakes WHERE id=?")
        .get(f.workspace.id);
      expect(JSON.stringify(row)).not.toContain(title);
      expect(await f.service.intake("another-owner", f.workspace.id).catch(() => null)).toBeNull();
    } finally {
      f.db.close();
    }
  });
