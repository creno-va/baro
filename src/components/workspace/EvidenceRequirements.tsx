import type { ComponentProps } from "react";
import { EvidenceRequirementsView } from "../../product-ui/evidence/EvidenceRequirementsView";
import { GlobalProductTheme } from "../../product-ui/GlobalTheme";

export function EvidenceRequirements(props: ComponentProps<typeof EvidenceRequirementsView>) {
  if (!props.requirements.length) return null;
  return (
    <GlobalProductTheme className="contents">
      <EvidenceRequirementsView {...props} />
    </GlobalProductTheme>
  );
}
