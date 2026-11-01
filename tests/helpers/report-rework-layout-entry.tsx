import { createRoot } from "react-dom/client";
import { createReportMarkup } from "../../src/components/reports/document";
import { ReportReading } from "../../src/components/reports/ReportReading";
import { reportReworkLayoutFixture } from "./report-rework-layout-fixture";

const query = new URLSearchParams(location.search);
const fixture = reportReworkLayoutFixture(
  query.get("side") === "response" ? "response" : "claim",
  true,
);
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    query.get("format") === "html" ? (
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Product renderer escapes all fixture text and owned photos.
      <div dangerouslySetInnerHTML={{ __html: createReportMarkup(fixture.report) }} />
    ) : (
      <div className="report-review report-workspace">
        <div className="report-canvas">
          <h1>{fixture.report.title}</h1>
          <ReportReading
            content={fixture.report.content}
            reportId="synthetic-rework-report"
            photoCandidates={[{ id: "synthetic-rework-photo", name: "합성 송금 확인서.jpg" }]}
            savedPhotoIds={["synthetic-rework-photo"]}
          />
        </div>
      </div>
    ),
  );
