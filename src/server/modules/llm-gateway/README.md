# LLM Gateway

Pinned model: `google/gemini-3.8-flash`, Cloudflare AI binding / AI Gateway Unified Billing, Chat Completions.
All retained/v2 text generation uses native LOW GenerateContent; independent workspace audit and v1 validation use native GenerateContent `generationConfig.thinkingConfig` with `thinkingLevel=MEDIUM` and `includeThoughts=false`. Wire uses native contents/systemInstruction and responseMimeType/responseJsonSchema, without OpenAI compatibility controls. Chat/retained structure reuse schema definitions where this reduces their actual size. Exact wire receipts hash the same native bytes sent to the binding. Thinking remains internal. No fallback model, provider key, external search tool or unvalidated token streaming is enabled.

Official support checked 2026-10-21:
- https://developers.cloudflare.com/ai/models/google/gemini-3.8-flash/
- https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://ai.google.dev/gemini-api/docs/openai
- https://ai.google.dev/gemini-api/docs/structured-output

The existing Chat Completions envelope and server-side Zod validation remain. Schema conformance is not evidence of factual correctness; exact user excerpts, authorized references, source spans and independent audit still govern publication. Gateway payload logging and response caching remain disabled. OpenAI-specific `store=false` is not sent to Gemini and is not claimed as a Google retention guarantee. Provider privacy/retention validation is separate from logging and code merge.

Prompt v1.3.0 / workspace v2.7.0 uses everyday Korean, natural answers and approximate dates without demanding a machine date format. New choice answers exclude the UI's built-in unknown/skip actions; server normalization runs before independent audit without changing saved questions. Initial follow-up remains two rounds of up to three questions. Questions/summary use their own focused MEDIUM audit instructions while retaining the complete source context, exact-excerpt checks, contradictions and acceptance predicates. Chat/invalid audit discriminators retain the full chat audit. Evaluation identities include both intake audit wires. Remaining gaps survive summary review and can be clarified in chat. Instructions are factual preparation, never legal strategy.

Every external attempt uses the durable attempt ledger and technical guards. At most three combined transient/schema attempts per call, one schema correction, and no overlapping immediate retry after an ambiguous timeout. v2 calls retain their 120-second timeout and renewed five-minute lease. Costs are observations under [current policy](../../../../docs/operations/PREBETA-COST-POLICY.md); missing/stale cost metadata does not deny execution.

Current model capacity comes from [documentary capability](../../../../docs/operations/GEMINI-MODEL-CAPABILITY.json), not the historical GPT account observation. The configuration records its model identity; previous bounds cannot be relabeled as Gemini support. Existing GPT observations, immutable plans, holds and records remain readable. New plans bind the model, and mismatched historical prices stay incomplete instead of pricing Gemini as GPT.

Vision retains one bounded JPEG, `low` image detail, 4,000 output tokens, exact wire identity and source/consent/lease guards. Whisper ASR is unchanged. Model/account acceptance and multilingual/vision quality require separate live synthetic receipts; offline success never proves them.
