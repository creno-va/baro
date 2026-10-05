import { expect, test } from "bun:test";
import { foundationSmoke } from "../scripts/foundation-smoke";

const origin = "https://preview.baro.site";
const sha = "a".repeat(40);
const schemaVersion = "0006_v2_domain_foundation";
function health(path: string, patch: Record<string, unknown> = {}, requestId = "synthetic-smoke") {
  return Response.json(
    {
      release: sha,
      service: "baro",
      environment: "preview",
      status: path.endsWith("ready") ? "ready" : "ok",
      ...(path.endsWith("ready") ? { schemaVersion } : {}),
      ...patch,
    },
    { headers: requestId ? { "x-request-id": requestId } : {} },
  );
}
function harness(
  reply: (path: string, call: number, time: number) => Response | Promise<Response>,
) {
  let time = 0;
  const calls: string[] = [];
  const sleeps: number[] = [];
  const signals: AbortSignal[] = [];
  const network = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("cache-control")).toBe("no-cache");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    signals.push(init?.signal as AbortSignal);
    return reply(path, calls.length, time);
  }) as typeof fetch;
  return {
    calls,
    sleeps,
    signals,
    dependencies: {
      fetch: network,
      now: () => time,
      sleep: async (milliseconds: number) => {
        sleeps.push(milliseconds);
        time += milliseconds;
      },
    },
    advance(milliseconds: number) {
      time += milliseconds;
    },
  };
}

test("propagation beyond the old 4s window waits and verifies live AND ready at the target SHA", async () => {
  const h = harness((path, _call, time) =>
    health(path, { release: time < 10_000 ? "b".repeat(40) : sha }),
  );
  expect(await foundationSmoke(origin, sha, schemaVersion, h.dependencies)).toEqual({
    passed: true,
    attempts: 4,
  });
  expect(h.sleeps).toEqual([2_000, 4_000, 8_000]);
  expect(h.calls.slice(-2)).toEqual(["/api/health/live", "/api/health/ready"]);
});

test("live and ready from DIFFERENT attempts cannot be combined into a success", async () => {
  let attempt = 0;
  const h = harness((path) => {
    if (path.endsWith("live")) attempt++;
    return health(path, {
      release: path.endsWith("live") === (attempt % 2 === 1) ? sha : "b".repeat(40),
    });
  });
  expect((await foundationSmoke(origin, sha, schemaVersion, h.dependencies)).passed).toBe(false);
  expect(h.sleeps.reduce((total, duration) => total + duration, 0)).toBe(62_000);
  expect(h.calls.length).toBeLessThanOrEqual(14);
});

test("ready rejects wrong environment/service/status/schema/release/correlation and HTTP/JSON failures", async () => {
  const invalid = [
    () => health("ready", { environment: "production" }),
    () => health("ready", { service: "other" }),
    () => health("ready", { status: "ok" }),
    () => health("ready", { schemaVersion: "" }),
    () => health("ready", { schemaVersion: undefined }),
    () => health("ready", { schemaVersion: "0005_deletion_cleanup" }),
    () => health("ready", { schemaVersion: "0007_unverified_future" }),
    () => health("ready", { release: "b".repeat(40) }),
    () => health("ready", {}, ""),
    () => health("ready", {}, "unsafe request id"),
    () => new Response("synthetic unavailable", { status: 503 }),
    () => new Response("synthetic malformed JSON"),
  ];
  for (const reply of invalid) {
    const h = harness((path) => (path.endsWith("live") ? health(path) : reply()));
    const result = await foundationSmoke(origin, sha, schemaVersion, h.dependencies);
    expect(result.passed).toBe(false);
    if (!result.passed) expect(result.path).toBe("/api/health/ready");
    expect(h.calls.length).toBe(14);
  }
});

test("network failures are bounded; the last remaining deadline constrains request timeout", async () => {
  const h = harness(() => {
    throw new Error("synthetic private upstream detail");
  });
  const result = await foundationSmoke(origin, sha, schemaVersion, h.dependencies);
  expect(result).toEqual({
    passed: false,
    attempts: 7,
    path: "/api/health/live",
    reason: "request-failed",
  });
  expect(JSON.stringify(result)).not.toContain("upstream detail");
  expect(h.calls.length).toBe(7);

  const deadline = harness((path) => {
    deadline.advance(90_001);
    return health(path);
  });
  expect(await foundationSmoke(origin, sha, schemaVersion, deadline.dependencies)).toEqual({
    passed: false,
    attempts: 1,
    path: "/api/health/live",
    reason: "deadline",
  });
  expect(deadline.calls).toHaveLength(1);
});

test("a ready request is aborted within the remaining total deadline and retains finite timeout metadata", async () => {
  const h = harness(async (path) => {
    if (path.endsWith("live")) {
      h.advance(89_995);
      return health(path);
    }
    const signal = h.signals.at(-1);
    return new Promise<Response>((_resolve, reject) => {
      // Keep a referenced guard timer while this synthetic request waits for a native timeout signal.
      const guard = setTimeout(() => reject(new Error("Synthetic abort did not occur")), 1_000);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(guard);
          h.advance(6);
          reject(new Error("synthetic private network exception"));
        },
        { once: true },
      );
    });
  });
  expect(await foundationSmoke(origin, sha, schemaVersion, h.dependencies)).toEqual({
    passed: false,
    attempts: 1,
    path: "/api/health/ready",
    reason: "request-timeout",
  });
  expect(h.calls).toHaveLength(2);
  expect(h.signals.at(-1)?.aborted).toBe(true);
  expect(h.sleeps).toHaveLength(0);
});

test("production requires production health at the exact candidate", async () => {
  const h = harness((path) => health(path, { environment: "production" }));
  expect(await foundationSmoke("https://baro.site", sha, schemaVersion, h.dependencies)).toEqual({
    passed: true,
    attempts: 1,
  });
});

test("the expected schema belongs to the checked-out candidate, including an older foundation", async () => {
  const previous = "0005_deletion_cleanup";
  const h = harness((path) => health(path, { schemaVersion: previous }));
  expect(await foundationSmoke(origin, sha, previous, h.dependencies)).toEqual({
    passed: true,
    attempts: 1,
  });
});

test("invalid origins or candidate SHAs fail BEFORE any network call", async () => {
  const h = harness((path) => health(path));
  for (const base of [
    "http://preview.baro.site",
    "https://attacker.example",
    `${origin}/`,
    `${origin}@attacker.example`,
  ])
    await expect(foundationSmoke(base, sha, schemaVersion, h.dependencies)).rejects.toThrow();
  for (const candidate of ["main", "a".repeat(39), "A".repeat(40)])
    await expect(
      foundationSmoke(origin, candidate, schemaVersion, h.dependencies),
    ).rejects.toThrow();
  for (const migration of ["", "0006", "../0006_v2_domain_foundation"])
    await expect(foundationSmoke(origin, sha, migration, h.dependencies)).rejects.toThrow();
  expect(h.calls).toHaveLength(0);
});
