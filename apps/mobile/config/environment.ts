export type MobileEnvironment = "local" | "preview" | "production";

const targets = {
  local: {
    name: "BARO 개발",
    scheme: "baro-dev",
    applicationId: "site.baro.app.dev",
    api: "http://127.0.0.1:4321",
  },
  preview: {
    name: "BARO Preview",
    scheme: "baro-preview",
    applicationId: "site.baro.app.preview",
    api: "https://preview.baro.site",
  },
  production: {
    name: "BARO",
    scheme: "baro",
    applicationId: "site.baro.app",
    api: "https://baro.site",
  },
} as const;

export interface MobileConfig {
  environment: MobileEnvironment;
  name: string;
  scheme: string;
  applicationId: string;
  apiBaseUrl: string;
}

function isLocalHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    /^10\.\d+\.\d+\.\d+$/.test(host) ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)
  );
}

/** Shared by Expo build config and runtime; inputs contain public configuration only. */
export function resolveMobileConfig(input: {
  environment?: string | undefined;
  apiBaseUrl?: string | undefined;
}): MobileConfig {
  const environment = input.environment ?? "local";
  if (environment !== "local" && environment !== "preview" && environment !== "production")
    throw new Error("MOBILE_ENVIRONMENT_INVALID");
  const target = targets[environment];
  let url: URL;
  try {
    url = new URL(input.apiBaseUrl ?? target.api);
  } catch {
    throw new Error("MOBILE_API_URL_INVALID");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("MOBILE_API_URL_INVALID");
  if (environment === "local") {
    if (!isLocalHost(url.hostname) || !["http:", "https:"].includes(url.protocol))
      throw new Error("MOBILE_LOCAL_API_REQUIRED");
  } else if (url.origin !== target.api) {
    throw new Error("MOBILE_API_ENVIRONMENT_MISMATCH");
  }
  return {
    environment,
    name: target.name,
    scheme: target.scheme,
    applicationId: target.applicationId,
    apiBaseUrl: url.origin,
  };
}
