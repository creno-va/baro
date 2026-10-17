import { expect, test } from "bun:test";
import {
  type QuotationResolution,
  resolveQuotationSpans,
  safeQuotationResolution,
} from "../src/server/modules/citation/quotation-spans";
import { claimReviewHash, validateV2Claims } from "../src/server/modules/citation/v2-validate";
import { textHash } from "../src/server/modules/legal-retrieval/service";
import type { RetrievalOutput } from "../src/server/modules/legal-retrieval/v2/contracts";
import { makeChunk } from "../src/server/modules/legal-retrieval/v2/source";
import { projectWorkspaceSources } from "../src/server/modules/legal-retrieval/v2/workspace-sources";
import {
  createWorkspacePipeline,
  type WorkspaceContext,
  WorkspaceOutputPolicyError,
} from "../src/server/modules/workspace/pipeline";

const quote = "합성 조문: 원문 😀과 두 줄을\n그대로 확인합니다.";
const approved = {
  pass: true,
  findings: [],
  unsupportedFactIds: [],
  legalClaimsSupported: true,
  strategyDetected: false,
};
const emptyResolution: QuotationResolution = {
  valid_span: 0,
  unique_exact_match: 0,
  text_not_found: 0,
  ambiguous: 0,
  invalid_text: 0,
  source_unavailable: 0,
};
async function fixture(body = `${"합성 머리말 😀\n".repeat(650)}${quote}\n합성 끝`) {
  const now = "2026-10-17T00:00:00.000Z";
  const chunk = await makeChunk(
    {
      sourceType: "statute",
      officialId: "1",
      version: "1",
      section: "제1조",
      canonicalUrl: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=1",
      title: "합성 공식 자료",
      body,
      sourceDate: "2026-01-01",
      fetchedAt: now,
      verifiedAt: now,
      rightsProvenance: "synthetic test only",
      institutionId: null,
      endpointId: null,
      court: null,
      caseNumber: null,
    },
    "2026-10-17",
  );
  const retrieval: RetrievalOutput = {
    schemaVersion: "2",
    asOfDate: "2026-10-17",
    chunks: [chunk],
    outcomes: [{ kind: "statute", availability: "verified", reason: null, chunks: [chunk] }],
    retrievalHash: await textHash(JSON.stringify([chunk.citation.sourceId])),
    legalSourceStatus: "verified",
    factualPreparationAvailable: true,
  };
  const sources = await projectWorkspaceSources(retrieval);
  const summary = {
    schemaVersion: "2" as const,
    revision: 1,
    intakeRevision: 1,
    createdAt: now,
    overview: "합성 자료 확인",
    facts: [],
    parties: [],
    unknowns: [],
    notices: ["합성 자료"],
  };
  const context: WorkspaceContext = {
    ...sources,
    intake: {
      schemaVersion: "2",
      revision: 1,
      status: "confirmed",
      narrative: "합성 자료를 확인합니다.",
      batches: [],
      summary,
      confirmedSummaryRevision: 1,
      currentJobId: null,
    },
    confirmedSummary: summary,
    messages: [],
    latestMessage: {
      schemaVersion: "2",
      id: "synthetic_message",
      operationId: "synthetic_operation",
      workspaceRevision: 1,
      createdAt: now,
      role: "user",
      text: "공식 자료의 짧은 문장을 그대로 확인해 주세요.",
      selectedFileIds: [],
    },
    facts: [],
    materials: [],
    references: {
      intakeRevision: 1,
      answeredQuestionIds: [],
      messages: [],
      files: [],
      verifiedCitationIds: [chunk.citation.id],
    },
  };
  const claim = {
    id: "synthetic_claim",
    kind: "quotation" as const,
    text: quote,
    citationId: chunk.citation.id,
    startUtf16: 1,
    endUtf16: quote.length + 1,
  };
  const draft = {
    text: quote,
    references: [{ kind: "official_source" as const, citationId: chunk.citation.id }],
    warnings: [],
    facts: [],
    parties: [],
    actions: [],
    timeline: [],
    requestedSources: [],
    sourceClaims: [claim],
  };
  return { chunk, context, retrieval, claim, draft };
}

test.each([
  undefined,
  "unknown",
  "citation_unavailable",
  "source_identity_mismatch",
  "quotation_text_or_span_mismatch",
  "source_semantics_mismatch",
  "source_freshness",
  "coverage_overstatement",
])("valid quotations still fail a critical audit with diagnostic reason %s", async (reason) => {
  const f = await fixture();
  f.claim.startUtf16 = f.chunk.source.body.indexOf(quote);
  f.claim.endUtf16 = f.claim.startUtf16 + quote.length;
  const before = structuredClone(f.context);
  const calls: string[] = [];
  const pipeline = createWorkspacePipeline(
    {
      call: async (phase, input) => {
        calls.push(phase);
        if (phase !== "workspace_audit") return f.draft;
        expect(input).toMatchObject({
          context: { sourceTexts: f.context.sourceTexts, citations: f.context.citations },
          draft: { sourceClaims: [f.claim] },
        });
        return {
          ...approved,
          findings: [
            {
              severity: "critical",
              code: "wrong_reference",
              target: "source_claim",
              basis: "verified_source",
              ...(reason === undefined ? {} : { sourceClaimReason: reason }),
            },
          ],
        };
      },
    },
    { reserve: async () => true, invocation: () => crypto.randomUUID() },
  );
  await expect(pipeline.chat(f.context, "synthetic_source_audit_reason")).rejects.toMatchObject({
    reason: "audit_rejected",
    auditFailure: {
      pass: true,
      legalClaimsSupported: true,
      findings: [
        {
          severity: "critical",
          code: "wrong_reference",
          target: "source_claim",
          basis: "verified_source",
          sourceClaimReason: reason ?? "unknown",
        },
      ],
    },
  });
  expect(calls).toEqual(["workspace_chat", "workspace_audit"]);
  expect(f.context).toEqual(before);
});

test("long Korean/newline/astral quotation with wrong offsets is realigned before the final audit", async () => {
  const f = await fixture();
  expect(await validateV2Claims([f.claim], [f.chunk.citation], f.retrieval)).toMatchObject({
    valid: false,
    failure: "quotation_mismatch",
  });
  const original = structuredClone(f.draft),
    supplied = structuredClone(f.context);
  const observations: QuotationResolution[] = [];
  let calls = 0,
    auditedClaim: typeof f.claim | undefined;
  const pipeline = createWorkspacePipeline(
    {
      call: async (phase, input) => {
        calls++;
        if (phase !== "workspace_audit") return f.draft;
        auditedClaim = (input as { draft: typeof f.draft }).draft.sourceClaims[0];
        expect((input as { draft: typeof f.draft }).draft.text).toBe(original.text);
        return approved;
      },
    },
    {
      reserve: async () => true,
      invocation: () => "synthetic_invocation",
      observeQuotationResolution: (value) => observations.push(value),
    },
  );
  const result = await pipeline.chat(f.context, "synthetic_request");
  expect(auditedClaim).toEqual({
    ...f.claim,
    startUtf16: f.chunk.source.body.indexOf(quote),
    endUtf16: f.chunk.source.body.indexOf(quote) + quote.length,
  });
  expect(calls).toBe(2); // One generation and one audit; no repair call or source IO.
  expect(result.sourceClaims[0]).toEqual(auditedClaim);
  expect(result.text).toBe(quote);
  expect(f.draft).toEqual(original);
  expect(f.context).toEqual(supplied);
  expect(observations).toEqual([{ ...emptyResolution, unique_exact_match: 1 }]);
  expect((await validateV2Claims(result.sourceClaims, result.citations, f.retrieval)).valid).toBe(
    true,
  );
  const finalClaim = result.sourceClaims[0];
  if (!auditedClaim || !finalClaim) throw new Error("Synthetic audit did not run");
  expect(await claimReviewHash(finalClaim, f.retrieval.asOfDate)).toBe(
    await claimReviewHash(auditedClaim, f.retrieval.asOfDate),
  );
  expect(await claimReviewHash(auditedClaim, f.retrieval.asOfDate)).not.toBe(
    await claimReviewHash(f.claim, f.retrieval.asOfDate),
  );
});

test("valid quotation coordinates are preserved even if the exact sentence occurs twice", async () => {
  const f = await fixture(`${quote}\n${quote}`);
  const claim = { ...f.claim, startUtf16: quote.length + 1, endUtf16: 2 * quote.length + 1 };
  const result = resolveQuotationSpans([claim], f.context);
  expect(result.claims[0]).toBe(claim);
  expect(result.resolution).toEqual({ ...emptyResolution, valid_span: 1 });
});

test.each([`${quote}\n${quote}`, "가가가"])(
  "incorrect coordinates never select among repeated or overlapping occurrences: %s",
  async (body) => {
    const f = await fixture(body);
    const claim = {
      ...f.claim,
      text: body === "가가가" ? "가가" : quote,
      startUtf16: 3,
      endUtf16: 4,
    };
    const result = resolveQuotationSpans([claim], f.context);
    expect(result.claims[0]).toBe(claim);
    expect(result.resolution).toEqual({ ...emptyResolution, ambiguous: 1 });
    expect((await validateV2Claims(result.claims, [f.chunk.citation], f.retrieval)).valid).toBe(
      false,
    );
  },
);

test.each([
  " 합성 조문: 원문 😀과 두 줄을\n그대로 확인합니다.",
  quote.replace("\n", "\r\n"),
  quote.replace("그대로", "완전히"),
  quote.replace(" ", "  "),
  quote.replace("합성", "합성"),
])("quotation matching never trims, normalizes or repairs text: %s", async (text) => {
  const f = await fixture();
  const claim = { ...f.claim, text };
  const result = resolveQuotationSpans([claim], f.context);
  expect(result.claims[0]).toBe(claim);
  expect(result.resolution.text_not_found).toBe(1);
});

test("an exact quotation outside the supplied prefix cannot be recovered from the full original", async () => {
  const f = await fixture(`${"합".repeat(20001)}${quote}`);
  const result = resolveQuotationSpans([f.claim], f.context);
  expect(f.context.sourceTexts?.[0]?.text).not.toContain(quote);
  expect(result.claims[0]).toBe(f.claim);
  expect(result.resolution.text_not_found).toBe(1);
});

test.each(["", "\uDE00", "\uD83D"])(
  "empty or isolated surrogate quotations stay rejected",
  async (text) => {
    const f = await fixture();
    const claim = { ...f.claim, text };
    const result = resolveQuotationSpans([claim], f.context);
    expect(result.claims[0]).toBe(claim);
    expect(result.resolution.invalid_text).toBe(1);
  },
);

test.each([
  "missing_proof",
  "missing_excerpt",
  "duplicate_excerpt",
  "different_excerpt",
  "unverified",
  "wrong_kind",
  "unauthorized",
  "other_citation",
  "duplicate_chunk",
  "duplicate_citation",
] as const)("quotation repair cannot change or borrow source authority: %s", async (mode) => {
  const f = await fixture();
  const proof = f.context.sourceRetrieval,
    texts = f.context.sourceTexts,
    excerpt = texts?.[0],
    outcome = proof?.outcomes[0];
  if (!proof || !texts || !excerpt || !outcome) throw new Error("Missing synthetic source");
  if (mode === "missing_proof") delete f.context.sourceRetrieval;
  if (mode === "missing_excerpt") f.context.sourceTexts = [];
  if (mode === "duplicate_excerpt") texts.push(excerpt);
  if (mode === "different_excerpt") excerpt.text += quote;
  if (mode === "unverified") proof.legalSourceStatus = "unavailable";
  if (mode === "wrong_kind") outcome.kind = "precedent";
  if (mode === "unauthorized") f.context.references.verifiedCitationIds = [];
  if (mode === "other_citation") f.claim.citationId = "other_synthetic_citation";
  if (mode === "duplicate_chunk") proof.chunks.push(f.chunk);
  if (mode === "duplicate_citation") f.context.citations.push(f.chunk.citation);
  const result = resolveQuotationSpans([f.claim], f.context);
  expect(result.claims[0]).toBe(f.claim);
  expect(result.resolution.source_unavailable).toBe(1);
});

test("legal explanations are never moved to a convenient exact source occurrence", async () => {
  const f = await fixture();
  const claim = { ...f.claim, kind: "legal_explanation" as const };
  const result = resolveQuotationSpans([claim], f.context);
  expect(result.claims[0]).toBe(claim);
  expect(result.resolution).toEqual(emptyResolution);
});

test.each(["audit", "source_hash", "retrieval_hash", "observer"] as const)(
  "realignment never bypasses subsequent validation or lets observer failure alter it: %s",
  async (mode) => {
    const f = await fixture();
    const proof = f.context.sourceRetrieval,
      source = proof?.chunks[0]?.source;
    if (!proof || !source) throw new Error("Missing synthetic source");
    if (mode === "source_hash") source.contentHash = "f".repeat(64);
    if (mode === "retrieval_hash") proof.retrievalHash = "f".repeat(64);
    const observations: QuotationResolution[] = [];
    const pipeline = createWorkspacePipeline(
      {
        call: async (phase) =>
          phase !== "workspace_audit"
            ? f.draft
            : mode === "audit"
              ? { ...approved, findings: [{ severity: "critical", code: "unsupported_fact" }] }
              : approved,
      },
      {
        reserve: async () => true,
        invocation: () => "synthetic_invocation",
        observeQuotationResolution: (value) => {
          observations.push(value);
          if (mode === "observer") throw new Error("Synthetic diagnostic observer failure");
        },
      },
    );
    if (mode === "observer")
      expect((await pipeline.chat(f.context, "synthetic_request")).text).toBe(quote);
    else {
      await expect(pipeline.chat(f.context, "synthetic_request")).rejects.toMatchObject({
        reason: mode === "audit" ? "audit_rejected" : "unsupported_fact",
        ...(mode === "audit" ? {} : { claimFailure: mode }),
      });
    }
    expect(observations).toEqual([{ ...emptyResolution, unique_exact_match: 1 }]);
  },
);

test.each(["not_found", "ambiguous"] as const)(
  "unrecoverable quotation still reaches full audit and is rejected: %s",
  async (mode) => {
    const f = await fixture(mode === "ambiguous" ? `${quote}\n${quote}` : "합성: 인용 문장 없음");
    let auditCalls = 0;
    const observations: QuotationResolution[] = [];
    const pipeline = createWorkspacePipeline(
      {
        call: async (phase) => {
          if (phase !== "workspace_audit") return f.draft;
          auditCalls++;
          return approved;
        },
      },
      {
        reserve: async () => true,
        invocation: () => "synthetic_invocation",
        observeQuotationResolution: (value) => observations.push(value),
      },
    );
    await expect(pipeline.chat(f.context, "synthetic_request")).rejects.toBeInstanceOf(
      WorkspaceOutputPolicyError,
    );
    expect(auditCalls).toBe(1);
    expect(observations).toEqual([
      { ...emptyResolution, [mode === "not_found" ? "text_not_found" : "ambiguous"]: 1 },
    ]);
  },
);

test("quotation observations contain only bounded counts, never values or coordinates", () => {
  expect(safeQuotationResolution({ ...emptyResolution, unique_exact_match: 50 })).toEqual({
    ...emptyResolution,
    unique_exact_match: 50,
  });
  for (const value of [
    { ...emptyResolution, text: "synthetic private quote" },
    { ...emptyResolution, citationId: "synthetic_id" },
    { ...emptyResolution, startUtf16: 1 },
    { ...emptyResolution, hash: "f".repeat(64) },
    { ...emptyResolution, unique_exact_match: -1 },
    { ...emptyResolution, unique_exact_match: 0.5 },
    { ...emptyResolution, unique_exact_match: 51 },
    { ...emptyResolution, unique_exact_match: 50, ambiguous: 1 },
    null,
  ])
    expect(safeQuotationResolution(value)).toBeUndefined();
});
