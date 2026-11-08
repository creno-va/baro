import { strict as assert } from "node:assert";

const scenario = process.argv[2];
if (!["customer", "lawyer", "legacy"].includes(scenario ?? "")) throw new Error("Unknown scenario");
const values = new Map<string, string>();
const location = {
  origin: "http://localhost:3000",
  pathname: "/login",
  search: "?returnTo=%2Fcases%2Fsynthetic-case%2Ffiles",
};
const calls: { url: string; method: string; body: Record<string, string> | null }[] = [];
globalThis.fetch = (async (input, init) => {
  const url = String(input);
  calls.push({
    url,
    method: init?.method ?? "GET",
    body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
  });
  if (url.includes("sign-in/social"))
    return Response.json({ redirect: false, url: "https://synthetic-provider.invalid" });
  if (url === "/api/me/session")
    return Response.json({
      user: { id: "existing-owner", name: "합성 사용자", accountType: scenario },
      needsConsent: false,
    });
  throw new Error(`Unexpected request: ${url}`);
}) as typeof fetch;

// Construct the actual Better Auth client with the isolated synthetic transport.
const { sessionApi } = await import("../../src/client/api/session");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location, dispatchEvent: () => true, addEventListener: () => {} },
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});
if (scenario === "legacy") {
  await sessionApi.signIn("google", "lawyer");
  const ticket = JSON.parse(values.get("baro-account-type") ?? "null");
  assert.equal(ticket.accountType, "lawyer");
  assert.equal(
    new URL(calls[0]?.body?.callbackURL ?? "", location.origin).searchParams.get("loginAttempt"),
    ticket.attempt,
  );
  assert.ok(ticket.createdAt > Date.now() - 10_000);
} else {
  values.set(
    "baro-account-type",
    JSON.stringify({ accountType: "customer", attempt: "old", createdAt: Date.now() }),
  );
  await sessionApi.signIn("kakao");
  assert.equal(values.has("baro-account-type"), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.body?.provider, "kakao");
  assert.equal(calls[0]?.body?.callbackURL, "/consent?returnTo=%2Fcases%2Fsynthetic-case%2Ffiles");
  location.pathname = "/consent";
  location.search = "?returnTo=%2Fcases%2Fsynthetic-case%2Ffiles&loginAttempt=old";
  const session = await sessionApi.get();
  assert.equal(session.user?.id, "existing-owner");
  assert.equal(session.user?.accountType, scenario);
  assert.equal(calls.filter((call) => call.url.includes("account-type")).length, 0);
}
process.stdout.write(JSON.stringify({ scenario, passed: true }));
