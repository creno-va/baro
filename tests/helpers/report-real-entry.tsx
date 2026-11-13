import "./headless-experience";
import { createRoot } from "react-dom/client";
import { ReportReview } from "../../src/components/reports/ReportReview";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <ReportReview
      caseId={location.pathname.split("/")[2] ?? ""}
      embedded={new URLSearchParams(location.search).get("embedded") === "true"}
      rework={new URLSearchParams(location.search).get("rework") === "true"}
      onDirtyChange={(dirty) => {
        document.documentElement.dataset.reportDirty = String(dirty);
      }}
      onBusyChange={(busy) => {
        document.documentElement.dataset.reportBusy = String(busy);
      }}
      onViewed={(identity) => {
        document.documentElement.dataset.reportViewed = JSON.stringify(identity);
      }}
    />,
  );
