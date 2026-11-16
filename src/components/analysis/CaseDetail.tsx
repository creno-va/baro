import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { CaseDetailView } from "../../product-ui/legacy-case/CaseDetailView";
import { QuestionsView } from "../../product-ui/legacy-case/QuestionsView";
import { LegacyResultView } from "../../product-ui/legacy-case/ResultView";
import { useCaseDetailController } from "../../product-ui/legacy-case/useCaseDetailController";
import {
  type LegacyQuestionsProps,
  useLegacyQuestionsController,
} from "../../product-ui/legacy-case/useLegacyQuestionsController";
import {
  type LegacyResultProps,
  useLegacyResultController,
} from "../../product-ui/legacy-case/useLegacyResultController";
import { Feedback } from "./Feedback";

function Questions(props: LegacyQuestionsProps) {
  return <QuestionsView controller={useLegacyQuestionsController(props)} />;
}
function ResultView(props: LegacyResultProps) {
  return <LegacyResultView result={props.result} controller={useLegacyResultController(props)} />;
}

export function CaseDetail({ caseId }: { caseId: string }) {
  const controller = useCaseDetailController({ caseId });
  const { detail, busy, mutate } = controller;
  return (
    <GlobalProductTheme>
      <CaseDetailView
        controller={controller}
        questions={
          detail?.status === "needs_clarification" ? (
            <Questions
              key={detail.analysisId}
              questions={detail.questions}
              revision={detail.inputRevision}
              busy={busy}
              onSubmit={(body) => mutate("answers", body)}
            />
          ) : null
        }
        result={
          detail?.result ? (
            <ResultView
              key={detail.analysisId}
              result={detail.result}
              caseId={caseId}
              analysisId={detail.analysisId}
            />
          ) : null
        }
        feedback={
          detail?.result?.kind === "guidance" ? (
            <Feedback caseId={caseId} analysisId={detail.analysisId} />
          ) : null
        }
      />
    </GlobalProductTheme>
  );
}
