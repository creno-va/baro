import { GlobalProductTheme } from "../product-ui/GlobalTheme";
import { ConsentView } from "../product-ui/public/ConsentView";
import { useConsentController } from "../product-ui/public/useConsentController";

export function ConsentForm() {
  const controller = useConsentController();
  return (
    <GlobalProductTheme className="contents">
      <ConsentView controller={controller} />
    </GlobalProductTheme>
  );
}
