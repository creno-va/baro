import { spawn } from "node:child_process";
import type { BrowserContext } from "@playwright/test";
import type { ReworkBrowserInfo } from "./rework-browser-server";

/** Forwards actual browser fetches to the real loopback Hono server, including
 * request bytes, signed cookies, expected-owner and idempotency headers. */
export async function openReworkBrowserFixture(
  context: BrowserContext,
  browserOrigin: string,
  purpose: ReworkBrowserInfo["purpose"],
) {
  const child = spawn("bun", ["tests/helpers/rework-browser-server.ts", browserOrigin, purpose], {
    env: { ...process.env, BARO_SYNTHETIC_REWORK_SERVER: "true" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    const info = await new Promise<ReworkBrowserInfo>((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("REWORK_BROWSER_START_TIMEOUT")), 30000);
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (!output.includes("\n")) return;
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(output.split("\n")[0] ?? ""));
        } catch {
          reject(new Error("REWORK_BROWSER_START_INVALID"));
        }
      });
      child.on("error", () => {
        clearTimeout(timeout);
        reject(new Error("REWORK_BROWSER_START_FAILED"));
      });
      child.on("exit", () => {
        clearTimeout(timeout);
        reject(new Error("REWORK_BROWSER_COMPOSITION_UNAVAILABLE"));
      });
    });
    if (
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(info.origin) ||
      info.purpose !== purpose ||
      info.ownerCookie.url !== browserOrigin ||
      info.foreignCookie.url !== browserOrigin
    )
      throw new Error("REWORK_BROWSER_SCOPE_MISMATCH");
    await context.addCookies([info.ownerCookie]);
    await context.route("**/api/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const response = await context.request.fetch(
        new URL(url.pathname + url.search, info.origin).href,
        {
          method: request.method(),
          headers: { ...request.headers(), origin: browserOrigin },
          data: request.postDataBuffer() ?? undefined,
        },
      );
      await route.fulfill({ response });
    });
    return {
      info,
      control: async (path: string, input?: unknown) => {
        if (!/^[-a-z]+$/.test(path)) throw new Error("INVALID_REWORK_TEST_CONTROL");
        return context.request.fetch(`${info.origin}/__rework-test/${path}`, {
          method: input === undefined ? "GET" : "POST",
          headers: { origin: browserOrigin },
          ...(input === undefined ? {} : { data: input }),
        });
      },
      close: () => child.stdin.end(),
    };
  } catch (cause) {
    child.stdin.end();
    child.kill("SIGTERM");
    throw cause;
  }
}
