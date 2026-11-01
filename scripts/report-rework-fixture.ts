import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { createReportHtml } from "../src/components/reports/document";
import { reportReworkLayoutFixture } from "../tests/helpers/report-rework-layout-fixture";

const root = ".wrangler/report-rework";
await mkdir(root, { recursive: true, mode: 0o777 });
const font = `data:font/ttf;base64,${Buffer.from(await Bun.file("public/fonts/BaroReport-Regular.ttf").arrayBuffer()).toString("base64")}`;
const photo = `data:image/jpeg;base64,${Buffer.from(await Bun.file("tests/fixtures/media/image-markers.jpg").arrayBuffer()).toString("base64")}`;
const portrait = `data:image/jpeg;base64,${(await sharp("tests/fixtures/media/image-markers.jpg").resize(700, 1000, { fit: "contain", background: "white" }).jpeg().toBuffer()).toString("base64")}`;
for (const side of ["claim", "response"] as const) {
  const { report } = reportReworkLayoutFixture(side, true);
  const photos = [
    { id: "synthetic-rework-photo", name: "합성 송금 확인서.jpg", revision: 2, dataUrl: photo },
    {
      id: "synthetic-rework-portrait",
      name: "세로 비율 합성 문서.jpg",
      revision: 1,
      dataUrl: portrait,
    },
  ];
  for (const masked of [false, true]) {
    const name = `${side}${masked ? "-masked" : ""}`;
    await Bun.write(
      `${root}/${name}.html`,
      createReportHtml({ ...report, photos, maskIdentifiers: masked }, font),
    );
  }
}
console.info("Synthetic rework HTML prepared for the actual offline PDF engine.");
