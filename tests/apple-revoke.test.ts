import { expect, test } from "bun:test";
import { type AppleCallbackMaterial, revokeAppleAccess } from "../src/server/auth/apple-revoke";

const environment = {
  APPLE_CLIENT_ID: "synthetic-service",
  APPLE_CLIENT_SECRET: "synthetic-server-secret",
};
const material = {
  subject: "synthetic-sub",
  accessToken: "synthetic-access",
  refreshToken: "synthetic-refresh",
};
test("revocation sends exactly one fixed HTTPS form request, prefers refresh and confirms only the documented empty 200", async () => {
  const materials: AppleCallbackMaterial[] = [
    material,
    { subject: material.subject, accessToken: material.accessToken },
  ];
  for (const tokens of materials) {
    let calls = 0;
    const result = await revokeAppleAccess(environment, tokens, {
      fetch: (async (url, options) => {
        calls++;
        expect(url).toBe("https://appleid.apple.com/auth/revoke");
        expect(options).toMatchObject({ method: "POST", redirect: "error", credentials: "omit" });
        expect(new Headers(options?.headers).get("content-type")).toBe(
          "application/x-www-form-urlencoded",
        );
        expect(new Headers(options?.headers).has("cookie")).toBe(false);
        expect(Object.fromEntries(new URLSearchParams(String(options?.body)))).toEqual({
          client_id: environment.APPLE_CLIENT_ID,
          client_secret: environment.APPLE_CLIENT_SECRET,
          token: tokens.refreshToken ?? tokens.accessToken ?? "",
          token_type_hint: tokens.refreshToken ? "refresh_token" : "access_token",
        });
        return new Response(null, { status: 200 });
      }) as typeof fetch,
    });
    expect(calls).toBe(1);
    expect(result).toEqual({ status: "confirmed", reason: "revoked", httpStatus: 200 });
  }
});
for (const scenario of [
  "missing-config",
  "partial-config",
  "missing-token",
  "oversized-token",
  "400",
  "500",
  "body",
  "redirect",
  "wrong-url",
  "network",
  "deadline",
  "slow-body",
] as const)
  test(`revocation never turns uncertainty into success or retries: ${scenario}`, async () => {
    let calls = 0;
    const result = await revokeAppleAccess(
      scenario === "missing-config"
        ? {}
        : scenario === "partial-config"
          ? { APPLE_CLIENT_ID: "synthetic" }
          : environment,
      scenario === "missing-token"
        ? null
        : scenario === "oversized-token"
          ? { subject: "synthetic", accessToken: "a".repeat(16385) }
          : material,
      {
        timeoutMs: 10,
        fetch: (async (_url, options) => {
          calls++;
          if (scenario === "network") throw new Error("synthetic-private-provider-error");
          if (scenario === "deadline")
            return new Promise((_resolve, reject) =>
              options?.signal?.addEventListener("abort", () =>
                reject(new Error("synthetic-abort")),
              ),
            );
          if (scenario === "slow-body") return new Response(new ReadableStream({ start() {} }));
          if (scenario === "400" || scenario === "500")
            return new Response("synthetic-private-error-body", { status: Number(scenario) });
          const response = new Response(scenario === "body" ? "{}" : null, { status: 200 });
          if (scenario === "redirect")
            Object.defineProperty(response, "redirected", { value: true });
          if (scenario === "wrong-url")
            Object.defineProperty(response, "url", { value: "https://foreign.example.test/" });
          return response;
        }) as typeof fetch,
      },
    );
    expect(result.status).toBe("unconfirmed");
    expect(calls).toBe(
      ["missing-config", "partial-config", "missing-token", "oversized-token"].includes(scenario)
        ? 0
        : 1,
    );
    if (scenario === "deadline" || scenario === "slow-body") expect(result.reason).toBe("timeout");
    for (const value of [
      "synthetic-private",
      material.accessToken,
      material.refreshToken,
      environment.APPLE_CLIENT_SECRET,
    ])
      expect(JSON.stringify(result)).not.toContain(value);
  });
