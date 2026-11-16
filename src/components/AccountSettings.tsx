import { AccountSettingsView } from "../product-ui/account/AccountSettingsView";
import { useAccountSettingsController } from "../product-ui/account/useAccountSettingsController";
import { ProviderIcon } from "./AuthButtons";
import { LegacyProfileAssets } from "./lawyers/LegacyProfileAssets";

export function AccountSettings() {
  const controller = useAccountSettingsController();
  return (
    <AccountSettingsView
      controller={controller}
      legacyAssets={<LegacyProfileAssets />}
      providerIcon={(provider) => <ProviderIcon provider={provider} />}
    />
  );
}
