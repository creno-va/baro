# Workspace material metadata reads

Reviewed 2026-10-15 KST. Refs #71/P04. Base
`9498ed3f4605464a043144f47f120c02d2587b32`.

The actual seven-ready-file preview workspace was still loading at 13.954 seconds
and had rendered when checked at 55.288 seconds. This is an observed interval,
not an exact load duration. The earlier P37 compact-read failure is a separate
issue. This follow-up addresses unnecessary ready-file coverage requests after
P37's coverage projection made that workspace readable again.

## Consumer and security scope

The full client workspace read hydrates material names and states for chat choices,
message/fact source links, file counts and processing indicators. Chat, timeline,
actions and the facts sidebar do not display `file.coverage` or extracted text.
Source links navigate to the files page. That page already uses the existing
metadata-only list, and its modal reads detailed coverage through `FileReview`
and the separately authorized `/review` endpoint.

Only the full workspace reader now requests `files.list(id, { metadataOnly: true })`.
Its initial and final workspace reads, existing revision recovery, session/role
verification, owner/deletion checks and all summary/history/job reads remain.
Metadata still uses the existing authenticated API and before/after owner, file,
decrypt and current-state checks. The generic coverage string does not claim that
the original or coverage snapshot was verified by this list read. Selected-file
admission, worker source reads, fresh execution fences and mutation CAS are unchanged.

All four ReportReview list callers keep coverage hydration because the material
selection details display it without another request when opened. Their strict
id/revision/ready/probe/coverage checks remain. FileReview retains its separate
bounded coverage/observation read and current owner/revision checks. No concurrency,
cache, retry, timeout, server authorization or schema change is introduced.

## Local before and after

`tests/workspace-metadata-list.test.ts` uses the actual client, Hono, AES and SQLite
with seven ready synthetic text files. Provider and R2 remain offline adapters.
Each removed coverage HTTP request previously performed ten D1 calls: its existing
request authentication plus the seven-call coverage projection. These totals include
the API request authentication but exclude the UI's outer session-verification calls.

| Existing flow | Before HTTP / D1 calls / SQL | After HTTP / D1 calls / SQL |
| --- | --- | --- |
| Cold workspace read | 16 / 138 / 139 | 9 / 68 / 69 |
| Warm workspace read | 11 / 93 / 93 | 4 / 23 / 23 |
| Timeline POST and full readback | 17 / 148 / 156 | 10 / 78 / 86 |
| Report material list | 8 / 77 / 77 | 8 / 77 / 77 |

The old full workspace path made seven coverage requests serially. This change
removes those seven requests and seventy D1 calls; it does not predict a remote
wall-time improvement. Cold/warm results retain all seven material identities,
names and ready states, and the real timeline mutation returns its saved content.
Report list coverage and the separate file review remain available.

A late file tombstone with a workspace revision change discards the old metadata
and uses the existing recovery path to return six current files. Late role change,
session expiry, owner change and workspace/account deletion reject the full read
at the existing final boundary. The previous file-coverage corruption/ownership,
default compact bounds and report source tests remain applicable.

The next exact-SHA preview must remeasure full workspace navigation and mutation
readback separately. Record the observed timing boundaries, render outcome and
source-link/file-review behavior in the [live acceptance record](./PREBETA-MVP-LIVE-ACCEPTANCE.md).
The actual preview latency improvement is not established by these local counts.

Local validation passed: 152 focused/regression tests with 2,347 assertions across
seven files, `bun ci`, `validate:quick` and `validate:build`. Independent source
review found no blocker. No remote browser, provider or deployment result is
claimed by these checks.
