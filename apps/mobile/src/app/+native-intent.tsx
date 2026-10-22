import { authReturns } from "../composition/auth-return";
import { readMobileConfig } from "../composition/config";
import { rewriteNativeIntent } from "../platform/auth/intent";

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return rewriteNativeIntent(path, readMobileConfig(), authReturns.push);
  } catch {
    return "/session";
  }
}
