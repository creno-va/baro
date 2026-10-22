import type { MobileConfig } from "../../../config/environment";
import { parseNativeAuthReturn } from "./attempt";

export function rewriteNativeIntent(
  path: string,
  config: MobileConfig,
  push: (raw: string) => void,
): string {
  try {
    if (parseNativeAuthReturn(path, config)) {
      push(path);
      return "/session";
    }
    const url = new URL(path, "https://native.invalid");
    // No incoming query, fragment, cookie, token or code enters Expo Router.
    return ["/", "/guide", "/directory", "/session", "/cases"].includes(url.pathname)
      ? url.pathname
      : "/session";
  } catch {
    return "/session";
  }
}
