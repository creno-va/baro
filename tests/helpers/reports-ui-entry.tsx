import { createRoot } from "react-dom/client";
import { AccountSettings } from "../../src/components/AccountSettings";
import { ReportReview } from "../../src/components/reports/ReportReview";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    location.pathname === "/settings" ? <AccountSettings /> : <ReportReview caseId="case-demo" />,
  );
