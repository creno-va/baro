import {
  legacyMobileAuthProviderSchema,
  MOBILE_AUTH_CONTRACT_HEADER,
} from "../../contracts/mobile-auth";
import { appleConfiguration } from "./apple-configuration";

/** Absence is the installed app/web legacy protocol; unknown versions never silently downgrade. */
export function mobileAuthContract(request: Request): 1 | 2 | null {
  const value = request.headers.get(MOBILE_AUTH_CONTRACT_HEADER);
  return value === null || value === "1" ? 1 : value === "2" ? 2 : null;
}

/** Capability is configured availability; actual provider login still requires external acceptance. */
export function availableMobileAuthProviders(environment: Env) {
  return [
    ...legacyMobileAuthProviderSchema.options,
    ...(appleConfiguration(environment) ? ["apple" as const] : []),
  ];
}
