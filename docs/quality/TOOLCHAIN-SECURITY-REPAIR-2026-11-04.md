# Toolchain security repair (#724)

Refs #620/#621/#723. #339 CLOSED/NOT_PLANNED and its historical failure evidence remain unchanged.
This repair does not deploy production or change the Expo SDK, React Native, providers, payment,
cost observation policy, installed native application, or product authorization boundaries.

## Fresh observation and dependency paths

Pinned Bun 1.4.0 with the original frozen lock reported 16 advisories (high7/moderate5/low4).
These paths belong to development/build/test tooling: Expo CLI and signing tools consume forge;
Expo/Jest/coverage consume glob and minimatch; Jest config consumes deepmerge; the old Expo CLI
consumed Zod3. Product contracts continue to use Zod4.6.6. No Workers product imports were added.

| Advisory | Package | Treatment |
| --- | --- | --- |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | deepmerge | No official fixed release. Narrow 4.3.1 vendor patch writes own data properties in source/CJS/UMD; baseline prototype poisoning reproduces, patched probes reject it. Raw audit remains low1. |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | glob | Official 14.0.3, fixed from14.0.2. Pre-aborted traversal and actual consumers checked. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | minimatch | Official11.0.4, fixed from11.0.1. Upgrade coverage test-exclude to8 rather than forcing its old callable minimatch API. |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | node-forge | Official1.4.2 is outside advisory vulnerable range <=1.4.0; retained malicious RSA probes checked in CJS and both UMD bundles. |
| [GHSA-8hrf-8g6f-7xwp](https://github.com/advisories/GHSA-8hrf-8g6f-7xwp) | node-forge | Official1.4.2 (fixed1.4.1). |
| [GHSA-hqq3-7jhf-c5jx](https://github.com/advisories/GHSA-hqq3-7jhf-c5jx) | node-forge | Official1.4.2 (fixed1.4.1). |
| [GHSA-5x38-2vff-x55p](https://github.com/advisories/GHSA-5x38-2vff-x55p) | node-forge | Official1.4.2 (fixed1.4.1). |
| [GHSA-4642-5mcj-2rqw](https://github.com/advisories/GHSA-4642-5mcj-2rqw) | node-forge | Official1.4.2 (fixed1.4.1). |
| [GHSA-6wvx-3r32-xmcg](https://github.com/advisories/GHSA-6wvx-3r32-xmcg) | node-forge | Official1.4.2 (fixed1.4.1). |
| [GHSA-525v-9gp9-w22h](https://github.com/advisories/GHSA-525v-9gp9-w22h) | node-forge | Official1.4.2 (fixed1.4.1). |
| [GHSA-7wch-p9px-956x](https://github.com/advisories/GHSA-7wch-p9px-956x) | node-forge | Official1.4.2 (fixed1.4.1). |
| [GHSA-h6cr-wjv9-3cpp](https://github.com/advisories/GHSA-h6cr-wjv9-3cpp) | node-forge | Official1.4.2 (fixed1.4.1). |
| [GHSA-4487-j8r4-4g2f](https://github.com/advisories/GHSA-4487-j8r4-4g2f) | node-forge | Official1.4.2 (fixed1.4.1). |
| [GHSA-5cwg-6vw7-rj6p](https://github.com/advisories/GHSA-5cwg-6vw7-rj6p) | node-forge | Official1.4.2 (fixed1.4.1). |
| [GHSA-jc66-7q78-782g](https://github.com/advisories/GHSA-jc66-7q78-782g) | node-forge | Official1.4.2 (fixed1.4.1). |
| [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | Zod | Official Expo CLI58.1.18 replaces its legacy Zod3 backend with JSON Schema and MCP-host validation. Root Zod4.6.6 retained. Actual CLI schemas/MCP builders checked. |

Each ID links at `https://github.com/advisories/<ID>`. Registry versions, integrity, npm-owned file
trees, license bytes and actual consumer resolution are checked. Historical forge/Zod patches,
manifest and CLI probe remain byte-identical, explicitly archived rather than treated as active.
Existing braces and React Native patches remain active. Registry-owned tree hashing excludes the
installed dependency directory; those dependencies remain covered by the frozen lock, raw audit
and consumer checks. No audit allowlist, filtering, version substitution or dependency removal is used.

Expo config58.0.10 uses the updated dependency tree. Constants58.0.14/font58.0.11 satisfy the new
router-server peers; Expo58.0.17 and RN0.88.0 remain fixed. The private iOS CLI hook checks the new
exact CLI version. Actual coverage include/exclude, sync/async discovery and Babel instrumentation
are regression tested to cover the major glob/minimatch API changes.

## Validation and remaining condition

- Initial in-place frozen `bun ci`: 1298 installs/1258 packages, no lock changes. A real UI
  regression exposed stale nested installed copies: app/linking resolved constants58.0.13 while
  the SDK resolved58.0.14. Existing root/mobile node_modules were moved to ignored private backup,
  then clean frozen `bun ci` installed1078 packages. All three consumers now resolve58.0.14;
  both affected suites pass9/9 without modifying the auth error handler or test assertions.
- Patch/upstream attestation passes; security regressions10 PASS/64 assertions.
- Actual CLI/MCP/product-validator/URI/mobile-runtime tests37 PASS/267 assertions.
- Actual coverage/glob consumer compatibility3 PASS/17 assertions.
- Workers build, anonymous local workerd boot and both iOS/Android bundle exports passed. No deploy.
- Fresh unfiltered `bun audit --json`: deepmerge low1 remains. Local mitigation is not an official
  advisory fix and does not make the raw audit or full security gate pass. #724 remains open for
  an official compatible fix or separately approved technical replacement, with raw evidence preserved.
- Complete quick/build/mobile bundle and exact PR CI results are recorded in the PR before merge.
  No physical native launch, production deployment or paid CI provider call is claimed here.
