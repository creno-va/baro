# Native test host descriptor ownership — 2026-10-17

Refs #71. This is offline tooling validation on macOS arm64, based on
`53e5fb11a102bccac9f0a94eb0aecfe1874fec1b`. It is not a successful full CI,
external-provider, preview acceptance, or production deployment receipt.

## Observed failure and mechanism

[Full run 39016785430](https://github.com/creno-va/baro/actions/runs/39016785430)
on that exact SHA ended with 3,034 passing and two failing unit tests. The native
indexed directory fixture hit its unchanged 120-second deadline; the AI runtime
fixture with cost limits enabled hit its unchanged 30-second deadline. Both
workerd children reported a broken control pipe approximately 146 milliseconds
after startup. The AI 25-second diagnostic still showed `bootstrap/get_d1`,
before `mf.ready` returned, with no schema or provider work. Its timer delay was
3 milliseconds. The later disposed error occurred during timeout cleanup.

Pinned Miniflare 5.20261001.0-alpha starts workerd with an extra stdio control
pipe (`--control-fd=3`). Bun 1.3.14 gives the JS `net.Socket` and native
`Subprocess` ownership of the same parent descriptor. After the socket closes
it, a later garbage collection can close a descriptor reused by another owner.
This is a confirmed local bug and matches the CI startup symptom; the CI log
does not itself capture a GC stack or prove the exact descriptor reuse event.
It is separate from the earlier synchronous D1 proxy overhead investigation.

The official fix for this `node:child_process` handoff is
[Bun #32520](https://github.com/oven-sh/bun/pull/32520)
(`de73fda94f5607ebd8a4cf4ea3a361733cfb470e`, merged June 20).
[Stable Bun 1.4.0](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.0),
released August 20, is the first stable release after 1.3.14 and contains that
commit. GitHub's compare API confirmed it as an ancestor of release commit
`34cbb9a40b4bd1bd767d134a7065e66c2432a676`.
The [tagged child-process implementation](https://github.com/oven-sh/bun/blob/34cbb9a40b4bd1bd767d134a7065e66c2432a676/src/js/node/child_process.ts#L1359-L1373)
uses `socket-fd` / `UnownedFd` for the POSIX handoff. Windows uses libuv handles
and does not take this raw descriptor path. This evidence covers the
`node:child_process` socket handoff used by Miniflare, not every raw descriptor
API; the direct `Bun.spawn().stdio` getter has a separate history described in
[Bun #33828](https://github.com/oven-sh/bun/pull/33828).

## Reproduction and change

The isolated regression closes an extra child pipe, opens an unrelated file,
drops the old child/socket references, forces GC, and checks the new descriptor.
It exercises the OS ownership failure without D1, network, or provider calls.

| Host | Iterations | Unexpectedly closed descriptors |
| --- | ---: | ---: |
| Bun 1.3.14 | 12 | 12 |
| Bun 1.4.0 | 12 | 0 |
| Node 24.19.0, same standalone probe with `--expose-gc` | 12 | 0 |

The committed regression fails under 1.3.14 in 46.79 ms and passes under 1.4.0
in 51.85 ms. It runs in a child process so a regressed runtime cannot damage
the test runner's descriptors. The child has a two-second termination bound,
and its exit and both output streams are joined. This does not raise an
existing test deadline or add retries. The regression explicitly skips Windows
because it tests the POSIX-only raw descriptor handoff.

`.bun-version` and `packageManager` now pin 1.4.0. Bun remains a tooling/test
host; application execution remains Workers. Dependencies, lockfile, schema,
production code, native fixture assertions, and 30/120-second deadlines are
unchanged. No Node-host facade or new production dependency was introduced.

Official download verification:

- `bun-darwin-aarch64.zip` SHA-256:
  `c669e97f6164e1c96e0701748db98dfa77492908cbd8394c7557134a735de381`.
  The downloaded archive matches both the release asset digest and official
  `SHASUMS256.txt`; the executable reports `1.4.0 (34cbb9a40)`.
- The existing pinned setup-bun action accepts exact semantic versions and
  resolves 1.4.0 to `bun-v1.4.0`. Official Linux x64 and x64-baseline assets are
  present. All 12 setup-bun workflow steps already read `.bun-version`.
- A quick-gate regression checks the actual executing `Bun.version`, the
  package-manager pin, and every workflow's version-file configuration, with
  no overriding version or custom download URL.
- `bun ci` reports no dependency changes. `bun.lock` SHA-256 before and after:
  `3962a9522409a00109e9cab82aeef424db9b30395f1a7da64e7e47aa1c911dd6`.

## Validation and remaining boundary

- The failing native directory/AI fixtures plus descriptor ownership,
  lifetime, and native transport: **9 tests, 670 assertions, no failures**.
  Actual local workerd durations were directory **1.278 s**, AI cost limits
  enabled **0.767 s**, and disabled **0.659 s**. These are local measurements,
  not a same-machine performance comparison against the failed Linux CI run.
- Every remaining Miniflare fixture plus native progress/measurement/error
  diagnostics: **157 tests, 2,027 assertions, no failures**. Real workerd/D1
  execution, schema/constraint checks, transactional rollback, storage and
  report final fences remain exercised. AI provider adapters are synthetic.
- `validate:quick`: **19 tests, 311 assertions**, lint/type checks passed.
- `validate:build`: production-mode build, bundle checks, and Workers dry-run
  passed; no deployment was performed.

An exact final main SHA still requires the manual Linux `validate:full`
workflow and its successful receipt. That is the confirmation that the whole
CI process no longer reaches the startup failure. No unchanged full run was
repeated during this investigation. Docker native-file tests and real external
services were not run here, and this tooling fix does not claim to resolve
the separate live legal-chat audit rejection.
