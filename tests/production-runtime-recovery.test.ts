import { expect, test } from "bun:test";
import { recoverProductionRuntime } from "../scripts/recover-production-runtime";

const account = "9e844969d0c44b2449f3951d1f301654";
const prefix = `/client/v4/accounts/${account}`;
const settingsPath = `${prefix}/workers/scripts/baro-production/settings`;
const secretPath = `${prefix}/workers/scripts/baro-production/secrets`;
const widgetsPath = `${prefix}/challenges/widgets`;
const liveSha = "a".repeat(40);
const caseKey = btoa("k".repeat(32)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const lawApiOc = "synthetic-approved-production-oc";
const widgetSecret = "synthetic-private-widget-secret";
const token = "synthetic-cloudflare-token";
const sitekey = "synthetic-production-public-sitekey";
const input = { token, expectedLiveSha: liveSha, caseKey, lawApiOc };
const secretNames = ["CASE_DATA_KEY_V1", "LAW_API_OC", "TURNSTILE_SECRET_KEY"] as const;
type Binding = { name: string; type: string; text?: string };
type Widget = {
  sitekey: string;
  domains: string[];
  mode: string;
  clearance_level: string;
  secret?: string;
};
type Call = { path: string; method: string; body: Record<string, unknown> | null };
const widget = (changes: Partial<Widget> = {}): Widget => ({
  sitekey,
  domains: ["baro.site"],
  mode: "managed",
  clearance_level: "no_clearance",
  ...changes,
});
function response(result: unknown) {
  return Response.json({ success: true, result });
}
function harness(
  options: {
    secrets?: readonly string[];
    widgets?: Widget[];
    bindings?: (bindings: Binding[]) => Binding[];
    beforeSettings?: (read: number, bindings: Binding[]) => void;
    intercept?: (call: Call) => Response | undefined;
  } = {},
) {
  const initialBindings = [
    { name: "APP_ENV", type: "plain_text", text: "production" },
    { name: "BETTER_AUTH_URL", type: "plain_text", text: "https://baro.site" },
    { name: "RELEASE_SHA", type: "plain_text", text: liveSha },
    { name: "PUBLIC_BETA_ENABLED", type: "plain_text", text: "true" },
    { name: "BETTER_AUTH_SECRET", type: "secret_text" },
    ...(options.secrets ?? []).map((name) => ({ name, type: "secret_text" })),
  ];
  const bindings = options.bindings?.(initialBindings) ?? initialBindings;
  const widgets = [...(options.widgets ?? [])];
  const calls: Call[] = [];
  let reads = 0;
  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://api.cloudflare.com");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token}`);
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const method = init.method ?? "GET";
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    const call = { path: `${parsed.pathname}${parsed.search}`, method, body };
    calls.push(call);
    const intercepted = options.intercept?.(call);
    if (intercepted) return intercepted;
    if (parsed.pathname === settingsPath && method === "GET") {
      options.beforeSettings?.(++reads, bindings);
      return response({ bindings });
    }
    if (parsed.pathname === widgetsPath && method === "GET") {
      expect(parsed.searchParams.get("per_page")).toBe("100");
      return response(widgets);
    }
    if (parsed.pathname === widgetsPath && method === "POST") {
      expect(body).toMatchObject({
        domains: ["baro.site"],
        mode: "managed",
        clearance_level: "no_clearance",
      });
      const created = widget({ secret: widgetSecret });
      widgets.push(created);
      return response(created);
    }
    if (parsed.pathname === `${widgetsPath}/${sitekey}` && method === "GET")
      return response(widget({ secret: widgetSecret }));
    if (parsed.pathname === secretPath && method === "PUT") {
      expect(secretNames).toContain(body?.name as (typeof secretNames)[number]);
      expect(body?.type).toBe("secret_text");
      expect(Object.keys(body ?? {}).sort()).toEqual(["name", "text", "type"]);
      expect(bindings.some((binding) => binding.name === body?.name)).toBe(false);
      bindings.push({ name: String(body?.name), type: "secret_text" });
      return response({ name: body?.name, type: "secret_text" });
    }
    throw new Error("Unexpected recovery request");
  };
  return {
    calls,
    bindings,
    widgets,
    fetcher,
    writes: () => calls.filter((c) => c.method !== "GET"),
  };
}

test("missing production runtime uses the existing key, approved OC and a dedicated widget", async () => {
  const h = harness();
  const result = await recoverProductionRuntime(input, h.fetcher);
  expect(result).toEqual({
    environment: "production",
    liveSha,
    publicSiteKey: sitekey,
    widget: "created",
    secrets: secretNames.map((name) => ({ name, status: "applied" })),
  });
  const puts = h.calls.filter((c) => c.method === "PUT");
  expect(puts).toHaveLength(3);
  expect(puts.map((c) => c.body)).toEqual([
    { name: "CASE_DATA_KEY_V1", type: "secret_text", text: caseKey },
    { name: "LAW_API_OC", type: "secret_text", text: lawApiOc },
    { name: "TURNSTILE_SECRET_KEY", type: "secret_text", text: widgetSecret },
  ]);
  for (const put of puts)
    expect(h.calls[h.calls.indexOf(put) - 1]).toMatchObject({ path: settingsPath, method: "GET" });
  expect(h.calls.at(-1)).toMatchObject({ path: settingsPath, method: "GET" });
  for (const secret of [token, caseKey, lawApiOc, widgetSecret])
    expect(JSON.stringify(result)).not.toContain(secret);
});

test("existing runtime values are never overwritten or retrieved", async () => {
  const h = harness({ secrets: secretNames, widgets: [widget()] });
  const result = await recoverProductionRuntime({ ...input, caseKey: "", lawApiOc: "" }, h.fetcher);
  expect(result).toMatchObject({
    widget: "existing",
    secrets: secretNames.map((name) => ({ name, status: "already-present" })),
  });
  expect(h.writes()).toEqual([]);
  expect(h.calls.some((c) => c.path === `${widgetsPath}/${sitekey}`)).toBe(false);
});

test("existing production widget supplies only its missing Worker secret", async () => {
  const h = harness({ secrets: ["CASE_DATA_KEY_V1", "LAW_API_OC"], widgets: [widget()] });
  const result = await recoverProductionRuntime({ ...input, caseKey: "", lawApiOc: "" }, h.fetcher);
  expect(result.widget).toBe("existing");
  expect(h.writes()).toHaveLength(1);
  expect(h.writes()[0]?.body).toEqual({
    name: "TURNSTILE_SECRET_KEY",
    type: "secret_text",
    text: widgetSecret,
  });
  expect(h.calls.filter((c) => c.path === `${widgetsPath}/${sitekey}`)).toHaveLength(1);
});

test("invalid or absent recovery sources fail before any remote write", async () => {
  for (const bad of [
    { caseKey: "" },
    { caseKey: `${caseKey}=` },
    { caseKey: btoa("k".repeat(31)).replace(/=+$/, "") },
    { caseKey: "synthetic-not-a-key" },
    { lawApiOc: "" },
    { lawApiOc: "   " },
    { token: "" },
    { expectedLiveSha: "main" },
  ]) {
    const h = harness();
    await expect(recoverProductionRuntime({ ...input, ...bad }, h.fetcher)).rejects.toThrow();
    expect(h.writes()).toEqual([]);
  }
});

test("unknown metadata, wrong Worker identity and closed public gate fail without writes", async () => {
  for (const [name, text] of [
    ["APP_ENV", "preview"],
    ["BETTER_AUTH_URL", "https://preview.baro.site"],
    ["RELEASE_SHA", "b".repeat(40)],
    ["PUBLIC_BETA_ENABLED", "false"],
  ] as const) {
    const h = harness({
      bindings: (bindings) => bindings.map((b) => (b.name === name ? { ...b, text } : b)),
    });
    await expect(recoverProductionRuntime(input, h.fetcher)).rejects.toThrow();
    expect(h.writes()).toEqual([]);
  }
  for (const name of ["BETTER_AUTH_SECRET", ...secretNames]) {
    const h = harness({
      bindings: (bindings) => [
        ...bindings.filter((b) => b.name !== name),
        { name, type: "plain_text", text: "synthetic-private-misconfigured-value" },
      ],
    });
    await expect(recoverProductionRuntime(input, h.fetcher)).rejects.toThrow();
    expect(h.writes()).toEqual([]);
  }
  for (const invalid of [
    new Response("synthetic-private-error", { status: 403 }),
    response({}),
    Response.json({ success: false, result: { bindings: [] } }),
  ]) {
    const h = harness({
      intercept: (call) => (call.path === settingsPath ? invalid.clone() : undefined),
    });
    await expect(recoverProductionRuntime(input, h.fetcher)).rejects.toThrow();
    expect(h.writes()).toEqual([]);
  }
  const noAuthSecret = harness({
    bindings: (bindings) => bindings.filter((b) => b.name !== "BETTER_AUTH_SECRET"),
  });
  await expect(recoverProductionRuntime(input, noAuthSecret.fetcher)).rejects.toThrow();
  expect(noAuthSecret.writes()).toEqual([]);
});

test("ambiguous, shared and truncated widget inventories do not create or replace credentials", async () => {
  for (const widgets of [
    [widget(), widget({ sitekey: "other-production-widget" })],
    [widget({ domains: ["baro.site", "preview.baro.site"] })],
    Array.from({ length: 100 }, (_, i) =>
      widget({ sitekey: `widget-${i}`, domains: ["other.invalid"] }),
    ),
  ]) {
    const h = harness({ widgets });
    await expect(recoverProductionRuntime(input, h.fetcher)).rejects.toThrow();
    expect(h.writes()).toEqual([]);
  }
  const missingWidget = harness({ secrets: ["TURNSTILE_SECRET_KEY"] });
  await expect(recoverProductionRuntime(input, missingWidget.fetcher)).rejects.toThrow();
  expect(missingWidget.writes()).toEqual([]);
});

test("a key appearing before PUT is preserved and reported already present", async () => {
  const h = harness({
    widgets: [widget()],
    beforeSettings(read, bindings) {
      if (read === 2) bindings.push({ name: "CASE_DATA_KEY_V1", type: "secret_text" });
    },
  });
  const result = await recoverProductionRuntime(input, h.fetcher);
  expect(result.secrets.find((s) => s.name === "CASE_DATA_KEY_V1")?.status).toBe("already-present");
  expect(h.writes().some((c) => c.body?.name === "CASE_DATA_KEY_V1")).toBe(false);
});

test("a Turnstile secret appearing before widget creation stops without creating a mismatched widget", async () => {
  const h = harness({
    beforeSettings(read, bindings) {
      if (read === 2) bindings.push({ name: "TURNSTILE_SECRET_KEY", type: "secret_text" });
    },
  });
  await expect(recoverProductionRuntime(input, h.fetcher)).rejects.toThrow();
  expect(h.writes()).toEqual([]);
});

test("existing widget details must retain the selected widget identity and safe configuration", async () => {
  for (const invalid of [
    widget({ sitekey: "unselected-widget", secret: widgetSecret }),
    widget({ domains: ["baro.site", "other.invalid"], secret: widgetSecret }),
    widget({ mode: "invisible", secret: widgetSecret }),
    widget({ clearance_level: "interactive", secret: widgetSecret }),
    widget(),
  ]) {
    const h = harness({
      widgets: [widget()],
      intercept(call) {
        return call.path === `${widgetsPath}/${sitekey}` ? response(invalid) : undefined;
      },
    });
    await expect(recoverProductionRuntime(input, h.fetcher)).rejects.toThrow();
    expect(h.writes()).toEqual([]);
  }
});

test("fresh settings reject deployment changes or a binding type collision before secret PUT", async () => {
  for (const update of [
    (bindings: Binding[]) => {
      const release = bindings.find((b) => b.name === "RELEASE_SHA");
      if (release) release.text = "b".repeat(40);
    },
    (bindings: Binding[]) => bindings.push({ name: "CASE_DATA_KEY_V1", type: "plain_text" }),
  ]) {
    const h = harness({
      widgets: [widget()],
      beforeSettings(read, bindings) {
        if (read === 2) update(bindings);
      },
    });
    await expect(recoverProductionRuntime(input, h.fetcher)).rejects.toThrow();
    expect(h.writes()).toEqual([]);
  }
});

test("unknown write failure is not retried, rolled back or exposed in error text", async () => {
  const privateError = "synthetic-private-provider-credential";
  const h = harness({
    widgets: [widget()],
    intercept(call) {
      if (call.method === "PUT" && call.body?.name === "TURNSTILE_SECRET_KEY")
        throw new Error(`https://provider.invalid/?secret=${privateError}`);
      return undefined;
    },
  });
  let failure: unknown;
  try {
    await recoverProductionRuntime(input, h.fetcher);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  for (const secret of [privateError, token, caseKey, lawApiOc, widgetSecret])
    expect(String(failure)).not.toContain(secret);
  expect(h.bindings.some((b) => b.name === "CASE_DATA_KEY_V1")).toBe(true);
  expect(
    h.calls.filter((c) => c.method === "PUT" && c.body?.name === "CASE_DATA_KEY_V1"),
  ).toHaveLength(1);
  expect(
    h.calls.filter((c) => c.method === "PUT" && c.body?.name === "TURNSTILE_SECRET_KEY"),
  ).toHaveLength(1);
  expect(h.calls.filter((c) => c.method === "PUT" && c.body?.name === "LAW_API_OC")).toHaveLength(
    1,
  );
  expect(h.calls.some((c) => c.method === "DELETE")).toBe(false);
});

test("successful writes require a final settings confirmation", async () => {
  const h = harness({
    widgets: [widget()],
    beforeSettings(_read, bindings) {
      if (bindings.some((b) => b.name === "TURNSTILE_SECRET_KEY")) {
        const index = bindings.findIndex((b) => b.name === "CASE_DATA_KEY_V1");
        if (index !== -1) bindings.splice(index, 1);
      }
    },
  });
  await expect(recoverProductionRuntime(input, h.fetcher)).rejects.toThrow();
  expect(h.calls.filter((c) => c.method === "PUT")).toHaveLength(3);
});

test("HTTP and malformed mutation receipts fail without retrying or revealing provider content", async () => {
  const privateError = "synthetic-private-api-error";
  for (const invalid of [
    new Response(privateError, { status: 500 }),
    new Response(privateError, { status: 200 }),
    Response.json({ success: false, errors: [{ message: privateError }] }),
    response({ name: "wrong-secret", type: "secret_text", secret: privateError }),
  ]) {
    const h = harness({
      widgets: [widget()],
      intercept: (call) => (call.method === "PUT" ? invalid.clone() : undefined),
    });
    let failure: unknown;
    try {
      await recoverProductionRuntime(input, h.fetcher);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain(privateError);
    expect(h.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    expect(h.calls.some((c) => c.method === "DELETE")).toBe(false);
  }
});
