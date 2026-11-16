import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { NavigationView } from "../../product-ui/navigation/NavigationView";
import type { AppNavigationProps } from "../../product-ui/navigation/types";
import { useNavigationController } from "../../product-ui/navigation/useNavigationController";

export type { NavigationItem, NavigationRole } from "../../product-ui/navigation/types";
export { availableNavigation, ROLE_NAVIGATION } from "../../product-ui/navigation/types";

/** Existing routes retain their entry contract while the visual tree is rebuilt. */
export function AppNavigation(props: AppNavigationProps) {
  const controller = useNavigationController(props);
  return (
    <GlobalProductTheme className="contents">
      <NavigationView controller={controller} />
    </GlobalProductTheme>
  );
}
