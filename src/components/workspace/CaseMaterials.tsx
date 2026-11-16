import type { ComponentProps } from "react";
import { CaseMaterialsView } from "../../product-ui/evidence/CaseMaterialsView";
import { GlobalProductTheme } from "../../product-ui/GlobalTheme";

export function CaseMaterials(props: ComponentProps<typeof CaseMaterialsView>) {
  if (!props.files.length) return null;
  return (
    <GlobalProductTheme className="contents">
      <CaseMaterialsView {...props} />
    </GlobalProductTheme>
  );
}
