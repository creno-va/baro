import { runBrowserTargets } from "./development-checks";

// Include the complete corpus only in explicit final validation.
const targets = [...new Bun.Glob("tests/browser/*.e2e.ts").scanSync(".")].sort();
if (!targets.length) throw new Error("BROWSER_TESTS_MISSING");
await runBrowserTargets(targets);
