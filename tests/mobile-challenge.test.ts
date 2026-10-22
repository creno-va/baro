import { expect, test } from "bun:test";
import { createSessionScope } from "@baro/client-core";
import { MOBILE_CHALLENGE_TIMEOUT_MS } from "@baro/contracts/mobile-challenge";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import { createChallengeModel } from "../apps/mobile/src/platform/challenge/model";

const secret = "s".repeat(43);
function fixture(newSecret: () => Promise<string> = async () => secret) {
  const scope = createSessionScope();
  let timeout: () => void = () => {},
    cancelled = 0;
  const model = createChallengeModel({
    scope,
    config: resolveMobileConfig({ environment: "preview" }),
    newId: () => crypto.randomUUID(),
    newSecret,
    schedule: (callback, ms) => {
      expect(ms).toBe(MOBILE_CHALLENGE_TIMEOUT_MS);
      timeout = callback;
      return () => {
        cancelled++;
      };
    },
  });
  return { model, scope, expire: () => timeout(), cancelled: () => cancelled };
}
async function opened(f: ReturnType<typeof fixture>, signal?: AbortSignal) {
  const result = f.model.request(signal);
  void result.catch(() => {});
  await Promise.resolve();
  const state = f.model.getSnapshot();
  if (state.kind !== "active") throw new Error("SYNTHETIC_WIDGET_NOT_ACTIVE");
  return {
    result,
    state,
    token: (overrides: Record<string, unknown> = {}) =>
      JSON.stringify({
        type: "token",
        attemptId: state.attemptId,
        secret,
        token: "synthetic-token",
        ...overrides,
      }),
  };
}

test("only the matching page, attempt, native secret and canonical token resolve one pending proof", async () => {
  const f = fixture(),
    a = await opened(f),
    id = a.state.attemptId;
  expect(JSON.stringify(a.state)).not.toContain(secret);
  expect(a.state.uri).not.toContain(secret);
  expect(f.model.connectScript(id)).toBe("true;");
  expect(f.model.message(id, a.state.uri, a.token())).toBe("ignore");
  f.model.load(id, a.state.uri);
  for (const [url, message] of [
    ["https://foreign.invalid", a.token()],
    [a.state.uri, a.token({ attemptId: crypto.randomUUID() })],
    [a.state.uri, a.token({ secret: "x".repeat(43) })],
    [a.state.uri, a.token({ token: "x".repeat(2049) })],
    [a.state.uri, a.token({ rawFacts: "SYNTHETIC_NOT_ALLOWED" })],
    [a.state.uri, "not-json"],
  ] as const)
    expect(f.model.message(id, url, message)).toBe("ignore");
  expect(f.model.getSnapshot().kind).toBe("active");
  expect(
    f.model.message(
      id,
      "https://preview.baro.site",
      JSON.stringify({ type: "ready", attemptId: id }),
    ),
  ).toBe("connect");
  expect(f.model.message(id, a.state.uri, JSON.stringify({ type: "ready", attemptId: id }))).toBe(
    "ignore",
  );
  expect(f.model.connectScript(id)).toContain(
    `window.location.href===${JSON.stringify(a.state.uri)}`,
  );
  f.model.message(id, a.state.uri, a.token());
  expect(await a.result).toBe("synthetic-token");
  expect(f.model.getSnapshot().kind).toBe("idle");
  expect(f.cancelled()).toBe(1);
  expect(f.model.connectScript(id)).toBe("true;");
  f.model.message(id, a.state.uri, a.token());
  expect(f.cancelled()).toBe(1);
});

test("navigation uses an explicit allowlist and Android's missing frame flag cannot grant a top-page handoff", async () => {
  const f = fixture(),
    a = await opened(f),
    id = a.state.attemptId;
  expect(f.model.allowNavigation(id, { url: "about:blank", isTopFrame: true })).toBe(true);
  f.model.load(id, a.state.uri);
  expect(f.model.allowNavigation(id, { url: a.state.uri, isTopFrame: true })).toBe(true);
  for (const url of [
    "https://challenges.cloudflare.com/turnstile/test",
    "about:blank",
    "about:srcdoc",
  ]) {
    expect(f.model.allowNavigation(id, { url, isTopFrame: false })).toBe(true);
    expect(f.model.allowNavigation(id, { url })).toBe(true);
    expect(f.model.allowNavigation(id, { url, isTopFrame: true })).toBe(false);
  }
  for (const url of [
    "https://foreign.invalid/",
    "https://challenges.cloudflare.com.evil.invalid",
    "https://u:p@challenges.cloudflare.com/",
    "http://challenges.cloudflare.com",
    "file:///synthetic",
    "content://synthetic",
    "javascript:alert(1)",
    "intent://synthetic",
    `${a.state.uri}&token=private`,
    "https://preview.baro.site/api/me/session",
  ]) {
    expect(f.model.allowNavigation(id, { url })).toBe(false);
  }
  f.model.load(id, "https://challenges.cloudflare.com/turnstile/test");
  await expect(a.result).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(f.model.connectScript(id)).toBe("true;");
});

test("owner and feature cancellation remove the widget and reject late tokens without replacing another request", async () => {
  const f = fixture(),
    feature = new AbortController(),
    a = await opened(f, feature.signal);
  await expect(f.model.request()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  feature.abort();
  await expect(a.result).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  const b = await opened(f);
  f.model.load(b.state.attemptId, b.state.uri);
  f.model.message(a.state.attemptId, a.state.uri, a.token());
  expect(f.model.getSnapshot().kind).toBe("active");
  f.scope.invalidate();
  await expect(b.result).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.model.getSnapshot().kind).toBe("idle");
});

test("timeout, provider failure, user cancellation and bad native entropy fail closed and preserve retry", async () => {
  for (const kind of ["timeout", "cancel", "failed", "expired", "unavailable"] as const) {
    const f = fixture(),
      a = await opened(f);
    f.model.load(a.state.attemptId, a.state.uri);
    if (kind === "timeout") f.expire();
    else if (kind === "cancel") f.model.cancel(a.state.attemptId);
    else
      f.model.message(
        a.state.attemptId,
        a.state.uri,
        JSON.stringify({ type: "error", attemptId: a.state.attemptId, secret, reason: kind }),
      );
    await expect(a.result).rejects.toMatchObject({
      code: kind === "unavailable" ? "UNAVAILABLE" : "VALIDATION_ERROR",
    });
    expect(f.cancelled()).toBe(1);
    expect(f.model.getSnapshot().kind).toBe("idle");
  }
  const bad = fixture(async () => "bad");
  await expect(bad.model.request()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(bad.model.getSnapshot().kind).toBe("idle");
});

test("late entropy after cancellation cannot reopen a widget or publish its secret", async () => {
  let release!: (value: string) => void;
  const f = fixture(
    () =>
      new Promise<string>((done) => {
        release = done;
      }),
  );
  const pending = f.model.request();
  f.model.cancel();
  await expect(pending).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  release(secret);
  await Promise.resolve();
  expect(f.model.getSnapshot().kind).toBe("idle");
});
