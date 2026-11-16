import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { MaterialsPanelView } from "../../product-ui/materials/MaterialsPanelView";
import type { MaterialsPanelProps } from "../../product-ui/materials/types";

/** Existing callers retain every workflow prop and callback. */
export function MaterialsPanel(props: MaterialsPanelProps) {
  return (
    <GlobalProductTheme className="contents">
      <MaterialsPanelView {...props} />
    </GlobalProductTheme>
  );
}
