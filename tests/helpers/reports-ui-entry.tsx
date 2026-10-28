import { createRoot } from "react-dom/client";
import { AccountSettings } from "../../src/components/AccountSettings";
import { CaseDeleteDialog } from "../../src/components/intake/CaseDeleteDialog";
import { ReportReview } from "../../src/components/reports/ReportReview";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    location.pathname === "/settings" ? (
      <AccountSettings />
    ) : location.pathname === "/cases/case-demo/delete" ? (
      <CaseDeleteDialog
        item={{
          id: "case-demo",
          title: "합성 대여금 사건",
          subjectContext: "individual",
          stage: "active",
          revision: 1,
          schemaVersion: "2",
          updatedAt: "2026-10-06T00:00:00Z",
        }}
        onClose={() => location.assign("/settings")}
        onDeleted={() => location.assign("/settings")}
      />
    ) : (
      <ReportReview caseId="case-demo" />
    ),
  );
