import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { FeedbackView } from "../../product-ui/legacy-case/FeedbackView";
import { useFeedbackController } from "../../product-ui/legacy-case/useFeedbackController";

export function Feedback({ caseId, analysisId }: { caseId: string; analysisId: string }) {
  const controller = useFeedbackController({ caseId, analysisId });
  return (
    <GlobalProductTheme>
      <FeedbackView controller={controller} />
    </GlobalProductTheme>
  );
}
