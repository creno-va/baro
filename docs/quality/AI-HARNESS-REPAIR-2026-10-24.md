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

## Live baseline and response boundaries

[Manual run40067350279](https://github.com/creno-va/baro/actions/runs/40067350279)
on exact mainaf42d0e passed screening in one provider attempt,5091ms,430input/
25output tokens. [Finite original observation](./ai-harness-2026-10-24/screening-af42d0e.json)
retains its actual timestamps and provenance; the workflow artifact retains the
source manifest. It does not establish workspace question/audit/chat/media success.
The provider accepts the existing simple Chat Completions request; blanket model
unavailability is not established. Next probe uses actual workspace questions and
independent audit with synthetic input, preserving the three-total-attempt cap.

Response repair accepts the documented native Gemini envelope as well as the
existing Chat Completions envelope, without changing the selected model. Native
thought parts/signatures are excluded, safety refusal and truncated/function-call
responses cannot become final output, and an explicit Cloudflare success/result
wrapper is decoded. Vision and ASR use the same bounded raw HTTP decoder. Image
observations require a final stop and cannot publish partial JSON after truncation.
Native output metering includes thinking via total minus input; absent cache/tier
observations remain unknown. Invalid usage metadata remains an invalid receipt
instead of invalidating a schema-valid answer or triggering another paid correction.
No production failure cause is inferred from this offline compatibility repair.
