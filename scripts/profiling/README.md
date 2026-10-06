# Local client profiling tools

These Node/Playwright tools exercise BARO's actual product pages. Never import them into product code. Outputs are synthetic client measurements, not OAuth/backend/AI or public-release evidence. The measured source for the accompanying report is `9ae91932c99f54a1618c3697cf160ad1607007d9`.

Use an isolated checkout of that source and copy this tool directory into it. The runner records `git rev-parse HEAD`; do not mix source SHAs when summarizing. Keep the original integration SHA and a source-equivalent candidate artifact fixed throughout a comparison. Node (not Bun) launches Playwright reliably on this Windows setup.

## Build and serve

PowerShell, Node 24, Bun 1.3.14 and installed Playwright Chromium:

```powershell
bun ci
bunx playwright install chromium
$env:APP_ENV = "local"
$env:BARO_UI_TEST_FIXTURE = "true"
$env:PUBLIC_API_MODE = "mock"
bun run build
node scripts/profiling/prepare-formatter-candidate.mjs
$env:PUBLIC_API_MODE = "real"
bun run build -- --outDir .wrangler/profile-real-build
```

In three local terminals (the config is the generated artifact's Workers config):

```powershell
bunx wrangler dev --config dist/server/wrangler.json --port 4351 --local --no-containers --log-level error
bunx wrangler dev --config .wrangler/profile-real-build/server/wrangler.json --port 4352 --local --no-containers --log-level error
bunx wrangler dev --config .wrangler/profile-formatter-build/server/wrangler.json --port 4353 --local --no-containers --log-level error
```

This uses the existing isolated UI fixture build/config. Do not expose these local fixtures as production success. Stop your own workers after profiling.

## Repeat series

Set each series explicitly; remove previous PROFILE_ONLY, PROFILE_WIRE, PROFILE_NETWORK, PROFILE_API_DELAY and PROFILE_CANDIDATE variables first when switching. PROFILE_CPU defaults to 4; contexts and HTTP cache are cold each repetition. PROFILE_CANDIDATE's runtime shim is diagnostic only; the published candidate comparison used the isolated built artifact without that shim.

```powershell
$env:PROFILE_URL = "http://127.0.0.1:4351"
$env:PROFILE_OUTPUT = "test-results/final-mock"
$env:PROFILE_REPEATS = "5"
node scripts/profiling/client-profile.mjs

$env:PROFILE_URL = "http://127.0.0.1:4352"
$env:PROFILE_WIRE = "true"
$env:PROFILE_ONLY = "login,cases-20,workspace-20,reports,lawyer,lawyers-20,cases-1000,lawyers-1000"
$env:PROFILE_OUTPUT = "test-results/final-real"
node scripts/profiling/client-profile.mjs
$env:PROFILE_ONLY = "workspace-1000"
$env:PROFILE_OUTPUT = "test-results/final-real-long"
node scripts/profiling/client-profile.mjs

Remove-Item Env:PROFILE_WIRE
$env:PROFILE_URL = "http://127.0.0.1:4353"
$env:PROFILE_ONLY = "workspace-20,workspace-1000"
$env:PROFILE_OUTPUT = "test-results/final-candidate"
node scripts/profiling/client-profile.mjs

$env:PROFILE_URL = "http://127.0.0.1:4351"
$env:PROFILE_ONLY = "login,cases-20,workspace-20,reports,lawyer,lawyers-20"
$env:PROFILE_NETWORK = "slow"
$env:PROFILE_REPEATS = "3"
$env:PROFILE_OUTPUT = "test-results/final-slow"
node scripts/profiling/client-profile.mjs

Remove-Item Env:PROFILE_NETWORK
$env:PROFILE_URL = "http://127.0.0.1:4352"
$env:PROFILE_WIRE = "true"
$env:PROFILE_ONLY = "cases-20,cases-1000"
$env:PROFILE_API_DELAY = "150"
$env:PROFILE_OUTPUT = "test-results/final-delayed"
node scripts/profiling/client-profile.mjs

Remove-Item Env:PROFILE_WIRE
Remove-Item Env:PROFILE_API_DELAY
$env:PROFILE_DATE_PROBE = "off"
$env:PROFILE_REPEATS = "5"
$env:PROFILE_ONLY = "workspace-1000"
$env:PROFILE_URL = "http://127.0.0.1:4351"
$env:PROFILE_OUTPUT = "test-results/control-baseline"
node scripts/profiling/client-profile.mjs
$env:PROFILE_URL = "http://127.0.0.1:4353"
$env:PROFILE_OUTPUT = "test-results/control-candidate"
node scripts/profiling/client-profile.mjs

node scripts/profiling/media-profile.mjs
node scripts/profiling/verify-candidate.mjs
node scripts/profiling/refresh-probe.mjs
node scripts/profiling/summarize.mjs
```

Media/verification/refresh scripts use their fixed local ports independently of PROFILE_URL. Refresh probe dispatches paired synthetic focus/visibility events; it measures overlap, not its natural-user frequency. Summarizer writes `docs/quality/client-performance-2026-10-06/results.json`, including per-run values, chunks and raw-file digests. Preserve ignored raw JSON under `test-results`; do not commit real case data or credentials. Missing series are skipped, so check repeat counts before calling a rerun complete.

## Candidate ownership

`prepare-formatter-candidate.mjs` copies built assets, excludes live `.wrangler` state, requires exactly one formatter expression and writes a source diff plus before/after hashes. It never changes `src`. The source diff reuses an Intl formatter and preserves invalid-date behavior, message rows, saving and owner guards. Built substitution is an experiment, not a source build validation.

After A/C coordination, the Workspace owner can review `candidates/shared-chat-formatter.patch` with `git apply --check`, apply it in their own change, build from source and repeat the comparison/save/permission checks. Rebase/remeasure if the source expression changed. This profiling PR does not apply it to product source. See the report for conditions, measurement boundaries, existing baseline check failure and interpretation limits.

The date-probe-off control retains the original baseline/candidate builds and records tool checkout SHA separately. Do not reuse a different source build under the fixed baseline label. Run timing comparisons while host load is steady; do not run the full test suite concurrently.
