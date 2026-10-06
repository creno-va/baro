import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

const modulePath = "/src/client/api/index.ts";
async function login(page: Page, role: "고객" | "변호사" = "고객") {
  await page.goto("/login");
  await page.getByRole("radio", { name: new RegExp(role) }).check();
  await page.getByRole("button", { name: "Google로 계속하기", exact: true }).click();
  await expect(page).toHaveURL(/\/consent$/);
  await page.getByRole("checkbox", { name: /이용약관, 개인정보/ }).check();
  await page.getByRole("checkbox", { name: "만 14세 이상입니다." }).check();
  await page.getByRole("button", { name: "동의하고 계속하기" }).click();
  await page.getByRole("link", { name: "내 화면으로 계속하기" }).click();
}
async function createActiveCase(page: Page, confirm = true) {
  await page.goto("/cases/new");
  await page
    .getByLabel("지금까지 있었던 일")
    .fill("독립 검토용 합성 사건입니다. 빌려준 돈과 약속 날짜를 확인합니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await page.getByRole("button", { name: "모름", exact: true }).click();
  await page.reload();
  await expect(page.getByText("질문 2 / 최대 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "건너뛰기", exact: true }).click();
  await expect(page).toHaveURL(/\/summary$/);
  if (!confirm) return new URL(page.url()).pathname.replace(/\/summary$/, "");
  await page.getByRole("checkbox", { name: /요약이 내가 이야기한 사실과 맞는지/ }).check();
  await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
  await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
  await expect(page.getByRole("heading", { name: "이어서 대화하기" })).toBeVisible();
  return new URL(page.url()).pathname;
}
async function changeToLawyer(page: Page) {
  await page.goto("/login");
  await page.getByRole("radio", { name: /변호사/ }).check();
  await page.getByRole("button", { name: "Google로 계속하기", exact: true }).click();
  await page.getByRole("checkbox", { name: /이용약관, 개인정보/ }).check();
  await page.getByRole("checkbox", { name: "만 14세 이상입니다." }).check();
  await page.getByRole("button", { name: "동의하고 계속하기" }).click();
  await page.getByRole("link", { name: "내 화면으로 계속하기" }).click();
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => {
    if (new URL(route.request().url()).pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
});

test("customer complete shared flow, reload, chat and upload retry, report files, downloads, deletion", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const actualApis: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) actualApis.push(r.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const path = await createActiveCase(page);
  const id = path.split("/").pop() as string;
  await page.evaluate(() =>
    localStorage.setItem(
      "baro-api-mock-v1:faults",
      JSON.stringify({
        "workspace.sendMessage": ["chat_failed"],
        "files.uploadPart": ["UNAVAILABLE"],
      }),
    ),
  );
  await page.getByLabel("추가 사실 또는 질문").fill("독립 검토용 합성 대화입니다.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByRole("button", { name: "응답 다시 시도" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "응답 다시 시도" }).click();
  await expect(page.getByText("이 응답은 합성 API 예시", { exact: false })).toBeVisible();
  await page.goto(`${path}/files`);
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles({
    name: "independent-synthetic.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("독립 검토용 합성 원본 010-1234-5678"),
  });
  await page.getByRole("button", { name: "업로드 다시 시도" }).click();
  await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
  await page.reload();
  await page.goto(`${path}/reports`);
  await expect(page.getByText("independent-synthetic.txt", { exact: true })).toBeVisible();
  await page.getByLabel("리포트 내용 편집").fill("독립 검토 보고서 · 합성 연락처 010-1234-5678");
  await page.getByLabel("전화번호·이메일·주민등록번호 가리기").check();
  await page.getByRole("button", { name: "검토 내용 저장" }).click();
  await expect(page.getByText("검토 내용을 저장했어요.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("리포트 내용 편집")).toHaveValue(/독립 검토 보고서/);
  await expect(page.getByLabel("전화번호·이메일·주민등록번호 가리기")).toBeChecked();
  await page.getByLabel("ZIP에 원본 포함").check();
  await page.getByLabel("내용·식별정보·선택한 원본을 확인했어요").check();
  const pdfEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  const pdfPath = testInfo.outputPath("report.pdf");
  await (await pdfEvent).saveAs(pdfPath);
  expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe("%PDF-");
  const zipEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "선택 원본 ZIP (1)" }).click();
  await (await zipEvent).saveAs(testInfo.outputPath("originals.zip"));
  await page.screenshot({ path: testInfo.outputPath("report-390.png"), fullPage: true });
  const shared = await page.evaluate((id) => {
    const get = (n: string) => JSON.parse(localStorage.getItem(`baro-api-mock-v1:${n}`) ?? "{}");
    return {
      case: get("cases")[id],
      workspace: get("workspace")[id],
      report: get("reports")[id],
      owner: get("caseOwners")[id],
      session: get("session").user.id,
    };
  }, id);
  expect(shared.owner).toBe(shared.session);
  const workspaceView = await page.evaluate(
    async ({ modulePath, id }) => {
      const { api } = await import(modulePath);
      return api.workspace.get(id);
    },
    { modulePath, id },
  );
  expect(workspaceView.case.id).toBe(id);
  expect(workspaceView.case.revision).toBe(shared.case.revision);
  expect(shared.report.caseId).toBe(id);
  await page.goto("/settings");
  await page.getByRole("button", { name: "사건 삭제", exact: true }).click();
  await page.getByLabel("삭제 확인 — DELETE 입력").fill("DELETE");
  await page.getByRole("button", { name: "삭제 요청 확인" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "사건 삭제", exact: true })).toHaveCount(0);
  for (const suffix of ["", "/files", "/reports"]) {
    await page.goto(`${path}${suffix}`);
    await expect(page.getByRole("alert")).toBeVisible();
  }
  expect(actualApis).toEqual([]);
});

test("lawyer save reload publish search detail hide uses same profile id", async ({
  page,
}, testInfo) => {
  await login(page, "변호사");
  await page.getByLabel("이름", { exact: true }).fill("독립검토 합성변호사");
  await page.getByLabel("사무실 이름").fill("독립 합성사무실");
  await page.getByLabel("소개", { exact: true }).fill("독립 통합 검토용 합성 프로필입니다.");
  await page.getByLabel("민사", { exact: true }).check();
  await page.getByRole("combobox", { name: "지역", exact: true }).selectOption("seoul");
  await page.getByLabel("사무실 주소").fill("서울 합성로 1");
  await page.getByLabel("이메일", { exact: true }).fill("independent@example.invalid");
  await page.getByRole("button", { name: "프로필 저장" }).click();
  await expect(page.getByText("프로필을 저장했어요.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("독립검토 합성변호사");
  await page.getByRole("button", { name: "프로필 공개", exact: true }).click();
  await page.getByLabel(/내 사진과 연락처를 포함한/).check();
  await page.getByRole("button", { name: "동의하고 공개" }).click();
  await expect(page.getByText("공개 중", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "변호사 디렉터리" }).click();
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByLabel("이름 또는 사무실", { exact: true }).fill("독립검토 합성변호사");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByRole("link", { name: "프로필과 연락처 보기" })).toHaveCount(1);
  await page.getByRole("link", { name: "프로필과 연락처 보기" }).click();
  await expect(
    page.getByRole("heading", { name: "독립검토 합성변호사", exact: true }),
  ).toBeVisible();
  const publicPath = new URL(page.url()).pathname;
  await page.screenshot({ path: testInfo.outputPath("lawyer-public.png"), fullPage: true });
  await page.goto("/lawyer");
  await page.getByRole("button", { name: "비공개로 전환" }).click();
  await expect(page.getByText("비공개", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("비공개", { exact: true })).toBeVisible();
  await page.goto(publicPath);
  await expect(page.getByRole("alert")).toBeVisible();
  await page.goto("/lawyers");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByLabel("이름 또는 사무실", { exact: true }).fill("독립검토 합성변호사");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByRole("link", { name: "프로필과 연락처 보기" })).toHaveCount(0);
});

test("two report editors reject outdated revision and recover without overwriting", async ({
  page,
  context,
}) => {
  await login(page);
  const path = await createActiveCase(page);
  await page.goto(`${path}/reports`);
  await expect(page.getByLabel("리포트 내용 편집")).toBeVisible();
  const second = await context.newPage();
  await second.goto(`${path}/reports`);
  await expect(second.getByLabel("리포트 내용 편집")).toBeVisible();
  await page.getByLabel("리포트 내용 편집").fill("첫 탭의 합성 수정");
  await page.getByRole("button", { name: "검토 내용 저장" }).click();
  await expect(page.getByText("검토 내용을 저장했어요.")).toBeVisible();
  await second.getByLabel("리포트 내용 편집").fill("오래된 둘째 탭 수정");
  await second.getByRole("button", { name: "검토 내용 저장" }).click();
  await expect(second.getByRole("alert")).toContainText("다른 화면");
  await second.getByRole("button", { name: "다시 확인", exact: true }).click();
  await second.getByRole("button", { name: "편집을 버리고 다시 불러오기" }).click();
  await expect(second.getByLabel("리포트 내용 편집")).toHaveValue("첫 탭의 합성 수정");
});

test("switch account in peer tab hides former owner's report before further actions", async ({
  page,
  context,
}, testInfo) => {
  await login(page);
  const path = await createActiveCase(page);
  await page.goto(`${path}/reports`);
  const editor = page.getByLabel("리포트 내용 편집");
  await expect(editor).toBeVisible();
  const peer = await context.newPage();
  await changeToLawyer(peer);
  await page.bringToFront();
  await page.screenshot({ path: testInfo.outputPath("account-switch-report.png"), fullPage: true });
  await expect(
    editor,
    "old owner report must clear when another account becomes active",
  ).not.toBeVisible();
});

test("switch account in peer tab hides former owner's intake summary", async ({
  page,
  context,
}, testInfo) => {
  await login(page);
  const path = await createActiveCase(page, false);
  await page.goto(`${path}/summary`);
  const editor = page.getByRole("textbox");
  await expect(editor).toBeVisible();
  const peer = await context.newPage();
  await changeToLawyer(peer);
  await page.bringToFront();
  await page.screenshot({
    path: testInfo.outputPath("account-switch-summary.png"),
    fullPage: true,
  });
  await expect(editor, "previous owner summary must clear on account switch").not.toBeVisible();
});

test("owner API boundaries deny previous account's case workspace files and reports", async ({
  page,
}) => {
  await login(page);
  const path = await createActiveCase(page);
  await page.goto(`${path}/reports`);
  await expect(page.getByLabel("리포트 내용 편집")).toBeVisible();
  await changeToLawyer(page);
  const results = await page.evaluate(
    async ({ modulePath, id }) => {
      const { api } = await import(modulePath);
      const results: Record<string, string> = {};
      for (const name of ["cases", "workspace", "files", "reports"]) {
        try {
          await api[name][name === "files" ? "list" : "get"](id);
          results[name] = "ACCESS_ALLOWED";
        } catch (e) {
          results[name] = (e as { code: string }).code;
        }
      }
      return results;
    },
    { modulePath, id: path.split("/").pop() as string },
  );
  expect(results).toEqual({
    cases: "NOT_FOUND",
    workspace: "NOT_FOUND",
    files: "NOT_FOUND",
    reports: "NOT_FOUND",
  });
});

test("report stale follows shared case revision after workspace mutation", async ({ page }) => {
  await login(page);
  const path = await createActiveCase(page);
  await page.goto(`${path}/reports`);
  await expect(page.getByLabel("리포트 내용 편집")).toBeVisible();
  await page.goto(path);
  await page.getByLabel("추가 사실 또는 질문").fill("리포트 생성 후 추가한 합성 사실입니다.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByText("이 응답은 합성 API 예시", { exact: false })).toBeVisible();
  await page.goto(`${path}/reports`);
  await expect(page.getByText("사건 내용이 변경되었어요.", { exact: false })).toBeVisible();
});

test("workspace clears old owner content after account switch and focus refresh", async ({
  page,
  context,
}, testInfo) => {
  await login(page);
  await createActiveCase(page);
  await page.getByLabel("추가 사실 또는 질문").fill("이전 고객에게만 보일 합성 사실입니다.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByText("이 응답은 합성 API 예시", { exact: false })).toBeVisible();
  const peer = await context.newPage();
  await changeToLawyer(peer);
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("account-switch-workspace.png"),
    fullPage: true,
  });
  await expect(
    page.getByLabel("추가 사실 또는 질문"),
    "previous owner workspace must clear on denied focus refresh",
  ).not.toBeVisible();
  await expect(
    page.getByText("이전 고객에게만 보일 합성 사실입니다.", { exact: true }),
  ).not.toBeVisible();
});

test("report download refuses deleted file from stale tab; reload removes stale selection", async ({
  page,
  context,
}) => {
  await login(page);
  const path = await createActiveCase(page);
  await page.goto(`${path}/files`);
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles({
    name: "removed-synthetic.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("삭제 예정 합성 자료"),
  });
  await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
  await page.goto(`${path}/reports`);
  await page.getByLabel("ZIP에 원본 포함").check();
  await page.getByLabel("내용·식별정보·선택한 원본을 확인했어요").check();
  const peer = await context.newPage();
  await peer.goto(`${path}/files`);
  await expect(peer.getByRole("heading", { name: "removed-synthetic.txt" })).toBeVisible();
  await peer.evaluate(
    async ({ modulePath, id }) => {
      const { api } = await import(modulePath);
      const [file] = await api.files.list(id);
      await api.files.remove(id, file.id);
    },
    { modulePath, id: path.split("/").pop() as string },
  );
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await page.getByRole("button", { name: "선택 원본 ZIP (1)" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(downloads).toEqual([]);
  await page.getByRole("button", { name: "다시 확인", exact: true }).click();
  await expect(page.getByText("removed-synthetic.txt", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "선택 원본 ZIP (0)" })).toBeDisabled();
});

test("account deletion clears own data and session while preserving peer lawyer profile", async ({
  page,
}) => {
  await login(page, "변호사");
  const profileId = await page.evaluate(async (modulePath) => {
    const { api } = await import(modulePath);
    return (await api.lawyers.getMine()).id;
  }, modulePath);
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page);
  const path = await createActiveCase(page);
  await page.goto(`${path}/files`);
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles({
    name: "account-deleted.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("계정 삭제 대상 합성 자료"),
  });
  await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
  const oldId = await page.evaluate(async (modulePath) => {
    const { api } = await import(modulePath);
    return (await api.session.get()).user.id;
  }, modulePath);
  await page.goto("/settings");
  await page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true }).click();
  await page.getByLabel("삭제 확인 — DELETE 입력").fill("DELETE");
  await page.getByRole("button", { name: "삭제 요청 확인" }).click();
  await expect(page.getByRole("heading", { name: "계정 삭제를 접수했어요" })).toBeVisible();
  await page.getByRole("link", { name: "로그인 화면으로", exact: true }).click();
  await page.reload();
  const state = await page.evaluate(
    ({ id, profileId }) => {
      const get = (key: string, empty: unknown) =>
        JSON.parse(localStorage.getItem(`baro-api-mock-v1:${key}`) ?? JSON.stringify(empty));
      return {
        session: get("session", {}).user,
        case: get("cases", {})[id],
        files: get("files", {})[id],
        deleted: get("deletedAccountIds", []),
        peerProfile: get("lawyers", { profiles: [] }).profiles.some(
          (p: { id: string }) => p.id === profileId,
        ),
      };
    },
    { id: path.split("/").pop() as string, profileId },
  );
  expect(state.session).toBeNull();
  expect(state.case).toBeUndefined();
  expect(state.files).toBeUndefined();
  expect(state.deleted).toContain(oldId);
  expect(state.peerProfile).toBe(true);
  await login(page);
  const newId = await page.evaluate(async (modulePath) => {
    const { api } = await import(modulePath);
    return (await api.session.get()).user.id;
  }, modulePath);
  expect(newId).not.toBe(oldId);
  await expect(page.getByRole("link", { name: "첫 사건 만들기" })).toBeVisible();
});

test("report save lost acknowledgement retries same version and preserves edits", async ({
  page,
}) => {
  await login(page);
  const path = await createActiveCase(page);
  await page.goto(`${path}/reports`);
  await expect(page.getByLabel("리포트 내용 편집")).toBeVisible();
  const content = "응답 유실 재시도를 위한 합성 수정";
  await page.evaluate((content) => {
    const original = Response.prototype.json;
    let dropped = false;
    Response.prototype.json = async function () {
      const value = (await original.call(this)) as { content?: string; revision?: number };
      if (!dropped && value?.content === content && value?.revision === 2) {
        dropped = true;
        throw new Error("Synthetic acknowledgement lost after commit");
      }
      return value;
    };
  }, content);
  await page.getByLabel("리포트 내용 편집").fill(content);
  await page.getByRole("button", { name: "검토 내용 저장" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("리포트 내용 편집")).toHaveValue(content);
  await page.getByRole("button", { name: "검토 내용 저장" }).click();
  await expect(page.getByText("검토 내용을 저장했어요.")).toBeVisible();
  const result = await page.evaluate(
    async ({ modulePath, id }) => {
      const { api } = await import(modulePath);
      return api.reports.get(id);
    },
    { modulePath, id: path.split("/").pop() as string },
  );
  expect(result.revision).toBe(2);
  expect(result.content).toBe(content);
  await page.reload();
  await expect(page.getByLabel("리포트 내용 편집")).toHaveValue(content);
});

test("lawyer editors reject stale profile revision and recover by reload", async ({
  page,
  context,
}) => {
  await login(page, "변호사");
  const second = await context.newPage();
  await second.goto("/lawyer");
  await expect(second.getByLabel("이름", { exact: true })).toBeVisible();
  await expect(second.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByLabel("이름", { exact: true }).fill("첫 탭 합성 이름");
  await page.getByRole("button", { name: "프로필 저장" }).click();
  await expect(page.getByText("프로필을 저장했어요.", { exact: true })).toBeVisible();
  await second.getByLabel("이름", { exact: true }).fill("오래된 둘째 탭 이름");
  await second.getByRole("button", { name: "프로필 저장" }).click();
  await expect(second.getByRole("alert")).toBeVisible();
  await second.reload();
  await expect(second.getByLabel("이름", { exact: true })).toHaveValue("첫 탭 합성 이름");
});
