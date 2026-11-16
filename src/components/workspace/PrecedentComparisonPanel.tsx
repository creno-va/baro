import { ComparisonPanelView } from "../../product-ui/research/ComparisonPanelView";
import {
  type ComparisonPanelProps,
  useComparisonPanelController,
} from "../../product-ui/research/useComparisonPanelController";
export function PrecedentComparisonPanel(props: ComparisonPanelProps) {
  return <ComparisonPanelView controller={useComparisonPanelController(props)} />;
}
