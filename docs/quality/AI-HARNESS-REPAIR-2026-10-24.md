# AI harness repair — 2026-10-24

Scope: [#458](https://github.com/creno-va/baro/issues/458), separate
`codex/458-gemini-harness-repair` worktree. RN/authentication remain owned by the
mobile chat. Predecessors PR309 and PR306 are merged with successful Quality gates.

## Initial observations

- Frozen Bun1.4.0 installation and live work graph succeeded on base062bdcdf.
- Existing Gateway, HTTP transport, media and workspace pipeline tests:117 passed.
  These are synthetic adapters, not live Gemini acceptance.
- Public AI configuration endpoints reported ready for production57121d2 and
  previewf912441. Their readiness does not execute a model request.
- Local isolated probe could not deploy because this shell has no Cloudflare
  authentication. No model attempt was dispatched and no token was extracted from
  the existing browser login.
- The user confirmed that HomeTax, TheCheat, registry and DataHub credentials have
  not been issued. DataHub means <https://dataapi.co.kr/>. These services must not
  claim successful lookup using simulated responses.
- Workspace context currently reads at most the first8 material observations;
  later pages, video frames and transcript intervals need a bounded retrieval path.

## Manual live observation

`ai-synthetic-readiness.yml` uses the existing preview Environment credential and
requires the exact current main SHA, successful CI and explicit
`single-synthetic-probe` input. It is separate from automatic CI and full validation:
neither invokes paid models. This manually requested external acceptance runs the
isolated Worker with no application DB, R2, OAuth credentials or user cases.

The existing durable single-run/candidate limit (three total attempts), authenticated
request, source manifest, replay denial, logging/cache settings and synthetic prompt
are preserved. Reports add only finite provider category/HTTP status. They do not
contain provider messages, prompt text or model output. A failed/ambiguous run cannot
be reset by changing its source hash. It is not full feature or release evidence.

No cost metadata refresh or new provider/key is introduced. Actual provider
rejection and technical/security guards remain enforced.
