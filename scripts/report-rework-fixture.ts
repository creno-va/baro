import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { createReportHtml } from "../src/components/reports/document";
import { v2LegalAnalysisSnapshotSchema } from "../src/contracts/v2";
import { createReportsService } from "../src/server/modules/reports/service";
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
// Exercise the actual encrypted report service projection as well as layout stress.
Bun.env.BARO_SYNTHETIC_REPORT_SERVER = "true";
const { reportPreparedAnalysisFixture } = await import(
  "../tests/helpers/report-prepared-analysis-fixture"
);
for (const purpose of ["prepare_claim", "respond_to_claim"] as const) {
  const fixture = await reportPreparedAnalysisFixture(purpose);
  try {
    const snapshot = v2LegalAnalysisSnapshotSchema().parse(fixture.snapshot);
    const reports = createReportsService(fixture.core, {
      ...fixture.deps,
      readPreparedAnalysis: async () => snapshot,
    });
    const report = await reports.get(fixture.actor.ownerId, fixture.workspaceId);
    await Bun.write(`${root}/prepared-${purpose}.html`, createReportHtml(report, font));
  } finally {
    fixture.db.close();
  }
}
console.info("Synthetic rework HTML prepared for the actual offline PDF engine.");
