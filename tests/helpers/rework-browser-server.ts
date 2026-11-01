/** Loopback-only transport around the central real Hono/D1 composition.
 * No case, legal analysis, report or resolution behavior is implemented here. */
export type ReworkBrowserCookie = {
  name: string;
  value: string;
  url: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax";
};
export type ReworkBrowserInfo = {
  origin: string;
  caseId: string;
  purpose: "prepare_claim" | "respond_to_claim";
  ownerCookie: ReworkBrowserCookie;
  foreignCookie: ReworkBrowserCookie;
};
export type ReworkBrowserComposition = {
  browserOrigin: string;
  info: Omit<ReworkBrowserInfo, "origin">;
  /** Production API factories with only synthetic external provider ports. */
  fetch: (request: Request) => Response | Promise<Response>;
  /** Central fixture state/fault controls, never exposed by the product router. */
  control?: (request: Request) => Response | null | Promise<Response | null>;
  close: () => void | Promise<void>;
};

export function startReworkBrowserServer(composition: ReworkBrowserComposition) {
  if (Bun.env.BARO_SYNTHETIC_REWORK_SERVER !== "true")
    throw new Error("EXPLICIT_SYNTHETIC_REWORK_COMPOSITION_REQUIRED");
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(composition.browserOrigin))
    throw new Error("REWORK_BROWSER_LOOPBACK_ONLY");
  const requests: { method: string; path: string; status: number }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/__rework-test/requests") return Response.json(requests);
      if (path.startsWith("/__rework-test/"))
        return (await composition.control?.(request)) ?? new Response(null, { status: 404 });
      if (!path.startsWith("/api/")) return new Response(null, { status: 404 });
      const response = await composition.fetch(request);
      requests.push({ method: request.method, path, status: response.status });
      return response;
    },
  });
  let closed = false;
  return {
    info: { ...composition.info, origin: server.url.origin },
    async close() {
      if (closed) return;
      closed = true;
      server.stop(true);
      await composition.close();
    },
  };
}

// The executable composition is added only after the central runtime factory's
// exact CI/main gate. An uncomposed entry must fail, never return example success.
if (import.meta.main) throw new Error("REWORK_CENTRAL_RUNTIME_NOT_YET_COMPOSED");
