# Structured Worker adapter

Pinned model: openai/gpt-6-sol, Chat Completions, reasoning_effort=medium.
Prompt/policy versions live in prompts.ts; every response is an output envelope validated against the existing strict shared schemas. JSON Schema represents input shape; semantic refinements run in Zod again.

Official support checked 2026-10-05:
- https://developers.cloudflare.com/ai/models/openai/gpt-6-sol/ (Chat Completions, response_format, reasoning_effort)
- https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/ (binding, collectLog, skipCache)
- https://developers.openai.com/api/docs/models/gpt-6-sol (medium reasoning)
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create (strict json_schema, store=false)

Calls use an attempt callback before every external attempt. Technical invocation/retry guards remain required; cost observation failures must not turn into execution denial under the [current policy](../../../../docs/operations/PREBETA-COST-POLICY.md). #13 must persist reservations and checkpoints; this adapter never resets a durable budget. Network/429/5xx and schema correction share at most three calls; schema correction happens once. Binding timeout is ambiguous and ends the phase without overlapping an immediate retry. Exactly-once billing is not promised.

No provider keys or fallback model are accepted. Runtime code has no test-fixture imports. Missing configuration or an actual provider credit/spend refusal fails closed; this is distinct from the cost metadata gates disabled by `APPLICATION_COST_LIMITS_ENABLED=false`. Stale pricing/funding, monthly allocations, refresh and cost-derived model bounds expiry must not masquerade as missing runtime capability. Only fixed metadata fields reach the observer. Actual Gateway credits, logging, existing provider settings and approved live synthetic response smoke remain #27; no costs are incurred by offline tests.

File image/frame composition uses the pinned model's documented image-input support and the deployment-owned model context/output configuration. The server permits exactly one bounded JPEG with the shared `low` detail wire, medium reasoning and a 4,000-token output cap. It reserves the entire remaining model context as a conservative technical maximum; this is not measured usage or a price observation. The exact model/action/wire digest and existing job/lease/consent/quota controls still govern dispatch.

Documented support is a server-only identity with no fabricated live-account observation or expiry. Existing separately supplied expiring capability callbacks still expire normally. Observation-only mode preserves the original model configuration provenance and ignores its historical cost refresh expiry, while rejecting missing, future or incompatible technical limits. Account/model acceptance and image contents remain an explicit live-preview verification; provider failures keep missing/partial coverage and unknown transport exposure without automatic retries. Cloudflare-hosted Whisper uses its existing separate bounded PCM-duration path.
