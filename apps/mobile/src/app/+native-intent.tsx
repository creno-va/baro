import { authReturns } from "../composition/auth-return";
import { readMobileConfig } from "../composition/config";
import { parseNativeAuthReturn } from "../platform/auth/attempt";

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (parseNativeAuthReturn(path, readMobileConfig())) {
      authReturns.push(path);
      return "/session";
    }
    const url = new URL(path, "https://native.invalid");
    // Strip every incoming query, including malformed OAuth material. Only
    // existing public routes may be selected by an unsolicited system link.
    return ["/", "/guide", "/directory", "/session"].includes(url.pathname)
      ? url.pathname
      : "/session";
  } catch {
    return "/session";
  }
}
