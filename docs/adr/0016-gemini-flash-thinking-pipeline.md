# ADR-0016: Gemini Flash thinking pipeline

- Status: Accepted
- Date: 2026-10-21
- Owners: hyunhomon / AI pipeline maintainer
- Authority: direct user instruction in the current chat
- Issue: https://github.com/creno-va/baro/issues/305
- Partially supersedes: ADR-0004, ADR-0010, ADR-0015 model identity and thinking settings only.

## Decision

All new v1/v2 text generation, independent audit and vision dispatches use `google/gemini-3.8-flash` through the existing Cloudflare AI binding and AI Gateway Unified Billing. Generation/vision use low reasoning, audit/validation medium. Whisper ASR and existing payment/auto-recharge remain unchanged. No fallback provider/model or direct model SDK is introduced.

Questions name a specific unresolved event, role, date, agreement or available record and give a concrete checking instruction/answer format. Contradictions are raised neutrally; unknown/skipped answers are not guessed or repeatedly demanded. The initial two rounds of up to three questions stay bounded. Summary preserves specific gaps and chat asks focused clarifications without falsely claiming complete case understanding. This factual ordering does not authorize legal strategy or expanded product scope.

## Harness and compatibility

Keep strict output schemas, server-side factual/reference/policy/citation checks and a separate audit before publication. Current prompt/wire identity changes invalidate old evaluation receipts. The fixed workspace corpus adds concrete-question, contradictory-payment, absent-record and ambiguous-party scenarios; usability and uncertainty require explicit human review as well as deterministic checks.

Current technical capacity (1,048,576 context; 65,536 output tokens) has its own documentary observation. Preserve the 2026-10-06 GPT account/cost observation and its dates and amounts. Deployment uses the current capability file, never old bounds relabeled as Gemini. New immutable plans bind model identity, historical plans without it remain readable, and mismatched cost evidence stays incomplete. No schema migration or cost gate is introduced.

## Consequences and verification

This is authorization of the implementation direction, not proof of live quality, retention terms, external acceptance or release. Run quick/build, relevant failure/ledger/runtime tests and the fixed offline evaluation. Same-SHA full/preview/production gates and independent external acceptance remain as documented. Do not report synthetic/replayed responses as live Gemini success or promise a latency reduction without measurement.

## Sources

- https://developers.cloudflare.com/ai/models/google/gemini-3.8-flash/
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://ai.google.dev/gemini-api/docs/openai
- https://ai.google.dev/gemini-api/docs/structured-output
