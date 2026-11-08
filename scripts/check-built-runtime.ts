/** A dry-run bundles code but does not evaluate its schema/module initializers in workerd. */
export {};

const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
const port = probe.port;
probe.stop(true);
const child = Bun.spawn(
  [
    "bunx",
    "wrangler",
    "dev",
    "--config",
    "dist/server/wrangler.json",
    "--enable-containers=false",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--local",
    "--persist-to",
    ".wrangler/built-runtime-smoke",
    "--var",
    "APP_ENV:production",
    "--var",
    "PUBLIC_BETA_ENABLED:false",
  ],
  { stdout: "ignore", stderr: "ignore" },
);
const exited = child.exited;
let stopped = false;
void exited.then(() => {
  stopped = true;
});
try {
  const deadline = Date.now() + 30_000;
  let started = false;
  while (Date.now() < deadline && !stopped) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/login`, {
        signal: AbortSignal.timeout(1500),
        redirect: "manual",
      });
      if (response.status === 200 && response.headers.get("content-type")?.includes("text/html")) {
        await response.body?.cancel();
        started = true;
        break;
      }
      await response.body?.cancel();
    } catch {
      /* Startup is asynchronous. This never contacts a provider or reads a real session. */
    }
    await Bun.sleep(250);
  }
  if (!started)
    throw new Error(
      "BUILT_WORKER_START_FAILED: generated production worker did not serve anonymous login HTML",
    );
  // The same production guard must render its outage/closed-beta page before
  // SSR. A successful anonymous login cannot prove this independent HTML path.
  const unavailable = await fetch(`http://127.0.0.1:${port}/app`, {
    signal: AbortSignal.timeout(5000),
    redirect: "manual",
  });
  const unavailableBody = await unavailable.text();
  if (
    unavailable.status !== 503 ||
    unavailable.headers.get("retry-after") !== "30" ||
    !unavailable.headers.get("cache-control")?.includes("private, no-store, no-transform") ||
    unavailable.headers.get("x-content-type-options") !== "nosniff" ||
    !unavailable.headers.get("content-security-policy")?.includes("frame-ancestors 'none'") ||
    !unavailableBody.includes("공개 베타를 준비하고 있어요.") ||
    !unavailableBody.includes("<style>") ||
    unavailableBody.includes("<script")
  )
    throw new Error(
      "BUILT_WORKER_UNAVAILABLE_PAGE_FAILED: status, protection or shared HTML missing",
    );
  console.log(
    "Built production worker served anonymous login and protected shared 503 HTML; no deployment or provider calls",
  );
} finally {
  if (!stopped && process.platform === "win32") {
    // bunx launches Node/workerd descendants. Killing only the wrapper leaves
    // the generated client directory locked on Windows after a successful smoke.
    const cleanup = Bun.spawn(["taskkill", "/PID", String(child.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await cleanup.exited) !== 0 && !stopped) child.kill("SIGKILL");
  } else {
    if (!stopped) child.kill("SIGINT");
    await Promise.race([exited, Bun.sleep(5000)]);
    if (!stopped) child.kill("SIGKILL");
  }
  await exited;
}
