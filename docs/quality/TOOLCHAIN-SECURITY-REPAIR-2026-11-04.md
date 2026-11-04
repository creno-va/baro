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
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | deepmerge | Intermediate4.3.1 mitigation/raw low1 remain historical evidence. Actual Jest-config merge consumers now use official @fastify/deepmerge3.2.4 through explicit private local fork30.5.2-baro.1. Frozen product raw audit0; final CI/full acceptance remains pending. |
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

## Intermediate validation and historical remaining condition

- Initial in-place frozen `bun ci`: 1298 installs/1258 packages, no lock changes. A real UI
  regression exposed stale nested installed copies: app/linking resolved constants58.0.13 while
  the SDK resolved58.0.14. Existing root/mobile node_modules were moved to ignored private backup,
  then clean frozen `bun ci` installed1078 packages. All three consumers now resolve58.0.14;
  both affected suites pass9/9 without modifying the auth error handler or test assertions.
- Patch/upstream attestation passes; security regressions10 PASS/64 assertions.
- Actual CLI/MCP/product-validator/URI/mobile-runtime tests37 PASS/267 assertions.
- Actual coverage/glob consumer compatibility3 PASS/17 assertions.
- Workers build, anonymous local workerd boot and both iOS/Android bundle exports passed. No deploy.
- Windows full quick exposed aggregate selector test deadlines (five tooling timeouts; mobile534,
  native UI108 and rework529/4skip passed). Independent selector configurations now retain their
  original deadlines individually; one selection shares in-flight reads across at most eight roots.
  No source/import assertion or candidate is dropped, and no deadline constant is increased.
  Fresh-import/cycle/shared-consumer regression plus existing selectors:53 PASS/590 assertions.
- Fresh unfiltered `bun audit --json`: deepmerge low1 remains. Local mitigation is not an official
  advisory fix and does not make the raw audit or full security gate pass. #724 remains open for
  an official compatible fix or separately approved technical replacement, with raw evidence preserved.
- Complete quick/build/mobile bundle and exact PR CI results are recorded in the PR before merge.
  No physical native launch, production deployment or paid CI provider call is claimed here.

## Actual Jest consumer replacement

Starting main22be55af (PR736), branch `codex/724-jest-merge-consumer`, continues #724/#723/#620/#621.
Jest30.5.2, Expo58.0.17, RN0.88.0 and product/provider/payment choices are unchanged. This limited
repair replaces two existing merge consumers and preserves test functionality.

Official Jest-config30.5.2 tarball SHA512 and its MIT license were verified. The private local package
is explicitly30.5.2-baro.1: two requires construct the official Fastify merger with symbols enabled,
and the two-object `.all` call becomes a two-argument merge. Declarations, ESM shim and license are
identical upstream bytes. Metadata names replacement3.2.4 and removes upstream-monorepo-only dev
dependencies. No official fixed Jest/deepmerge version is claimed. `vendor/README.md`, the exact
reversible patch and `patches/jest-config-vendor.json` attest all five source files, full installed
copy, replacement registry SRI/tree/license and both actual consumers.

Bun1.4.0's transitive file override alone produced empty records and omitted Jest dependencies. That
incomplete graph was rejected. An explicit root dev dependency anchors the local package; the override
selects it for CLI/core. Recalculation from the old lock retains every other unique package/version:
only deepmerge4.3.1/Jest-config30.5.2 become Fastify3.2.4/the local fork. Nested lock path differences
reflect hoisting, with actual resolution checked separately.

The old deepmerge patch, entire historical manifest and patched package are preserved byte for byte.
The same tests still reverse its patch, reproduce original returned-prototype poisoning and check
CJS/UMD mitigation. It is an explicitly retired fixture, never a product dependency. Immutable
third-party fixture bytes are excluded from formatting and checked by complete digest/patch/license
attestation instead. Raw audit remains unchanged and unfiltered. #339 is untouched.

The native package's previous full digest included installed dependencies. New hoisting adds exactly
five unchanged official ansi-styles5.2.0 files beneath pretty-format. Its original tarball SRI and all
five bytes were independently checked. The old native manifest is archived unchanged; current full
before/after digests include the new files and a real reverse patch proves all three original native
preimages. Native version, patch bytes, license and all source postimages are unchanged. The new
layout, SRI/tree/files and old manifest are additionally attested. No file is ignored by the native
full-tree check and no security/advisory allowlist is introduced.

- Clean pinned frozen `bun ci`:1078 packages installed; old installations preserved in backup.
- Product unfiltered `bun audit --json`: `{}`, exit0. Distinct from isolated probe audit0 and historical
  raw audit16/low1 failures.
- Security/consumer/provenance/retained attack regressions:18 PASS/0 FAIL/103 assertions. Actual Node
  Jest CLI/core, seven normal merge shapes, preset globals, nested poisoning and registry/local legacy
  consumer rejection are included.
- Full quick/build, mobile108/both exports, exact-head CI/review/merge and final main full/same-SHA
  preview remain required. No paid CI call or production deploy.

When compatible official Jest-config replaces this consumer, retire the local fork only after repeating
provenance, exact consumers, native layout and native UI/bundle checks. Retain historical mitigations
and failure evidence.
