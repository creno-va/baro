import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { legalReadinessScope } from "./legal-readiness-v2";

/** Real official-server requests from local workerd; never deployed-Worker release evidence. */
export async function inspectLegalWorkerd(credential: string, scope = "standard") {
  if (!credential) throw new Error("LEGAL_DIAGNOSTIC_CONFIGURATION");
  legalReadinessScope(scope);
  const build = await Bun.build({
    entrypoints: ["scripts/helpers/legal-readiness-live-worker.ts"],
    target: "browser",
    format: "esm",
  });
  const output = build.outputs[0];
  if (!build.success || !output) throw new Error("LEGAL_DIAGNOSTIC_BUILD");
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: await output.text(),
      compatibilityDate: "2026-10-01",
      bindings: { LAW_API_OC: credential, READINESS_LEGAL_SCOPE: scope },
      cf: false,
      unsafeRegisterWorker: false,
    }),
  );
  try {
    const response = await fetch(await mf.ready, { signal: AbortSignal.timeout(130000) });
    return (await response.json()) as Record<string, unknown>;
  } finally {
    await mf.dispose();
  }
}

// Explicit, manual diagnostic only; no credential loading, provider calls or schedules on import.
if (import.meta.main) {
  try {
    const receipt = await inspectLegalWorkerd(
      process.env.LAW_API_OC ?? "",
      process.env.READINESS_LEGAL_SCOPE ?? "standard",
    );
    await Bun.write(
      ".wrangler/readiness/legal-workerd.json",
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
    console.log(JSON.stringify(receipt));
    if (receipt.status !== "diagnostic_passed") process.exitCode = 1;
  } catch {
    // Network Request errors can contain credential query URLs. Never print exceptions.
    console.log(JSON.stringify({ status: "diagnostic_failed", runtimeLocation: "local-workerd" }));
    process.exitCode = 1;
  }
}
