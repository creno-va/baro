import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { ResearchView } from "../../product-ui/research/ResearchView";
import {
  type ResearchProps,
  useResearchController,
} from "../../product-ui/research/useResearchController";
import { PrecedentComparisonPanel } from "./PrecedentComparisonPanel";
export function PrecedentResearch(props: ResearchProps) {
  return (
    <GlobalProductTheme className="contents">
      <ResearchView
        controller={useResearchController(props)}
        ComparisonPanel={PrecedentComparisonPanel}
      />
    </GlobalProductTheme>
  );
}
