# Audited local tooling source

`jest-config/` is a private, explicitly tagged `30.5.2-baro.1` repair of official Jest-config30.5.2.
It keeps the upstream MIT license, declarations, ESM shim and existing Jest API. Three compiled source
lines replace the two merge consumers with official `@fastify/deepmerge`3.2.4; arrays, enumerable
symbols and preset globals retain tested behavior. Prototype/constructor keys are rejected.

The root explicit dev dependency and override keep the complete real CLI/core graph. The exact
`patches/jest-config-30.5.2-baro.1.patch` reconstructs the official tarball. Its provenance manifest
pins SHA512, every original/local file, full local/installed trees, license, replacement and actual
consumers. `bun run security:patches` verifies these and retired deepmerge CJS/UMD attack proofs.
Unfiltered `bun audit` remains mandatory.

The package removes upstream-monorepo dev dependencies and adds a private flag; it is not an official
patched Jest release. Update or retire it only with checks documented in
`docs/quality/TOOLCHAIN-SECURITY-REPAIR-2026-11-04.md`. Native patch source is unchanged; that record
explains the independently verified installed dependency layout and preserved old manifest too.
