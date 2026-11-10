import { runBrowserTargets } from "./development-checks";

export const fullBrowserParts = ["screens-1", "screens-2", "journeys"] as const;
const integratedJourney = "tests/browser/rework-conversation.e2e.ts";

/** Whole files stay together, including both engines and their serial fixtures. */
export function fullBrowserTargets(catalog: string[], part?: string): string[] {
  const targets = catalog.map((path) => path.replaceAll("\\", "/")).sort();
  if (!targets.length) throw new Error("BROWSER_TESTS_MISSING");
  if (new Set(targets).size !== targets.length) throw new Error("BROWSER_TESTS_DUPLICATE");
  if (!targets.includes(integratedJourney)) throw new Error("BROWSER_JOURNEYS_MISSING");
  if (part === undefined) return targets;
  if (!fullBrowserParts.some((value) => value === part)) throw new Error("BROWSER_PART_INVALID");
  if (part === "journeys") return [integratedJourney];
  const screens = targets.filter((path) => path !== integratedJourney);
  const selected = screens.filter((_, index) => index % 2 === (part === "screens-1" ? 0 : 1));
  if (!selected.length) throw new Error("BROWSER_PART_EMPTY");
  return selected;
}

if (import.meta.main) {
  // No part means the full local corpus. CI requires every disjoint part.
  const catalog = [...new Bun.Glob("tests/browser/*.e2e.ts").scanSync(".")];
  await runBrowserTargets(fullBrowserTargets(catalog, process.env.BARO_FULL_BROWSER_PART));
}
