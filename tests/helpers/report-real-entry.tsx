import { createRoot } from "react-dom/client";
import { ReportReview } from "../../src/components/reports/ReportReview";

const root = document.getElementById("root");
if (root) createRoot(root).render(<ReportReview caseId={location.pathname.split("/")[2] ?? ""} />);
