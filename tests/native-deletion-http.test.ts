import { expect, test } from "bun:test";
import { MOBILE_AUTH_CONTRACT_HEADER } from "../src/contracts/mobile-auth";
import {
  mobileDeletionCancelResponseSchema,
  mobileDeletionOutcomeSchema,
} from "../src/contracts/mobile-deletion";
import { api } from "../src/server/api";
import { createNativeAuthCodeStore, nativeAuthChallenge } from "../src/server/auth/native-codes";
import { nativeAuthCallbackBase } from "../src/server/auth/native-expo";
import { createOAuthFixture, responseCookies, type SyntheticProvider } from "./helpers/oauth";

const verifier = "a".repeat(43);
async function fixture(provider: SyntheticProvider = "google") {
  const f = await createOAuthFixture(provider);
  const first = await f.begin(),
    logged = await f.callback(first.state, first.cookie),
    cookie = responseCookies(logged);
  const session = await f.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error("SYNTHETIC_SESSION_MISSING");
  const attemptId = crypto.randomUUID(),
    challenge = await nativeAuthChallenge(verifier);
  const input = { attemptId, challenge, provider, confirmation: "DELETE" },
    proof = { attemptId, verifier };
  const call = (
    operation: string,
    body: unknown,
    options: { cookie?: string; origin?: string | null; version?: string | null } = {},
  ) =>
    api.request(
      `/mobile/auth/deletion/${operation}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.cookie ? { cookie: options.cookie } : {}),
          ...(options.origin === null ? {} : { origin: options.origin ?? f.env.BETTER_AUTH_URL }),
          ...(options.version === null
            ? {}
            : { [MOBILE_AUTH_CONTRACT_HEADER]: options.version ?? "2" }),
        },
        body: JSON.stringify(body),
      },
      f.env,
    );
  async function callback(purpose = "delete-account", error?: string) {
    const target = new URL(nativeAuthCallbackBase(f.env.APP_ENV) ?? "");
    target.searchParams.set("attemptId", attemptId);
    target.searchParams.set("challenge", challenge);
    target.searchParams.set("purpose", purpose);
    const start = await f.begin(target.href, target.href);
    return f.callback(start.state, start.cookie, error);
  }
  return { ...f, cookie, session, input, proof, call, callback };
}
for (const provider of ["google", "naver", "kakao"] as const)
  test(`${provider}: real SDK delete callback expires cookies, returns only a deletion completion code, and cannot create an auth grant`, async () => {
    const f = await fixture(provider);
    try {
      expect((await f.call("prepare", f.input, { cookie: f.cookie })).status).toBe(200);
      const returned = await f.callback(),
        url = new URL(returned.headers.get("location") ?? "");
      expect([...url.searchParams.keys()].sort()).toEqual(["attemptId", "code"]);
      expect(url.searchParams.get("attemptId")).toBe(f.input.attemptId);
      const code = url.searchParams.get("code");
      expect(code).toHaveLength(43);
      expect(
        returned.headers
          .getSetCookie()
          .some(
            (value) =>
              value.startsWith("better-auth.session_token=;") &&
              value.toLowerCase().includes("max-age=0"),
          ),
      ).toBe(true);
      expect(
        f.database.sqlite.query("SELECT id FROM user WHERE id=?").get(f.session.user.id),
      ).toBeNull();
      expect(
        f.database.sqlite
          .query("SELECT count(*) n FROM session WHERE user_id=?")
          .get(f.session.user.id),
      ).toEqual({ n: 0 });
      expect(
        await f.auth.api.getSession({ headers: new Headers({ cookie: f.cookie }) }),
      ).toBeNull();
      const status = await f.call("status", f.proof);
      expect(status.status).toBe(200);
      const outcome = mobileDeletionOutcomeSchema.parse(await status.json());
      expect(outcome.appleRevocation).toBe("not_linked");
      expect(status.headers.get("cache-control")).toContain("no-store");
      expect((await f.call("status", { ...f.proof, verifier: "b".repeat(43) })).status).toBe(401);
      const exchange = await f.call("exchange", { ...f.proof, code });
      expect(exchange.status).toBe(200);
      expect(mobileDeletionOutcomeSchema.parse(await exchange.json())).toEqual(outcome);
      expect((await f.call("exchange", { ...f.proof, code })).status).toBe(401);
      expect((await f.call("cancel", f.proof)).status).toBe(202);
      expect((await f.call("status", f.proof)).status).toBe(200);
      const authCodes = createNativeAuthCodeStore({
        db: f.env.DB,
        issuer: f.env.BETTER_AUTH_URL,
        secret: f.env.BETTER_AUTH_SECRET,
      });
      await expect(authCodes.exchange({ ...f.proof, code: String(code) })).rejects.toThrow();
      expect(
        f.database.sqlite
          .query("SELECT count(*) n FROM app_metadata WHERE key LIKE 'native-auth:v1:%'")
          .get(),
      ).toEqual({ n: 0 });
    } finally {
      f.database.close();
    }
  });

test("delete endpoints require exact v2+Origin; explicit confirmation and current owner are required only for preparation", async () => {
  const f = await fixture();
  try {
    for (const version of [null, "1", "2, 2", "3"])
      expect((await f.call("prepare", f.input, { cookie: f.cookie, version })).status).toBe(400);
    for (const origin of [null, "https://foreign.example.test"])
      expect((await f.call("prepare", f.input, { cookie: f.cookie, origin })).status).toBe(403);
    expect((await f.call("prepare", f.input)).status).toBe(401);
    expect(
      (await f.call("prepare", { ...f.input, confirmation: "delete" }, { cookie: f.cookie }))
        .status,
    ).toBe(400);
    expect(
      (await f.call("prepare", { ...f.input, provider: "apple" }, { cookie: f.cookie })).status,
    ).toBe(503);
    expect(
      (await f.call("prepare", { ...f.input, provider: "naver" }, { cookie: f.cookie })).status,
    ).toBe(401);
    expect((await f.call("status", f.proof)).status).toBe(401);
    expect((await f.call("cancel", f.proof)).status).toBe(401);
    expect((await f.call("prepare", f.input, { cookie: f.cookie })).status).toBe(200);
    expect((await f.call("cancel", { ...f.proof, verifier: "b".repeat(43) })).status).toBe(401);
    const cancelled = await f.call("cancel", f.proof);
    expect(cancelled.status).toBe(200);
    expect(mobileDeletionCancelResponseSchema.parse(await cancelled.json())).toEqual({
      status: "cancelled",
    });
    expect((await f.call("cancel", f.proof)).status).toBe(401);
    const returned = new URL((await f.callback()).headers.get("location") ?? "");
    expect(returned.searchParams.get("error")).toBe("oauth");
    expect(returned.searchParams.has("code")).toBe(false);
    expect(
      f.database.sqlite.query("SELECT id FROM user WHERE id=?").get(f.session.user.id),
    ).not.toBeNull();
  } finally {
    f.database.close();
  }
});

test("ordinary reauthentication and provider cancellation cannot accidentally commit a prepared deletion", async () => {
  const f = await fixture();
  try {
    expect((await f.call("prepare", f.input, { cookie: f.cookie })).status).toBe(200);
    for (const [purpose, error] of [
      ["reauthenticate", undefined],
      ["delete-account", "access_denied"],
    ] as const) {
      const url = new URL((await f.callback(purpose, error)).headers.get("location") ?? "");
      expect(url.searchParams.has("code")).toBe(false);
      expect(
        f.database.sqlite.query("SELECT id FROM user WHERE id=?").get(f.session.user.id),
      ).not.toBeNull();
      expect((await f.call("status", f.proof)).status).toBe(401);
    }
    expect((await f.call("cancel", f.proof)).status).toBe(200);
  } finally {
    f.database.close();
  }
});
