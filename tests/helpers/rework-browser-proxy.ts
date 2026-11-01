import { spawn } from "node:child_process";
import type { APIResponse, BrowserContext, Request as BrowserRequest } from "@playwright/test";
import type { ReworkBrowserInfo } from "./rework-browser-server";

/** Forwards actual browser fetches to the real loopback Hono server, including
 * request bytes, signed cookies, expected-owner and idempotency headers. */
export async function openReworkBrowserFixture(
  context: BrowserContext,
  browserOrigin: string,
  purpose: ReworkBrowserInfo["purpose"],
  options: {
    /** Lose an actual committed response; never manufacture a result DTO. */
    dropResponse?: (request: BrowserRequest, response: APIResponse) => boolean | Promise<boolean>;
  } = {},
) {
  const child = spawn("bun", ["tests/helpers/rework-browser-server.ts", browserOrigin, purpose], {
    env: { ...process.env, BARO_SYNTHETIC_REWORK_SERVER: "true" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  // Provider diagnostics never become browser artifacts or fill a pipe.
  child.stderr.resume();
  let stopping = false;
  const upstream = new Set<Promise<APIResponse>>();
  const close = async () => {
    stopping = true;
    // Keep the aborting route installed until Playwright closes its context.
    // Waiting on offline WebKit route.fulfill can stall; only actual upstream
    // fetches must drain before Hono/DB cleanup. Failure DOM stays inspectable.
    await Promise.allSettled([...upstream]);
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => child.kill("SIGTERM"), 30000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.stdin.end();
    });
  };
  try {
    const info = await new Promise<ReworkBrowserInfo>((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("REWORK_BROWSER_START_TIMEOUT")), 30000);
      const readInfo = (chunk: Buffer) => {
        output += String(chunk);
        if (output.length > 65536) {
          clearTimeout(timeout);
          child.stdout.off("data", readInfo);
          child.stdout.resume();
          reject(new Error("REWORK_BROWSER_START_LIMIT"));
          return;
        }
        if (!output.includes("\n")) return;
        clearTimeout(timeout);
        child.stdout.off("data", readInfo);
        child.stdout.resume();
        try {
          resolve(JSON.parse(output.split("\n")[0] ?? ""));
        } catch {
          reject(new Error("REWORK_BROWSER_START_INVALID"));
        }
      };
      child.stdout.on("data", readInfo);
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
    const actions: { body: string | null; key: string | undefined }[] = [];
    await context.route("**/api/**", async (route) => {
      if (stopping) return route.abort("aborted").catch(() => undefined);
      try {
        const request = route.request(),
          url = new URL(request.url());
        if (!url.pathname.startsWith("/api/")) return route.continue();
        const pending = context.request.fetch(
          new URL(url.pathname + url.search, info.origin).href,
          {
            method: request.method(),
            headers: { ...request.headers(), origin: browserOrigin },
            data: request.postDataBuffer() ?? undefined,
          },
        );
        upstream.add(pending);
        let response: APIResponse;
        try {
          response = await pending;
        } finally {
          upstream.delete(pending);
        }
        if (request.method() === "POST" && url.pathname.endsWith("/rework/actions"))
          actions.push({ body: request.postData(), key: request.headers()["idempotency-key"] });
        if (await options.dropResponse?.(request, response)) return route.abort("failed");
        await route.fulfill({ response });
      } catch (cause) {
        if (!stopping) throw cause;
      }
    });
    return {
      info,
      actions,
      control: async (path: string, input?: unknown) => {
        if (!/^[-a-z]+$/.test(path)) throw new Error("INVALID_REWORK_TEST_CONTROL");
        return context.request.fetch(`${info.origin}/__rework-test/${path}`, {
          method: input === undefined ? "GET" : "POST",
          headers: { origin: browserOrigin },
          ...(input === undefined ? {} : { data: input }),
        });
      },
      close,
    };
  } catch (cause) {
    child.kill("SIGTERM");
    await close();
    throw cause;
  }
}
