import { LegacyProfileAssetsView } from "../../product-ui/account/LegacyProfileAssetsView";
import { useLegacyProfileAssetsController } from "../../product-ui/account/useLegacyProfileAssetsController";

export function LegacyProfileAssets() {
  return <LegacyProfileAssetsView controller={useLegacyProfileAssetsController()} />;
}
