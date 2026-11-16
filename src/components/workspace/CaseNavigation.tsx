import { CaseHeader, type CaseHeaderProps } from "../../product-ui/conversation/CaseHeader";
import { GlobalProductTheme } from "../../product-ui/GlobalTheme";

export function CaseNavigation(props: CaseHeaderProps) {
  return (
    <GlobalProductTheme className="contents">
      <CaseHeader {...props} />
    </GlobalProductTheme>
  );
}
