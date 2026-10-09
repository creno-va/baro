import { expect, type Page, test } from "@playwright/test";

const base = "/cases/completion-case";
const storage = "baro-api-mock-v1:";
async function seed(page: Page) {
  await page.goto("/login");
  await page.evaluate((prefix) => {
    const now = new Date().toISOString();
    const facts = ["반환 약속은 2025년이라는 진술", "반환 약속은 2026년이라는 진술"].map(
      (text, index) => ({
        id: `fact-${index}`,
        text,
        attribution: "user_statement",
        certainty: "reported",
        significance: index ? "unfavorable" : "neutral",
        references: [{ kind: "intake_narrative", intakeRevision: 1 }],
        conflictingFactIds: [],
        userEdited: false,
      }),
    );
    const item = {
      id: "completion-case",
      title: "합성 고객 인수 사건",
      subjectContext: "individual",
      stage: "active",
      revision: 1,
      updatedAt: now,
      summary: "반환 약속과 관련 인물을 정리한 합성 사건입니다.",
      schemaVersion: "2",
      summaryDetails: {
        schemaVersion: "2",
        revision: 1,
        intakeRevision: 1,
        createdAt: now,
        overview: "반환 약속과 관련 인물을 정리한 합성 사건입니다.",
        facts,
        parties: [{ id: "party-one", label: "합성 상대방", role: "차용인" }],
        unknowns: ["날짜 원본 확인"],
        notices: ["합성 검증용 요약"],
      },
    };
    const values = {
      session: {
        user: { id: "completion-owner", name: "합성 사용자", accountType: "customer" },
        needsConsent: false,
      },
      cases: { "completion-case": item },
      caseOwners: { "completion-case": "completion-owner" },
      workspace: {
        "completion-case": {
          messages: [
            {
              id: "message-one",
              role: "assistant",
              text: "출처와 원본을 함께 확인해 주세요.",
              status: "complete",
              createdAt: now,
              warnings: ["근거 검증에 실패한 주장은 포함하지 않았습니다."],
              citations: [
                {
                  id: "citation-one",
                  title: "합성 공식 안내",
                  url: "https://www.law.go.kr/법령/민법",
                },
              ],
              references: [
                {
                  kind: "user_material",
                  fileId: "file-one",
                  fileRevision: 1,
                  position: { kind: "document", page: 1, paragraph: null, table: null },
                },
              ],
            },
          ],
          timeline: [],
          actions: [],
        },
      },
      files: {
        "completion-case": [
          {
            id: "file-one",
            name: "합성 원본.txt",
            mimeType: "text/plain",
            sizeBytes: 80,
            status: "ready",
            coverage: "합성 처리 예시",
            extractedText: "원본 추출 내용의 합성 문장",
          },
        ],
      },
    };
    for (const [key, value] of Object.entries(values))
      localStorage.setItem(prefix + key, JSON.stringify(value));
  }, storage);
}

test("structured facts, contradictions and gaps save after confirmation and remain after reconnect", async ({
  page,
}) => {
  await seed(page);
  await page.goto(`${base}/summary`);
  await expect(page.getByRole("heading", { name: "사실·모순·정보 공백 확인" })).toBeVisible();
  await page.getByLabel("사실 내용", { exact: true }).first().fill("원본 확인 후 수정한 반환 연도");
  await page.getByLabel("확인 상태", { exact: true }).first().selectOption("conflicting");
  await page.getByLabel("모순되는 사실 선택").selectOption("fact-1");
  await page
    .getByLabel("확인할 정보 공백 (한 줄에 하나)")
    .fill("합성 증인의 설명 확인\n정확한 월과 일 확인");
  await page.getByRole("button", { name: "수정 내용 저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "수정 내용 저장", exact: true })).toBeHidden();
  await page.reload();
  await expect(page.getByLabel("사실 내용", { exact: true }).first()).toHaveValue(
    "원본 확인 후 수정한 반환 연도",
  );
  await expect(page.getByLabel("확인 상태", { exact: true }).first()).toHaveValue("conflicting");
  await expect(page.getByLabel("모순되는 사실 선택")).toHaveValues(["fact-1"]);
  await expect(page.getByLabel("확인할 정보 공백 (한 줄에 하나)")).toHaveValue(
    "합성 증인의 설명 확인\n정확한 월과 일 확인",
  );
  await page.getByLabel("요약이 내가 이야기한 사실과 맞는지 확인했어요.").check();
  await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
  await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
  await expect(page).toHaveURL(base);
  await page.goto(`${base}/summary`);
  await expect(page.getByLabel("사실 내용", { exact: true }).first()).toBeEditable();
  await page.getByLabel("요약이 내가 이야기한 사실과 맞는지 확인했어요.").check();
  await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
  await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
  await expect(page).toHaveURL(base);
});

test("answer evidence opens source correction, exclusion and exact coverage persist", async ({
  page,
}) => {
  await seed(page);
  await page.goto(base);
  await expect(page.getByRole("list", { name: "응답 검증 경고" })).toContainText("검증에 실패");
  await expect(page.getByRole("link", { name: "합성 공식 안내" })).toHaveAttribute(
    "href",
    "https://www.law.go.kr/법령/민법",
  );
  await page.getByRole("link", { name: "합성 원본.txt · 1쪽", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByText("페이지·시간별 처리 범위 (1개)", { exact: true }).click();
  await expect(page.getByText("1쪽 · 처리됨", { exact: true })).toBeVisible();
  await page.getByLabel("확인·교정한 내용").fill("사용자가 원본을 보고 교정한 합성 문장");
  await page.getByLabel("사건 정리와 새 리포트에 포함").uncheck();
  await page.getByRole("button", { name: "교정 내용 저장", exact: true }).click();
  await expect(page.getByText("교정 내용을 저장했어요. 새로 접속해도 유지됩니다.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("확인·교정한 내용")).toHaveValue(
    "사용자가 원본을 보고 교정한 합성 문장",
  );
  await expect(page.getByLabel("사건 정리와 새 리포트에 포함")).not.toBeChecked();
  await page.getByText("원본 추출 내용", { exact: true }).click();
  await expect(page.getByText("원본 추출 내용의 합성 문장", { exact: true })).toBeVisible();
});

test("year, month, day and unknown precision survive actual editor reconnect", async ({ page }) => {
  await seed(page);
  for (const [precision, date, label] of [
    ["year", "2024", "2024년 · 월·일 미상"],
    ["month", "2025-07", "2025년 07월 · 일 미상"],
    ["day", "2026-10-09", "2026-10-09"],
    ["unknown", "", "날짜 미상"],
  ]) {
    await page.goto(`${base}/timeline`);
    await page.getByRole("button", { name: "일정 추가" }).click();
    await page.getByLabel("날짜 정밀도").selectOption(precision ?? "unknown");
    if (date) await page.getByLabel("날짜 (모르면 비워 두세요)").fill(date);
    await page.getByLabel("어떤 일이 있었나요?").fill(`정밀도 ${precision}`);
    await page.getByRole("button", { name: "타임라인 저장" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.reload();
    await expect(page.getByText(label ?? "", { exact: true })).toBeVisible();
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: `정밀도 ${precision}`, exact: true }) });
    await row.getByRole("button", { name: "편집", exact: true }).click();
    await page.getByLabel("어떤 일이 있었나요?").fill(`제목만 수정 ${precision}`);
    await page.getByRole("button", { name: "타임라인 저장" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.reload();
    await expect(page.getByText(label ?? "", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: `제목만 수정 ${precision}`, exact: true }),
    ).toBeVisible();
  }
});

test("reconsent keeps existing case and source visible, restricts writes and returns to the case", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate((prefix) => {
    const session = JSON.parse(localStorage.getItem(`${prefix}session`) ?? "{}");
    session.needsConsent = true;
    localStorage.setItem(`${prefix}session`, JSON.stringify(session));
  }, storage);
  await page.goto(base);
  await expect(page.getByText("출처와 원본을 함께 확인해 주세요.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("추가 사실 또는 질문")).toBeDisabled();
  await page.goto(`${base}/files?file=file-one`);
  await expect(page.getByLabel("확인·교정한 내용")).toHaveValue("원본 추출 내용의 합성 문장");
  await expect(page.getByLabel("확인·교정한 내용")).toBeDisabled();
  await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).last().click();
  await page.getByRole("link", { name: "동의 확인하고 계속하기" }).first().click();
  await expect(page).toHaveURL(/\/consent\?returnTo=%2Fcases%2Fcompletion-case%2Ffiles/);
  await page.getByLabel("이용약관, 개인정보 처리방침, AI 이용 고지를 확인하고 동의합니다.").check();
  await page.getByLabel("만 14세 이상입니다.").check();
  await page.getByRole("button", { name: "동의하고 계속하기" }).click();
  await page.getByRole("link", { name: "내 화면으로 계속하기" }).click();
  await expect(page).toHaveURL(`${base}/files`);
  await expect(page.getByLabel("선택 자료의 자동 처리에 동의합니다.")).toBeEnabled();
});

test("login preserves a permitted path and rejects an external return destination", async ({
  page,
}) => {
  await page.goto(`/login?returnTo=${encodeURIComponent(`${base}/timeline`)}`);
  await page.getByRole("button", { name: "Google로 계속하기" }).click();
  await expect(page).toHaveURL(/\/consent\?returnTo=%2Fcases%2Fcompletion-case%2Ftimeline/);
  await page.getByLabel("이용약관, 개인정보 처리방침, AI 이용 고지를 확인하고 동의합니다.").check();
  await page.getByLabel("만 14세 이상입니다.").check();
  await page.getByRole("button", { name: "동의하고 계속하기" }).click();
  await expect(page.getByRole("link", { name: "내 화면으로 계속하기" })).toHaveAttribute(
    "href",
    `${base}/timeline`,
  );
  await page.goto("/login?returnTo=https%3A%2F%2Fexample.com%2Fevil");
  await page.getByRole("button", { name: "Google로 계속하기" }).click();
  await expect(page).toHaveURL(/\/app$/);
});
