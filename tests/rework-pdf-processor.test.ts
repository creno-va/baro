import { expect, test } from "bun:test";
import { createReportHtml } from "../src/components/reports/document";
import { ReworkPdfProcessorError, renderReworkPdf } from "./helpers/rework-pdf-processor";

const native = Bun.env.BARO_REWORK_NATIVE_PDF_TEST === "true" ? test : test.skip;
async function html() {
  const font = `data:font/ttf;base64,${Buffer.from(await Bun.file("public/fonts/BaroReport-Regular.ttf").arrayBuffer()).toString("base64")}`;
  return createReportHtml(
    {
      title: "합성 실제 native PDF 검증",
      content:
        "사건 개요\n합성 사건이며 실제 사건 자료가 아닙니다.\n\n법적 쟁점과 법 조항\n증거 1 · 1쪽과 확인하지 못한 요건을 연결합니다.\n\n출처와 분석 기준\n> [원문] 합성 원문 **별표**와 `기호`를 그대로 보존합니다.",
      revision: 1,
      updatedAt: "2026-11-01T00:00:00.000Z",
      stale: false,
      maskIdentifiers: false,
      excludedFileIds: [],
    },
    font,
  );
}
async function noOwnedContainers() {
  const child = Bun.spawn(
    ["docker", "ps", "--all", "--quiet", "--filter", `label=baro-rework-pdf-owner=${process.pid}`],
    { stdout: "pipe", stderr: "ignore", timeout: 10000 },
  );
  const [status, text] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  expect(status).toBe(0);
  expect(text.trim()).toBe("");
}

test("oversized HTML is rejected before starting a native container", async () => {
  await expect(renderReworkPdf("x".repeat(20_000_001))).rejects.toMatchObject({
    code: "REWORK_PDF_INPUT_LIMIT",
  });
});

native(
  "product HTML renders through actual report.py and extracted PDF preserves Korean and exact quotes",
  async () => {
    const pdf = await renderReworkPdf(await html());
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
    expect(pdf.byteLength).toBeLessThanOrEqual(24_000_000);
    const child = Bun.spawn(
      [
        "docker",
        "run",
        "--rm",
        "--pull=never",
        "--network",
        "none",
        "--user",
        "node",
        "--memory",
        "6g",
        "--cpus",
        "1",
        "--pids-limit",
        "128",
        "--cap-drop",
        "ALL",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=256m",
        "--interactive",
        "baro-report-rendering:latest",
        "pdftotext",
        "-layout",
        "-",
        "-",
      ],
      {
        stdin: new Blob([pdf]),
        stdout: "pipe",
        stderr: "ignore",
        timeout: 30000,
        maxBuffer: 1_000_000,
        killSignal: "SIGKILL",
      },
    );
    const [status, text] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    expect(status).toBe(0);
    const compact = text.replace(/\s+/gu, "");
    for (const phrase of [
      "합성 실제 native PDF 검증",
      "증거 1 · 1쪽",
      "합성 원문 **별표**와 `기호`를 그대로 보존합니다.",
    ])
      expect(compact).toContain(phrase.replace(/\s+/gu, ""));
    await noOwnedContainers();
  },
  60000,
);

native(
  "the actual renderer rejects unsafe HTML with finite diagnostics and removes its container",
  async () => {
    let failure: unknown;
    try {
      await renderReworkPdf(
        (await html()).replace("</body>", "<script>PRIVATE_SYNTHETIC_MARKER</script></body>"),
      );
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(ReworkPdfProcessorError);
    expect((failure as Error).message).toBe("REWORK_PDF_RENDER_FAILED");
    expect((failure as Error).message).not.toContain("PRIVATE_SYNTHETIC_MARKER");
    await noOwnedContainers();
  },
  60000,
);

native(
  "a shortened native deadline kills and removes the actual container",
  async () => {
    await expect(renderReworkPdf(await html(), { timeoutMs: 1 })).rejects.toMatchObject({
      code: "REWORK_PDF_TIMEOUT",
    });
    await noOwnedContainers();
  },
  60000,
);
