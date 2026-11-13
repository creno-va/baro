import "./headless-experience";
import { createRoot } from "react-dom/client";
import { createReportMarkup } from "../../src/components/reports/document";
import { ReportReading } from "../../src/components/reports/ReportReading";
import { reportReworkLayoutFixture } from "./report-rework-layout-fixture";

const query = new URLSearchParams(location.search);
const fixture = reportReworkLayoutFixture(
  query.get("side") === "response" ? "response" : "claim",
  true,
);
const photo = (await (await fetch("/fixture-photo-data")).json()) as {
  landscape: string;
  portrait: string;
};
const markup = createReportMarkup({
  ...fixture.report,
  photos: [
    {
      id: "synthetic-rework-photo",
      name: "합성 송금 확인서.jpg",
      revision: 2,
      dataUrl: photo.landscape,
    },
    {
      id: "synthetic-rework-portrait",
      name: "세로 비율 합성 문서.jpg",
      revision: 1,
      dataUrl: photo.portrait,
    },
  ],
});
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    query.get("format") === "html" ? (
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Product renderer escapes all fixture text and owned photos.
      <div dangerouslySetInnerHTML={{ __html: markup }} />
    ) : (
      <div className="report-review report-workspace">
        <div className="report-canvas">
          <h1>{fixture.report.title}</h1>
          <ReportReading
            content={fixture.report.content}
            reportId="synthetic-rework-report"
            photoCandidates={[
              { id: "synthetic-rework-photo", name: "합성 송금 확인서.jpg" },
              { id: "synthetic-rework-portrait", name: "세로 비율 합성 문서.jpg" },
            ]}
            savedPhotoIds={["synthetic-rework-photo", "synthetic-rework-portrait"]}
          />
        </div>
      </div>
    ),
  );
