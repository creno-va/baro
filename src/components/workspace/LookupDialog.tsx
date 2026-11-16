import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { LookupView } from "../../product-ui/research/LookupView";
import {
  type LookupProps,
  useLookupController,
} from "../../product-ui/research/useLookupController";
export function LookupDialog(props: LookupProps) {
  return (
    <GlobalProductTheme className="contents">
      <LookupView controller={useLookupController(props)} />
    </GlobalProductTheme>
  );
}
