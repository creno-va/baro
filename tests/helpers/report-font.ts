import { maskReportText } from "../../src/components/reports/download";

/** Fixed synthetic two-page content; no clock, account or real case inputs. */
export const reportFontInput = {
  title: "합성 한글 상담 준비 리포트",
  content: maskReportText(
    [
      "연락처 010-1234-5678 · synthetic@example.com",
      ...Array.from(
        { length: 44 },
        (_, i) => `${i + 1}. 합성 자료와 진술을 검토합니다. Korean PDF ${i + 1} · 사실 확인`,
      ),
    ].join("\n"),
  ),
  revision: 2,
  updatedAt: "2026-10-15T00:00:00.000Z",
  basis: {
    workspaceRevision: 7,
    summaryRevision: 2,
    generatedAt: "2026-10-15T00:00:00.000Z",
  },
  excludedFileCount: 1,
  maskIdentifiers: true,
};
