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
  startUrl?: string;
  reconciliationExplanation?: string;
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
  const pending = new Set<Promise<Response>>();
  const dispatch = async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === "/__rework-test/requests") return Response.json(requests);
    if (path.startsWith("/__rework-test/"))
      return (await composition.control?.(request)) ?? new Response(null, { status: 404 });
    if (!path.startsWith("/api/")) return new Response(null, { status: 404 });
    const response = await composition.fetch(request);
    requests.push({ method: request.method, path, status: response.status });
    return response;
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const task = dispatch(request);
      pending.add(task);
      void task.finally(() => pending.delete(task)).catch(() => undefined);
      return task;
    },
  });
  let closing: Promise<void> | null = null;
  return {
    info: { ...composition.info, origin: server.url.origin },
    async close() {
      closing ??= (async () => {
        server.stop(true);
        // Let the actual native renderer finish its own bounded cleanup before
        // closing the DB. No result, receipt or physical stop is fabricated.
        await Promise.allSettled([...pending]);
        await composition.close();
      })();
      await closing;
    },
  };
}

// Central runtime/processor/PDF predecessors and fixture672 passed exact CI/main.
if (import.meta.main) {
  const browserOrigin = Bun.argv[2] ?? "";
  const purpose = Bun.argv[3];
  if (
    Bun.env.BARO_SYNTHETIC_REWORK_SERVER !== "true" ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(browserOrigin) ||
    !["prepare_claim", "respond_to_claim"].includes(purpose ?? "")
  )
    throw new Error("EXPLICIT_LOOPBACK_REWORK_COMPOSITION_REQUIRED");
  // Only the one bootstrap JSON belongs on stdout; diagnostics stay in the
  // drained stderr channel and never enter browser artifacts.
  console.log = (...values: unknown[]) => console.error(...values);
  const { createReworkRuntimeFixture } = await import("./rework-runtime-fixture");
  const fixture = await createReworkRuntimeFixture({
    browserOrigin,
    purpose: purpose as "prepare_claim" | "respond_to_claim",
  });
  const server = startReworkBrowserServer(fixture);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void server.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  try {
    await Bun.write(Bun.stdout, `${JSON.stringify(server.info)}\n`);
    await Bun.stdin.text();
  } finally {
    await server.close();
  }
}
