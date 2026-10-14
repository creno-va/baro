# Preview file Workflow placement experiment

Reviewed 2026-10-15 KST. Refs #59, #71/P04. Base
`8ebfbafcb2d551c860e51f7728821cf9630bea5b`.

## Motivation and observed baseline

The actual two-page synthetic DOCX completed on preview `8ebfbaf` at
2026-10-14 20:29:12 UTC. Upload to server-ready took about 203.4 seconds;
the Workflow itself took about 173 seconds. The recorded steps were:

| Step | Seconds |
| --- | --- |
| Extract page 1 / 2 | 23.807 / 23.565 |
| Interpret page 1 / 2 | 12.863 / 12.919 |
| Prepare unit 1 / 2 | 12.253 / 16.332 |
| Prepare publication | 24.848 |
| Observation count 1 / 2 | 3.640 / 3.587 |
| Observation page 1 / 2 | 3.183 / 3.226 |
| Result publication 1 / 2 | 10.191 / 10.204 |
| Final publication | 4.466 |

Its first existing D1 query reported SQL duration 1.054ms, serving colo KIX,
region APAC, primary true and attempts 1. The wall-time sample was unavailable.
These are D1 location and SQL execution observations, **not** the Workflow
execution location or proof that geographic distance caused the latency. The
step durations include database, provider, routing and execution overhead; they
are not measurements of model duration alone. Browser and deployment evidence
remain in the [live acceptance record](./PREBETA-MVP-LIVE-ACCEPTANCE.md).

## Minimal experiment

New file Workflow instances created by an exact `environment === "preview"`
dispatcher receive `locationHint: "apac"`. The local binding interface uses the
existing generated `WorkflowInstanceLocationHint` type. The pinned runtime
`WorkflowInstanceCreateOptions` describes a best-effort preference, and the
[official create API](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/create/)
lists APAC among its supported hints. The binding's camelCase option is defined
by the generated runtime type; the REST API uses `location_hint`.

Only the create option changes. The immutable ID and event params, outbox CAS,
owner/consent/source revision/deletion checks, fresh lease/claim read before
create, same-ID ambiguous-response recovery and acknowledgement guard remain.
Existing instances are looked up and reconciled in place. A new retry instance
uses the same current dispatcher path and existing bounded retry policy.

Production, undefined or malformed non-preview environment values, and profile
asset Workflows omit the property entirely. No HTTP Smart Placement, Wrangler
configuration, database move/replication, schema, timeout, retry or technical
limit changes are included. Production approval and release gates remain.

## Validation and interpretation

Local tests inspect actual arguments to the synthetic Workflow binding after
real SQLite admission/dispatch. They check preview-only placement and unchanged
params/identity, production/undefined/false omission, profile asset omission,
one concurrent winner, existing-instance reconciliation, lost-response recovery,
and consent/file-consent/revision/deletion/lease/claim changes before create.
Platform rejection remains pending and only the same durable instance can recover.
These test adapters establish argument and security contracts, not actual
Cloudflare placement or latency improvement.

The five focused suites passed 82 tests/1005 assertions. `bun ci` and the quick
profile's checks passed; a test-only exact-optional-property type error was repaired,
then the failed type check and remaining gates were completed without repeating the
successful checks. The integrated candidate's build and actual preview comparison
remain with the release coordinator.

After deploying this candidate to preview, create a new instance from the same
synthetic DOCX and compare upload-to-ready, Workflow duration, stage timings and
the available D1 sample. Preserve sample count, outcome and measurement gaps.
A best-effort hint may not move execution, and a single faster or slower run is
not proof of a geographic cause. Record the result against the exact SHA; do not
mark latency solved from this configuration change alone. To stop the experiment,
remove the file scope's preview hint in a reviewed change; this does not move or
delete existing instances.
