import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
try {
  await page.goto("http://127.0.0.1:4353/login");
  await page.getByRole("button", { name: "Google로 계속하기" }).click();
  await page.getByLabel("이용약관, 개인정보 처리방침, AI 이용 고지를 확인하고 동의합니다.").check();
  await page.getByLabel("만 14세 이상입니다.").check();
  await page.getByRole("button", { name: "동의하고 계속하기" }).click();
  await page.goto("http://127.0.0.1:4353/cases/new");
  await page
    .getByLabel("지금까지 있었던 일")
    .fill("성능 후보가 저장과 소유권 확인을 보존하는지 검사하는 합성 사건입니다.");
  await page.getByRole("button", { name: "저장하고 질문 시작" }).click();
  for (let i = 1; i <= 4; i++)
    await page.getByRole("button", { name: "모름", exact: true }).click();
  await page.getByLabel("저장한 요약을 읽고, 내가 제공한 사실과 맞는지 확인했어요.").check();
  await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
  await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
  await page.getByLabel("추가 사실 또는 질문").fill("합성 저장 보존 확인 메시지");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await page.getByText("메시지를 저장했어요.", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("합성 저장 보존 확인 메시지", { exact: true }).waitFor();
  const formatting = await page.evaluate(() => {
    const format = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" });
    const dates = [
      ...Array.from({ length: 144 }, (_, i) => new Date(Date.UTC(2026, 9, 6, 0, i * 10))),
      new Date("invalid"),
    ];
    return dates.every(
      (date) =>
        date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) ===
        (Number.isNaN(date.getTime())
          ? date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
          : format.format(date)),
    );
  });
  if (!formatting) throw new Error("Candidate changes displayed time");
  await page.evaluate(() => {
    const key = "baro-api-mock-v1:session";
    const s = JSON.parse(localStorage.getItem(key));
    s.user.id = "synthetic-peer";
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.reload();
  await page.getByRole("alert").waitFor();
  if (await page.getByLabel("추가 사실 또는 질문").count())
    throw new Error("Peer owner editor must be absent");
  await mkdir("test-results/final-candidate-check", { recursive: true });
  await writeFile(
    "test-results/final-candidate-check/raw.json",
    JSON.stringify(
      {
        formatEquivalent: true,
        savedMessageSurvivedReload: true,
        peerOwnerRejectedAfterReload: true,
      },
      null,
      2,
    ),
  );
  console.log("candidate: time display, actual save/reload and peer owner guard passed");
} finally {
  await browser.close();
}
