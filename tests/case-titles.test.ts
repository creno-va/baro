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

test("manual case titles persist encrypted, replay once, reject stale owners and survive AI summary publication", async () => {
  const f = await customerWorkspaceFixture();
  try {
    let triedDuringJob = false;
    await runCustomerJob(f, "intake_questions", true, async () => {
      if (triedDuringJob) return;
      triedDuringJob = true;
      const current = await f.service.intake(f.owner.userId, f.workspace.id);
      if (!current) throw new Error("Missing synthetic intake");
      await expect(
        f.service.rename(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
          title: "처리 중에는 바꾸지 않을 제목",
          expectedTitle: caseDisplayTitle(current.narrative, current.caseTitle),
        }),
      ).rejects.toMatchObject({ code: "STALE_REVISION" });
    });
    const owner = f.owner.userId,
      id = f.workspace.id;
    const intake = await f.service.intake(owner, id);
    if (!intake) throw new Error("Missing synthetic intake");
    const title = "합성 계약 대금 반환 요청",
      key = crypto.randomUUID();
    const request = { title, expectedTitle: caseDisplayTitle(intake.narrative, intake.caseTitle) };
    const renamed = await f.service.rename(owner, id, key, request);
    expect((await f.service.intake(owner, id))?.caseTitle).toBe(title);
    expect(await f.repository.metadata({ ownerId: owner, now: f.now }, id)).not.toHaveProperty(
      "caseTitleEdited",
    );
    const encrypted = f.db.sqlite
      .query("SELECT encrypted_payload FROM v2_intakes WHERE id=?")
      .get(id);
    expect(JSON.stringify(encrypted)).not.toContain(title);
    expect((await f.service.rename(owner, id, key, request)).workspaceRevision).toBe(
      renamed.workspaceRevision,
    );
    await expect(
      f.service.rename(owner, id, key, { ...request, title: "다른 제목" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      f.service.rename(owner, id, crypto.randomUUID(), { ...request, title: "다른 제목" }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    await expect(
      f.service.rename("another-owner", id, crypto.randomUUID(), {
        title: "다른 제목",
        expectedTitle: title,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const invalid of ["", "가".repeat(41), "첫째\n둘째"])
      await expect(
        f.service.rename(owner, id, crypto.randomUUID(), { title: invalid, expectedTitle: title }),
      ).rejects.toThrow();
    await f.service.answers(owner, id, crypto.randomUUID(), {
      expectedRevision: intake.revision,
      answers: intake.batches[0]?.questions.map((q) => ({ questionId: q.id, status: "unknown" })),
    });
    await runCustomerJob(f, "intake_summary", true, undefined, 1, "AI가 새로 만든 합성 제목");
    expect((await f.service.intake(owner, id))?.caseTitle).toBe(title);
    expect((await f.service.previews(owner, await f.service.list(owner)))[0]?.title).toBe(title);
  } finally {
    f.db.close();
  }
});
