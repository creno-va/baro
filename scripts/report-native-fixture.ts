import { mkdir } from "node:fs/promises";
import { createReportHtml } from "../src/components/reports/document";

const root = ".wrangler/report-native";
await mkdir(root, { recursive: true });
const jpeg = new Uint8Array(await Bun.file("tests/fixtures/media/image-markers.jpg").arrayBuffer());
const font = new Uint8Array(await Bun.file("public/fonts/BaroReport-Regular.ttf").arrayBuffer());
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const report = {
  title: "사건 상담 준비 리포트 · 합성 검증",
  content:
    "사건 요약\n합성 사건입니다. 사용자 진술과 자료 관찰을 구분합니다.\n\n사실·주장·출처\n[보이는 상태] 합성 표식이 보입니다. 상처의 원인이나 진단은 추정하지 않습니다.\n[문서 기재] 발급일 2026-10-20. 읽을 수 있는 기재 내용만 확인했습니다.\n\n미확인 사항\n촬영 날짜와 사건과의 관계를 알려 주세요.\n\n타임라인\n2026-10-20 · 문서에 기재된 날짜 · 사용자 확인 필요\n\n준비할 행동\n원본 전체와 날짜가 보이는 확대 사진을 보관하세요.\n\n" +
    Array.from(
      { length: 25 },
      (_, n) =>
        `자료 확인 ${n + 1}\n합성 기록 ${n + 1}: 원본과 기재 내용을 대조하고 불분명한 부분은 사용자에게 확인합니다.`,
    ).join("\n\n"),
  revision: 2,
  updatedAt: "2026-10-21T12:00:00Z",
  stale: false,
  maskIdentifiers: false,
  excludedFileIds: [],
  basis: { workspaceRevision: 5, summaryRevision: 1, generatedAt: "2026-10-21T12:00:00Z" },
  photos: [
    {
      id: "synthetic-photo",
      name: "상해 관찰 합성 표식.jpg",
      revision: 3,
      dataUrl: `data:image/jpeg;base64,${base64(jpeg)}`,
    },
    {
      id: "synthetic-document",
      name: "진단서 합성 표식.jpg",
      revision: 4,
      dataUrl: `data:image/jpeg;base64,${base64(jpeg)}`,
    },
  ],
};
await Bun.write(
  `${root}/report.html`,
  createReportHtml(report, `data:font/ttf;base64,${base64(font)}`),
);
await Bun.write(
  `${root}/masked.html`,
  createReportHtml({ ...report, maskIdentifiers: true }, `data:font/ttf;base64,${base64(font)}`),
);
console.info("Synthetic HTML report fixtures prepared; no real case or provider call.");
