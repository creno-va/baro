import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { QuestionsView } from "../../product-ui/intake/QuestionsView";
import { useQuestionsController } from "../../product-ui/intake/useQuestionsController";

export function IntakeQuestions({ caseId }: { caseId: string }) {
  const controller = useQuestionsController(caseId);
  return (
    <GlobalProductTheme>
      <QuestionsView controller={controller} />
    </GlobalProductTheme>
  );
}
