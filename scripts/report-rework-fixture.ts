import { mkdir } from "node:fs/promises";
import { createReportHtml } from "../src/components/reports/document";
import { reportReworkLayoutFixture } from "../tests/helpers/report-rework-layout-fixture";

const root = ".wrangler/report-rework";
await mkdir(root, { recursive: true, mode: 0o777 });
const font = `data:font/ttf;base64,${Buffer.from(await Bun.file("public/fonts/BaroReport-Regular.ttf").arrayBuffer()).toString("base64")}`;
const photo = `data:image/jpeg;base64,${Buffer.from(await Bun.file("tests/fixtures/media/image-markers.jpg").arrayBuffer()).toString("base64")}`;
for (const side of ["claim", "response"] as const) {
  const { report } = reportReworkLayoutFixture(side, true);
  const photos = [
    { id: "synthetic-rework-photo", name: "합성 송금 확인서.jpg", revision: 2, dataUrl: photo },
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
