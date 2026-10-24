import { expect, test } from "bun:test";
import {
  ApiError,
  createJsonRequester,
  createMobileAuthClient,
  type JsonRequest,
  type JsonRequestOptions,
  type MobileAuthProtocol,
} from "@baro/api-client";
import { Hono } from "hono";
import { api } from "../src/server/api";
import { nativeAuthChallenge } from "../src/server/auth/native-codes";
import { nativeAuthCallbackBase } from "../src/server/auth/native-expo";
import { createOAuthFixture, responseCookies } from "./helpers/oauth";

const v2: MobileAuthProtocol = {
  contractVersion: 2,
  providers: ["google", "naver", "kakao", "apple"],
};
const legacy: MobileAuthProtocol = { contractVersion: 1, providers: ["google", "naver", "kakao"] };
const prepare = { attemptId: crypto.randomUUID(), challenge: "a".repeat(43), provider: "apple" };
const proof = { attemptId: prepare.attemptId, verifier: "b".repeat(43) };
const receipt = { ownerTag: "c".repeat(64), startedAt: 1000 };
const accepted = {
  contractVersion: 2,
  status: "accepted",
  ownerTag: receipt.ownerTag,
  appleRevocation: "unconfirmed",
} as const;
for (const [status, body, expected] of [
  [404, { error: { code: "NOT_FOUND" } }, "legacy"],
  [404, "plain-old-server", "legacy"],
  [503, { error: { code: "NOT_FOUND" } }, "error"],
  [401, { error: { code: "NOT_FOUND" } }, "error"],
  [200, { contractVersion: 3, providers: ["google"] }, "error"],
  [200, { contractVersion: 2, providers: ["apple", "apple"] }, "error"],
  [200, { contractVersion: 2, providers: ["unknown"] }, "error"],
  [200, { contractVersion: 2, providers: ["google"], accessToken: "synthetic-secret" }, "error"],
  [200, "not-json", "error"],
] as const)
  test(`mobile capability negotiation uses actual HTTP404 only: ${status}/${JSON.stringify(body).slice(0, 50)}`, async () => {
    let calls = 0;
    const request = createJsonRequester({
      newKey: () => crypto.randomUUID(),
      transport: async () => {
        calls++;
        return typeof body === "string"
          ? new Response(body, { status })
          : Response.json(body, { status });
      },
    });
    const client = createMobileAuthClient({ request, completionRequest: request });
    if (expected === "legacy") expect(await client.capabilities()).toEqual(legacy);
    else await expect(client.capabilities()).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });

test("network and unproven NOT_FOUND cannot silently select legacy; malformed v2 never retries as v1", async () => {
  for (const error of [
    new Error("synthetic-network"),
    new ApiError("NOT_FOUND", "synthetic-unproven"),
    new ApiError("UNAVAILABLE", "synthetic-timeout"),
  ]) {
    let calls = 0;
    const request: JsonRequest = async () => {
      calls++;
      throw error;
    };
    await expect(
      createMobileAuthClient({ request, completionRequest: request }).capabilities(),
    ).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  }
});

test("v2 reauthentication is additive, legacy remains strict, and unsupported Apple cannot send a request", async () => {
  const calls: Parameters<JsonRequest>[0][] = [];
  const request: JsonRequest = async <T>(options: JsonRequestOptions) => {
    calls.push(options);
    return receipt as T;
  };
  const client = createMobileAuthClient({ request, completionRequest: request });
  expect(await client.prepareReauthentication(v2, prepare, "synthetic-owner")).toEqual(receipt);
  expect(calls[0]).toMatchObject({
    path: "/api/mobile/auth/reauth/prepare",
    expectedOwner: "synthetic-owner",
    headers: { "x-baro-auth-contract": "2" },
    body: prepare,
  });
  await expect(
    client.prepareReauthentication(legacy, prepare, "synthetic-owner"),
  ).rejects.toBeInstanceOf(ApiError);
  await expect(
    client.prepareReauthentication({ ...v2, providers: ["google"] }, prepare, "synthetic-owner"),
  ).rejects.toBeInstanceOf(ApiError);
  expect(calls).toHaveLength(1);
  await client.prepareReauthentication(
    legacy,
    { ...prepare, provider: "google" },
    "synthetic-owner",
  );
  expect(calls[1]).not.toHaveProperty("headers");
  expect(calls[1]).toMatchObject({ body: { provider: "google" } });
  await client.verifyReauthentication(v2, proof);
  expect(calls[2]).toMatchObject({ headers: { "x-baro-auth-contract": "2" }, body: proof });
});

test("v2 deletion has explicit confirmation and owner boundary; completion uses a separate tokenless requester", async () => {
  const authenticated: Parameters<JsonRequest>[0][] = [],
    completions: Parameters<JsonRequest>[0][] = [];
  let outcome: unknown = accepted;
  const request: JsonRequest = async <T>(options: JsonRequestOptions) => {
    authenticated.push(options);
    return receipt as T;
  };
  const completionRequest: JsonRequest = async <T>(options: JsonRequestOptions) => {
    completions.push(options);
    return outcome as T;
  };
  const client = createMobileAuthClient({ request, completionRequest });
  expect(
    await client.prepareDeletion(v2, { ...prepare, confirmation: "DELETE" }, "synthetic-owner"),
  ).toEqual(receipt);
  await expect(
    client.prepareDeletion(legacy, { ...prepare, confirmation: "DELETE" }, "synthetic-owner"),
  ).rejects.toBeInstanceOf(ApiError);
  await expect(
    client.prepareDeletion(v2, { ...prepare, confirmation: "delete" }, "synthetic-owner"),
  ).rejects.toBeInstanceOf(ApiError);
  expect(authenticated).toHaveLength(1);
  expect(authenticated[0]).toMatchObject({
    expectedOwner: "synthetic-owner",
    headers: { "x-baro-auth-contract": "2" },
  });
  expect(
    await client.exchangeDeletion({ ...proof, code: "d".repeat(43) }, receipt.ownerTag),
  ).toEqual(accepted);
  expect(await client.deletionStatus(proof, receipt.ownerTag)).toEqual(accepted);
  expect(await client.cancelDeletion(proof, receipt.ownerTag)).toEqual(accepted);
  expect(completions.map((call) => call.path)).toEqual([
    "/api/mobile/auth/deletion/exchange",
    "/api/mobile/auth/deletion/status",
    "/api/mobile/auth/deletion/cancel",
  ]);
  for (const call of completions) {
    expect(call).not.toHaveProperty("expectedOwner");
    expect(call.headers).toEqual({ "x-baro-auth-contract": "2" });
  }
  await expect(client.deletionStatus(proof, "e".repeat(64))).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  outcome = { status: "cancelled" };
  expect(await client.cancelDeletion(proof, receipt.ownerTag)).toEqual({ status: "cancelled" });
  outcome = { ...accepted, appleRevocation: "pending" };
  await expect(client.deletionStatus(proof, receipt.ownerTag)).rejects.toBeInstanceOf(ApiError);
});

for (const version of [1, 2] as const)
  test(`deletion access parses exactly its negotiated contract and never downgrades: v${version}`, async () => {
    const access = {
      ...receipt,
      recentOAuth: true,
      authenticatedAt: new Date().toISOString(),
      providers: version === 1 ? ["google"] : ["google", "apple"],
    };
    const { startedAt: _, ...base } = access;
    let value: unknown = version === 1 ? base : { ...base, contractVersion: 2 };
    const request: JsonRequest = async <T>() => value as T;
    const client = createMobileAuthClient({ request, completionRequest: request });
    const result = await client.deletionAccess(version === 1 ? legacy : v2, "synthetic-owner");
    expect(result.contractVersion).toBe(version);
    value = version === 1 ? { ...base, contractVersion: 2 } : base;
    await expect(
      client.deletionAccess(version === 1 ? legacy : v2, "synthetic-owner"),
    ).rejects.toBeInstanceOf(ApiError);
  });

for (const provider of ["google", "naver", "kakao"] as const)
  test(`${provider}: shared v2 client uses real SDK/SQL deletion and recovers a completion without any session`, async () => {
    const f = await createOAuthFixture(provider),
      worker = new Hono().route("/api", api);
    try {
      const start = await f.begin(),
        initial = await f.callback(start.state, start.cookie),
        cookie = responseCookies(initial),
        owner = await f.auth.api.getSession({ headers: new Headers({ cookie }) });
      if (!owner) throw new Error("SYNTHETIC_OWNER_MISSING");
      let nativeCookie = cookie;
      const makeRequest = (authenticated: boolean) =>
        createJsonRequester({
          newKey: () => crypto.randomUUID(),
          transport: async (path, init) =>
            worker.request(
              f.env.BETTER_AUTH_URL + path,
              {
                ...init,
                headers: {
                  ...Object.fromEntries(new Headers(init.headers)),
                  origin: f.env.BETTER_AUTH_URL,
                  ...(authenticated ? { cookie: nativeCookie } : {}),
                },
              },
              f.env,
            ),
        });
      const client = createMobileAuthClient({
          request: makeRequest(true),
          completionRequest: makeRequest(false),
        }),
        protocol = await client.capabilities();
      expect(protocol.contractVersion).toBe(2);
      expect(protocol.providers).toEqual(["google", "naver", "kakao"]);
      const verifier = "a".repeat(43),
        attemptId = crypto.randomUUID(),
        challenge = await nativeAuthChallenge(verifier);
      const prepared = await client.prepareDeletion(
        protocol,
        { attemptId, challenge, provider, confirmation: "DELETE" },
        owner.user.id,
      );
      const target = new URL(nativeAuthCallbackBase(f.env.APP_ENV) ?? "");
      target.searchParams.set("attemptId", attemptId);
      target.searchParams.set("challenge", challenge);
      target.searchParams.set("purpose", "delete-account");
      const next = await f.begin(target.href, target.href),
        finished = await f.callback(next.state, next.cookie),
        returned = new URL(finished.headers.get("location") ?? "");
      nativeCookie = "";
      const result = await client.deletionStatus({ attemptId, verifier }, prepared.ownerTag);
      expect(result).toMatchObject({ status: "accepted", appleRevocation: "not_linked" });
      expect(
        await client.exchangeDeletion(
          { attemptId, verifier, code: returned.searchParams.get("code") },
          prepared.ownerTag,
        ),
      ).toEqual(result);
      await expect(
        client.exchangeDeletion(
          { attemptId, verifier, code: returned.searchParams.get("code") },
          prepared.ownerTag,
        ),
      ).rejects.toMatchObject({ code: "UNAUTHENTICATED", httpStatus: 401 });
      expect(await client.cancelDeletion({ attemptId, verifier }, prepared.ownerTag)).toEqual(
        result,
      );
      expect(
        f.database.sqlite
          .query("SELECT count(*) n FROM session WHERE user_id=?")
          .get(owner.user.id),
      ).toEqual({ n: 0 });
    } finally {
      f.database.close();
    }
  });

test("unknown or unavailable deletion status/cancel never becomes an acknowledged cancellation", async () => {
  for (const status of [401, 404, 503]) {
    const request = createJsonRequester({
      newKey: () => crypto.randomUUID(),
      transport: async () =>
        Response.json(
          { error: { code: status === 503 ? "DEPENDENCY_UNAVAILABLE" : "UNAUTHENTICATED" } },
          { status },
        ),
    });
    const client = createMobileAuthClient({ request, completionRequest: request });
    await expect(client.cancelDeletion(proof, receipt.ownerTag)).rejects.toMatchObject({
      httpStatus: status,
    });
    await expect(client.deletionStatus(proof, receipt.ownerTag)).rejects.toMatchObject({
      httpStatus: status,
    });
  }
});

test("invalid proof/confirmation/owner binding cannot send completion credentials", async () => {
  let calls = 0;
  const request: JsonRequest = async () => {
    calls++;
    throw new Error("MUST_NOT_SEND");
  };
  const client = createMobileAuthClient({ request, completionRequest: request });
  await expect(
    client.prepareDeletion(v2, { ...prepare, confirmation: "delete" }, "synthetic-owner"),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(
    client.exchangeDeletion({ ...proof, code: "d".repeat(43) }, "invalid-tag"),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(
    client.deletionStatus({ ...proof, verifier: "short" }, receipt.ownerTag),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(
    client.cancelDeletion({ ...proof, token: "synthetic-extra" }, receipt.ownerTag),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(calls).toBe(0);
});
