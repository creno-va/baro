import {
  legacyMobileAuthProviderSchema,
  MOBILE_AUTH_CONTRACT_HEADER,
} from "../../contracts/mobile-auth";

/** Absence is the installed app/web legacy protocol; unknown versions never silently downgrade. */
export function mobileAuthContract(request: Request): 1 | 2 | null {
  const value = request.headers.get(MOBILE_AUTH_CONTRACT_HEADER);
  return value === null || value === "1" ? 1 : value === "2" ? 2 : null;
}

/** Apple remains unavailable until callback, account and revocation producer acceptance. */
export function availableMobileAuthProviders() {
  return [...legacyMobileAuthProviderSchema.options];
}
