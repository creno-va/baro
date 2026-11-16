import "./headless-experience";
import { createRoot } from "react-dom/client";
import { officialSourceReport } from "./report-official-source-fixture";
import { ReportReading } from "./retired-web/components/reports/ReportReading";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <div className="report-workspace">
      <h1>{officialSourceReport.title}</h1>
      <ReportReading content={officialSourceReport.content} />
    </div>,
  );
