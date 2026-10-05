# Structured Worker adapter

Pinned model: openai/gpt-6-sol, Chat Completions, reasoning_effort=medium.
Prompt/policy versions live in prompts.ts; every response is an output envelope validated against the existing strict shared schemas. JSON Schema represents input shape; semantic refinements run in Zod again.

Official support checked 2026-10-05:
- https://developers.cloudflare.com/ai/models/openai/gpt-6-sol/ (Chat Completions, response_format, reasoning_effort)
- https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/ (binding, collectLog, skipCache)
- https://developers.openai.com/api/docs/models/gpt-6-sol (medium reasoning)
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create (strict json_schema, store=false)

Calls require a reservation callback before every external attempt. #13 must persist reservations and checkpoints; this adapter never resets a durable budget. Network/429/5xx and schema correction share at most three calls; schema correction happens once. Binding timeout is ambiguous and ends the phase without overlapping an immediate retry. Exactly-once billing is not promised.

No provider keys or fallback model are accepted. Runtime code has no test-fixture imports. Missing configuration/credit/spend refusal fails closed. Only fixed metadata fields reach the observer. Actual Gateway credits, logging, spend limits and approved live synthetic response smoke remain #27; no costs are incurred by offline tests.
