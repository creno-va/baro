import { chmod, mkdir } from "node:fs/promises";
import { createReportHtml } from "../src/components/reports/document";

const root = ".wrangler/report-native";
await mkdir(root, { recursive: true });
// Synthetic QA output only: the non-root Container UID differs from CI owner.
await chmod(root, 0o777);
const jpeg = new Uint8Array(await Bun.file("tests/fixtures/media/image-markers.jpg").arrayBuffer());
const font = new Uint8Array(await Bun.file("public/fonts/BaroReport-Regular.ttf").arrayBuffer());
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const report = {
  title: "사건 상담 준비 리포트 · 합성 검증",
  content:
    "사건 개요\n합성 사건입니다. 사용자 진술과 자료 관찰을 구분합니다.\n\n주요 사실\n- [보이는 상태] 합성 표식이 보입니다. 상처의 원인이나 진단은 추정하지 않습니다. (증거 1 · 이미지 관찰)\n- [문서 기재] 발급일 2026-10-20. 읽을 수 있는 기재 내용만 확인했습니다. (증거 2 · 이미지 관찰)\n\n주요 경위\n- 2026-10-20 · 문서에 기재된 날짜 · 사용자 확인 필요\n\n증거 자료\n### 증거 1 · 상해 관찰 합성 표식.jpg\n![사진설명표식 · 사진의 촬영 날짜는 확인되지 않았습니다.](baro-photo:synthetic-photo)\n\n### 증거 2 · 진단서 합성 표식.jpg\n![문서설명표식 · 직접 수정한 내용으로 원문 대조 필요](baro-photo:synthetic-document)\n\n" +
    Array.from(
      { length: 25 },
      (_, n) =>
        `- 자료 확인 ${n + 1} · 합성 기록 ${n + 1}: 원본과 기재 내용을 대조하고 불분명한 부분은 사용자에게 확인합니다.`,
    ).join("\n\n") +
    "\n\n추가 확인 사항\n- 촬영 날짜와 사건과의 관계를 알려 주세요.",
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
      notes: ["확인 필요: 사진설명표식 · 사진의 촬영 날짜는 확인되지 않았습니다."],
      dataUrl: `data:image/jpeg;base64,${base64(jpeg)}`,
    },
    {
      id: "synthetic-document",
      name: "진단서 합성 표식.jpg",
      revision: 4,
      notes: ["직접 수정한 내용 (원문 대조 필요): 문서설명표식 · 사용자가 고친 설명입니다."],
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
