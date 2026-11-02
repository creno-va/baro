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
    const observations: Record<string, string | number | undefined>[] = [];
    let requestSequence = 0;
    const pdfResponses: { path: string; bytes: Buffer }[] = [];
    await context.route("**/api/**", async (route) => {
      if (stopping) return route.abort("aborted").catch(() => undefined);
      try {
        const request = route.request(),
          url = new URL(request.url()),
          requestOrder = ++requestSequence;
        if (!url.pathname.startsWith("/api/")) return route.continue();
        if (
          request.method() === "PUT" &&
          /^\/api\/v2\/cases\/[^/]+\/files\/[^/]+\/parts\/\d+$/.test(url.pathname) &&
          request.postDataBuffer() === null
        )
          // WebKit hides Blob bytes from Playwright. The fixture dev server
          // forwards the original same-origin HTTP stream without reading or
          // recreating its body. All actual API authorization/hash checks run.
          return route.continue({
            headers: { ...request.headers(), "x-baro-rework-upstream": info.origin },
          });
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
        if (
          request.method() === "GET" &&
          /^\/api\/v2\/reports\/[^/]+\/pdf$/.test(url.pathname) &&
          response.status() === 200
        )
          pdfResponses.push({ path: url.pathname, bytes: await response.body() });
        const kind = url.pathname.endsWith("/workspace")
          ? "workspace"
          : url.pathname.endsWith("/summary")
            ? "summary"
            : url.pathname.endsWith("/messages")
              ? "messages"
              : /\/files(?:\/[^/]+\/complete)?$/.test(url.pathname)
                ? "file-admission"
                : /\/files\/[^/]+\/review$/.test(url.pathname)
                  ? "file-review"
                  : url.pathname.split("/rework/")[1];
        if (
          kind &&
          [
            "workspace",
            "summary",
            "conversation",
            "summary-reconciliation",
            "summary-reconciliation/request",
            "summary-reconciliation/cancel",
            "summary-reconciliation/confirm",
            "messages",
            "file-admission",
            "file-review",
          ].includes(kind)
        ) {
          const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
          let input: Record<string, unknown> | null = null;
          try {
            input = request.postDataJSON() as Record<string, unknown> | null;
          } catch {}
          const number = (value: unknown) =>
            typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
          const object = (value: unknown): Record<string, unknown> | undefined =>
            value && typeof value === "object" && !Array.isArray(value)
              ? (value as Record<string, unknown>)
              : undefined;
          const state = (value: unknown) =>
            typeof value === "string" &&
            [
              "not_started",
              "idle",
              "uploaded",
              "queued",
              "processing",
              "pending",
              "running",
              "ready",
              "failed",
              "stale",
              "unavailable",
              "cancelled",
            ].includes(value)
              ? value
              : undefined;
          const files = Array.isArray(body) ? body : Array.isArray(body?.files) ? body.files : [];
          observations.push({
            kind,
            requestOrder,
            method: request.method(),
            status: response.status(),
            requestBytes: request.postDataBuffer()?.byteLength,
            selectedFileCount:
              kind === "messages" && Array.isArray(input?.selectedFileIds)
                ? input.selectedFileIds.length
                : undefined,
            errorCode:
              body?.error &&
              typeof body.error === "object" &&
              "code" in body.error &&
              typeof body.error.code === "string" &&
              /^(CONFLICT|VALIDATION_ERROR|STALE_REVISION|UNAVAILABLE|USER_QUOTA_EXCEEDED|CONSENT_REQUIRED|NOT_FOUND|INVALID_STATE|RATE_LIMITED|ROLE_REQUIRED|POLICY_REJECTED)$/.test(
                body.error.code,
              )
                ? body.error.code
                : undefined,
            expectedW: number(input?.expectedRevision),
            expectedS: number(input?.summaryRevision),
            W: number(body?.workspaceRevision) ?? number(object(body?.case)?.revision),
            fileState:
              state(object(body?.file)?.status) ??
              (kind === "file-admission" ? state(body?.status) : undefined),
            reviewedFileRevision: number(object(body?.file)?.revision),
            analysisState: state(object(body?.analysis)?.status),
            reportState: state(object(body?.report)?.status),
            ...(files.length
              ? {
                  readyFiles: files.filter((file: unknown) => object(file)?.status === "ready")
                    .length,
                  processingFiles: files.filter((file: unknown) =>
                    ["queued", "uploaded", "processing"].includes(String(object(file)?.status)),
                  ).length,
                  failedFiles: files.filter((file: unknown) => object(file)?.status === "failed")
                    .length,
                }
              : {}),
            S: kind === "file-admission" ? undefined : number(body?.revision),
            fileRevision: kind === "file-admission" ? number(body?.revision) : undefined,
            confirmedW: number(body?.confirmedWorkspaceRevision),
            confirmedS: number(body?.confirmedSummaryRevision),
            state:
              typeof body?.status === "string" &&
              [
                "idle",
                "pending",
                "running",
                "proposed",
                "confirmed",
                "stale",
                "failed",
                "cancelled",
              ].includes(body.status)
                ? body.status
                : undefined,
          });
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
      observations,
      pdfResponses,
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
