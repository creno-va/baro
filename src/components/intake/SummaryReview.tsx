import { SummaryReconfirmation } from "./SummaryReconfirmation";

export function SummaryReview({ caseId }: { caseId: string }) {
  return <SummaryReconfirmation caseId={caseId} />;
}
