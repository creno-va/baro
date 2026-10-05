# Offline eval harness v1

All 50 inputs are authored synthetic data: 20 sufficient loans, 15 clarification cases,
5 out-of-scope cases, 5 urgent cases, and 5 attacks. No real person, credential, production
event, inference call, or scraped law is included. The reused citation_1 is explicitly
synthetic contract data, not verified law or permission to publish a legal claim.

Run `bun test tests/offline-harness.test.ts tests/harness-d1.test.ts`. The normal `bun test`
CI also runs these tests. After #10 integration, `bun run test:ui` additionally runs the
signed-session consent browser flow.

Each fixture versions its scope, required question topics, forbidden facts, citation ID
allowlist, required/forbidden categories, and all critical assertions. checksums.json
uses SHA-256 of JSON.stringify(parsed JSON), preserving property order while ignoring
whitespace/CRLF. Changes to fixtures require review and intentional checksum/version
updates; tests never automatically rewrite the manifest.

`evaluateFixture` accepts a strict observation; `reportFixture` emits only fixtureId,
fixtureVersion and finding codes. Its oracle is an explicit expected observation used
to test the harness. Passing these 50 oracle observations is **not** a model evaluation,
a completed product pipeline, semantic safety certification, or the #18 zero-critical
release gate. #18 must connect real pipeline outputs, reviewed question-topic/category
classification and policy/fact findings. The harness checks explicit forbidden literal
facts and shared-schema attribution, not unrestricted natural-language entailment.

Adapters in tests/adapters are per-test queues. They never call fetch, sleep, retry or
retain input; callers own retry budgets and validation. Raw malformed output, network,
429, 5xx, timeout, schema failure and exhausted scripts are deterministic. The Turnstile
double validates exact action/hostname and expiry/reuse with an injected clock.

tests/helpers/d1.ts executes every real migration on isolated SQLite with foreign keys
enabled. Its batch is atomic and returns ordered results; bindings belong to one
database. This is not a workerd emulator. CI continues to verify real local D1 migrations.
seedTestSession creates a synthetic owner and real SQL session, signs the normal Better
Auth cookie, and optionally seeds current consent. No provider login or recent OAuth
authentication is implied. The Playwright-only loopback server exercises the actual
Hono/session/consent API and exposes no seed endpoint; production imports neither helper
nor fixture, and no environment switch bypasses product authentication.
