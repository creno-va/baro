import { GlobalProductTheme } from "../product-ui/GlobalTheme";
import { AuthView } from "../product-ui/public/AuthView";
import { useAuthController } from "../product-ui/public/useAuthController";

export { ProviderIcon } from "../product-ui/public/ProviderIcon";

export function AuthButtons() {
  const controller = useAuthController();
  return (
    <GlobalProductTheme className="contents">
      <AuthView controller={controller} />
    </GlobalProductTheme>
  );
}
