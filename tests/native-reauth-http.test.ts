import { expect, test } from "bun:test";
import {
  mobileAuthExchangeResponseSchema,
  mobileReauthReceiptSchema,
} from "../src/contracts/mobile-auth";
import { api } from "../src/server/api";
import { nativeAuthChallenge } from "../src/server/auth/native-codes";
import { nativeAuthCallbackBase } from "../src/server/auth/native-expo";
import { createOAuthFixture, responseCookies, type SyntheticProvider } from "./helpers/oauth";
import { seedTestSession } from "./helpers/session";

const verifier = "a".repeat(43);
async function fixture(provider: SyntheticProvider = "google") {
  const f = await createOAuthFixture(provider);
  const start = await f.begin();
  const loggedIn = await f.callback(start.state, start.cookie);
  const cookie = responseCookies(loggedIn);
  const original = await f.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!original) throw new Error("SYNTHETIC_SESSION_MISSING");
  const attemptId = crypto.randomUUID(),
    challenge = await nativeAuthChallenge(verifier);
  const call = (
    operation: string,
    body: unknown,
    signedCookie = cookie,
    origin: string | null = f.env.BETTER_AUTH_URL,
  ) =>
    api.request(
      `/mobile/auth/${operation}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: signedCookie,
          ...(origin ? { origin } : {}),
        },
        body: JSON.stringify(body),
      },
      f.env,
    );
  const prepare = () => call("reauth/prepare", { attemptId, challenge, provider });
  async function authorize(purpose: "reauthenticate" | undefined = "reauthenticate") {
    const base = nativeAuthCallbackBase(f.env.APP_ENV);
    if (!base) throw new Error("SYNTHETIC_NATIVE_ENV");
    const callback = new URL(base);
    callback.searchParams.set("attemptId", attemptId);
    callback.searchParams.set("challenge", challenge);
    if (purpose) callback.searchParams.set("purpose", purpose);
    const auth = await f.begin(callback.href, callback.href);
    return f.callback(auth.state, auth.cookie);
  }
  return { ...f, cookie, original, attemptId, challenge, call, prepare, authorize };
}
for (const provider of ["google", "naver", "kakao"] as const)
  test(`${provider}: original native owner preparation, real OAuth callback, purpose-bound exchange and exact new-session proof`, async () => {
    const f = await fixture(provider);
    try {
      const prepared = await f.prepare();
      expect(prepared.status).toBe(200);
      const receipt = mobileReauthReceiptSchema.parse(await prepared.json());
      const callback = await f.authorize(),
        returned = new URL(callback.headers.get("location") ?? "");
      expect([...returned.searchParams.keys()].sort()).toEqual(["attemptId", "code"]);
      const input = {
        attemptId: f.attemptId,
        code: returned.searchParams.get("code"),
        verifier,
        purpose: "reauthenticate",
      };
      const proof = { attemptId: f.attemptId, verifier };
      expect((await f.call("reauth/verify", proof)).status).toBe(401);
      const peer = await seedTestSession(f.database);
      const denied = await f.call("exchange", input, peer.cookie);
      expect(denied.status).toBe(401);
      if (denied.headers.has("set-cookie")) {
        const refreshed = await f.auth.api.getSession({
          headers: new Headers({ cookie: responseCookies(denied) }),
        });
        expect(refreshed?.user.id).toBe(peer.userId);
      }
      const { purpose: _purpose, ...downgraded } = input;
      expect((await f.call("exchange", downgraded)).status).toBe(401);
      const accepted = await f.call("exchange", input);
      expect(accepted.status).toBe(200);
      expect(mobileAuthExchangeResponseSchema.parse(await accepted.clone().json())).toEqual({
        status: "accepted",
      });
      const currentCookie = responseCookies(accepted);
      expect((await f.call("exchange", input, currentCookie)).status).toBe(401);
      expect(
        (await f.call("reauth/verify", { ...proof, verifier: "b".repeat(43) }, currentCookie))
          .status,
      ).toBe(401);
      const verified = await f.call("reauth/verify", proof, currentCookie);
      expect(verified.status).toBe(200);
      expect(mobileReauthReceiptSchema.parse(await verified.json())).toEqual(receipt);
      const current = await f.auth.api.getSession({
        headers: new Headers({ cookie: currentCookie }),
      });
      expect(current?.user.id).toBe(f.original.user.id);
      expect(current?.session.id).not.toBe(f.original.session.id);
      expect(verified.headers.get("cache-control")).toContain("no-store");
      const rows = f.database.sqlite
        .query("SELECT value FROM app_metadata WHERE key LIKE 'native-reauth:v1:%'")
        .all();
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain(verifier);
      expect(JSON.stringify(rows)).not.toContain(f.challenge);
    } finally {
      f.database.close();
    }
  });
test("a different browser account cannot issue a reauthentication grant or replace the original native session", async () => {
  const f = await fixture();
  try {
    expect((await f.prepare()).status).toBe(200);
    const provider = f.context.socialProviders.find((entry) => entry.id === "google");
    if (!provider) throw new Error("FIXTURE");
    provider.getUserInfo = async () => ({
      user: { name: "Synthetic other", email: "other@example.test", emailVerified: true },
      data: { sub: "synthetic_other_subject" },
    });
    const callback = await f.authorize(),
      returned = new URL(callback.headers.get("location") ?? "");
    expect(returned.searchParams.get("error")).toBe("oauth");
    expect(returned.searchParams.has("code")).toBe(false);
    const existing = await f.auth.api.getSession({ headers: new Headers({ cookie: f.cookie }) });
    expect(existing?.user.id).toBe(f.original.user.id);
    expect((await f.call("reauth/verify", { attemptId: f.attemptId, verifier })).status).toBe(401);
  } finally {
    f.database.close();
  }
});
test("no preparation, an unlinked provider, invalid Origin or missing current native session cannot arm reauthentication", async () => {
  const f = await fixture();
  try {
    const raw = { attemptId: f.attemptId, challenge: f.challenge, provider: "google" };
    expect((await f.call("reauth/prepare", raw, f.cookie, null)).status).toBe(403);
    expect((await f.call("reauth/prepare", raw, "")).status).toBe(401);
    expect((await f.call("reauth/prepare", { ...raw, provider: "naver" })).status).toBe(401);
    const callback = await f.authorize(),
      returned = new URL(callback.headers.get("location") ?? "");
    expect(returned.searchParams.get("error")).toBe("oauth");
    expect(returned.searchParams.has("code")).toBe(false);
  } finally {
    f.database.close();
  }
});
