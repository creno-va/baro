import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { CaseContextView } from "../../product-ui/materials/CaseContextView";
import type { CaseContextPanelProps } from "../../product-ui/materials/types";
import { useCaseContextController } from "../../product-ui/materials/useCaseContextController";

export function CaseContextPanel(props: CaseContextPanelProps) {
  const controller = useCaseContextController(props);
  return (
    <GlobalProductTheme className="contents">
      <CaseContextView {...props} controller={controller} />
    </GlobalProductTheme>
  );
}
