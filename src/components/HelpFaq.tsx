import { GlobalProductTheme } from "../product-ui/GlobalTheme";
import { HelpFaqView } from "../product-ui/public/HelpFaqView";

export function HelpFaq() {
  return (
    <GlobalProductTheme className="contents">
      <HelpFaqView mock={import.meta.env.PUBLIC_API_MODE === "mock"} />
    </GlobalProductTheme>
  );
}
