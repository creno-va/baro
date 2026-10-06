import { expect, test } from "bun:test";
import { checkRuntimeSecrets, requiredRuntimeSecrets } from "../scripts/check-runtime-secrets";

const accountId = "a".repeat(32);
const token = "synthetic-private-token";
const entries = () => requiredRuntimeSecrets.map((name) => ({ name, type: "secret_text" }));

test("runtime baseline covers signing, encryption, Turnstile and legal access", () => {
  expect(requiredRuntimeSecrets).toEqual([
    "BETTER_AUTH_SECRET",
    "CASE_DATA_KEY_V1",
    "TURNSTILE_SECRET_KEY",
    "LAW_API_OC",
  ]);
});

test("checks only the selected Worker's secret names with one read-only request", async () => {
  for (const environment of ["preview", "production"] as const) {
    let calls = 0;
    await checkRuntimeSecrets(environment, accountId, token, async (input, init) => {
      calls++;
      expect(String(input)).toBe(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/baro-${environment}/secrets`,
      );
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ success: true, result: entries() });
    });
    expect(calls).toBe(1);
  }
});

test("missing encryption key fails with only the allowlisted missing name", async () => {
  await expect(
    checkRuntimeSecrets("production", accountId, token, async () =>
      Response.json({
        success: true,
        result: [
          ...entries().filter((secret) => secret.name !== "CASE_DATA_KEY_V1"),
          { name: "UNRELATED_PRIVATE_NAME", type: "secret_text", text: token },
        ],
      }),
    ),
  ).rejects.toThrow("RUNTIME_SECRETS_MISSING: CASE_DATA_KEY_V1");
});

test("empty list and wrong binding type do not pass secret readiness", async () => {
  for (const result of [[], entries().map((entry) => ({ ...entry, type: "plain_text" }))])
    await expect(
      checkRuntimeSecrets("preview", accountId, token, async () =>
        Response.json({ success: true, result }),
      ),
    ).rejects.toThrow(`RUNTIME_SECRETS_MISSING: ${requiredRuntimeSecrets.join(", ")}`);
});

test("provider bodies and thrown exceptions are never included in errors", async () => {
  const fetchers = [
    async () => new Response(`${token} private-provider-error`, { status: 403 }),
    async () => {
      throw new Error(`${token} private-network-stack`);
    },
    async () => new Response(`${token} private-invalid-json`),
    async () => Response.json({ success: false, errors: [{ message: token }] }),
    async () => Response.json({ success: true, result: [{ name: token }] }),
  ];
  for (const fetcher of fetchers) {
    let message = "";
    try {
      await checkRuntimeSecrets("production", accountId, token, fetcher);
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/^Error: RUNTIME_SECRETS_(READ_FAILED|INVALID_RESPONSE)$/);
    expect(message).not.toContain(token);
    expect(message).not.toContain("private-");
  }
});

test("invalid credentials or account paths fail before a request", async () => {
  for (const [account, credential] of [
    ["", token],
    ["../other-account", token],
    [accountId, "  "],
  ]) {
    let calls = 0;
    await expect(
      checkRuntimeSecrets("preview", account ?? "", credential ?? "", async () => {
        calls++;
        return Response.json({ success: true, result: entries() });
      }),
    ).rejects.toThrow("RUNTIME_SECRETS_INPUT_INVALID");
    expect(calls).toBe(0);
  }
});
