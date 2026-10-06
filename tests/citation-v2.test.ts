import { expect, test } from "bun:test";
import { claimReviewHash, validateV2Claims } from "../src/server/modules/citation/v2-validate";
import { textHash } from "../src/server/modules/legal-retrieval/service";
import type { RetrievalOutput } from "../src/server/modules/legal-retrieval/v2/contracts";
import { makeChunk } from "../src/server/modules/legal-retrieval/v2/source";

async function fixture() {
  const chunk = await makeChunk(
    {
      sourceType: "statute",
      officialId: "1",
      version: "1",
      section: "제1조",
      canonicalUrl: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=1",
      title: "합성 법률",
      body: "합성 원문 😀: 실제 법률을 설명하지 않습니다.",
      sourceDate: "2026-01-01",
      fetchedAt: "2026-10-06T00:00:00.000Z",
      verifiedAt: "2026-10-06T00:00:00.000Z",
      rightsProvenance: "synthetic test only",
      institutionId: null,
      endpointId: null,
      court: null,
      caseNumber: null,
    },
    "2026-10-06",
  );
  const retrieval: RetrievalOutput = {
    schemaVersion: "2",
    asOfDate: "2026-10-06",
    outcomes: [{ kind: "statute", availability: "verified", reason: null, chunks: [chunk] }],
    chunks: [chunk],
    retrievalHash: await textHash(JSON.stringify([chunk.citation.sourceId])),
    legalSourceStatus: "verified",
    factualPreparationAvailable: true,
  };
  const claim = {
    id: "synthetic_claim",
    kind: "quotation" as const,
    text: chunk.source.body,
    citationId: chunk.citation.id,
    startUtf16: 0,
    endUtf16: chunk.source.body.length,
  };
  return { chunk, retrieval, claim };
}
test("exact source text/span/hash and server-owned citation permit a quotation, with Unicode boundaries intact", async () => {
  const f = await fixture();
  expect((await validateV2Claims([f.claim], [f.chunk.citation], f.retrieval)).valid).toBe(true);
});
test.each(["text", "hash", "span", "metadata", "unknown", "limited", "surrogate"])(
  "%s mismatch rejects the claim",
  async (mode) => {
    const f = await fixture();
    const claim = { ...f.claim };
    const citation = { ...f.chunk.citation };
    if (mode === "text") claim.text = "무관한 결론";
    if (mode === "hash") f.chunk.source.body += "변조";
    if (mode === "span") claim.endUtf16++;
    if (mode === "metadata") citation.title = "다른 제목";
    if (mode === "unknown") claim.citationId = "missing";
    if (mode === "limited") {
      const outcome = f.retrieval.outcomes[0];
      if (outcome) outcome.availability = "limited";
    }
    if (mode === "surrogate") {
      claim.startUtf16 = f.chunk.source.body.indexOf("😀") + 1;
      claim.text = f.chunk.source.body.slice(claim.startUtf16);
    }
    expect((await validateV2Claims([claim], [citation], f.retrieval)).valid).toBe(false);
  },
);
test("intact source does not approve an unrelated legal explanation without exact semantic and policy review", async () => {
  const f = await fixture();
  const claim = {
    ...f.claim,
    kind: "legal_explanation" as const,
    text: "합성 법률 설명이며 실제 법적 판단이 아닙니다.",
  };
  expect((await validateV2Claims([claim], [f.chunk.citation], f.retrieval)).valid).toBe(false);
  const hash = await claimReviewHash(claim, f.retrieval.asOfDate);
  const review = {
    claimId: claim.id,
    claimHash: hash,
    sourceHash: f.chunk.citation.contentHash,
    accepted: true,
    policyAccepted: true,
  };
  expect((await validateV2Claims([claim], [f.chunk.citation], f.retrieval, [review])).valid).toBe(
    true,
  );
  expect(
    (
      await validateV2Claims([claim], [f.chunk.citation], f.retrieval, [
        { ...review, policyAccepted: false },
      ])
    ).valid,
  ).toBe(false);
  expect(
    (
      await validateV2Claims([{ ...claim, text: "다른 설명" }], [f.chunk.citation], f.retrieval, [
        review,
      ])
    ).valid,
  ).toBe(false);
});
test.each([
  "version",
  "date",
  "officialId",
  "url",
  "extractor",
  "retrievalHash",
  "duplicate",
  "malformedServerCitation",
  "unavailable",
])("server %s drift fails closed rather than approving a source claim", async (mode) => {
  const f = await fixture();
  if (mode === "version") f.chunk.source.version = "99";
  if (mode === "date") f.chunk.source.sourceDate = "2026-01-02";
  if (mode === "officialId") f.chunk.source.officialId = "99";
  if (mode === "url") f.chunk.source.canonicalUrl = "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=999";
  if (mode === "extractor") f.chunk.source.extractorVersion = "unexpected";
  if (mode === "retrievalHash") f.retrieval.retrievalHash = "f".repeat(64);
  if (mode === "malformedServerCitation") f.chunk.citation.url = "https://attacker.invalid";
  if (mode === "unavailable") f.retrieval.legalSourceStatus = "unavailable";
  expect(
    (
      await validateV2Claims(
        mode === "duplicate" ? [f.claim, f.claim] : [f.claim],
        [f.chunk.citation],
        f.retrieval,
      )
    ).valid,
  ).toBe(false);
});
