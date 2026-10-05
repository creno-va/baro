import { expect, test } from "bun:test";
import {
  v2CitationsForRetrievedSourcesSchema,
  v2CreateCaseRequestSchema,
  v2FactsForSourcesSchema,
  v2MessageSchema,
  v2OfficialCitationSchema,
  v2OfficialCitationsForRegistrySchema,
} from "../../../../src/contracts/v2";
import citationNegatives from "./citation-negatives.json";
import failures from "./failures.json";
import families from "./families.json";
import guides from "./guides.json";
import manifest from "./manifest.json";
import precedents from "./precedents.json";
import statutes from "./statutes.json";

const groups = {
  "statutes.json": statutes,
  "precedents.json": precedents,
  "guides.json": guides,
  "failures.json": failures,
  "families.json": families,
  "citation-negatives.json": citationNegatives,
};
const responses = [...statutes, ...precedents, ...guides, ...failures];
const testHosts = manifest.testOnlyGuideRegistry.map((entry) => entry.host);
const annotated = responses.flatMap((fixture) =>
  fixture.expected.citation === null ? [] : [fixture.expected.citation],
);
async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("legal v2 manifest has complete unique synthetic inventory and no capture or live claims", () => {
  expect(manifest.origin).toBe("synthetic");
  expect(manifest.capturedAt).toBeNull();
  expect(manifest.liveEvidence).toBe(false);
  expect(manifest.adapterValidation).toBe("not_run");
  expect(manifest.shapeStatus).toBe("provisional_documented_fields_not_captured_json_shape");
  expect(manifest.files.map((entry) => entry.name).sort()).toEqual(Object.keys(groups).sort());
  for (const entry of manifest.files) {
    expect(entry.name in groups).toBe(true);
    expect(groups[entry.name as keyof typeof groups].length).toBe(entry.entries);
  }
  const ids = [...responses, ...families, ...citationNegatives].map((fixture) => fixture.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const fixture of responses) {
    expect(fixture.origin).toBe("synthetic");
    expect(fixture.captureStatus).toBe("not_captured");
    expect(fixture.adapterValidation).toBe("not_run");
    expect(Object.keys(fixture.request.parametersWithoutCredential)).not.toContain("OC");
    expect(Object.keys(fixture.request.parametersWithoutCredential)).not.toContain("oc");
    expect(fixture.response.body).not.toMatch(/[?&]OC=/i);
  }
  expect(manifest.credentialContract.emailPrefixAssumption).toBe(false);
  expect(manifest.credentialContract.storedInCorpus).toBe(false);
});

test("raw payload and expected text hashes pin exact UTF-8 bytes and UTF-16 spans", async () => {
  for (const fixture of responses) {
    expect(await sha256(fixture.response.body)).toBe(fixture.response.bodySha256);
    const { citation, normalizedText, span, canonicalIdentity } = fixture.expected;
    if (normalizedText === null) {
      expect(citation).toBeNull();
      expect(span).toBeNull();
      continue;
    }
    expect(citation).not.toBeNull();
    expect(span).not.toBeNull();
    expect(canonicalIdentity).not.toBeNull();
    if (citation === null || span === null || canonicalIdentity === null)
      throw new Error("Incomplete expected annotation");
    expect(await sha256(normalizedText)).toBe(citation.contentHash);
    expect(span.contentHash).toBe(citation.contentHash);
    expect(normalizedText.slice(span.startUtf16, span.endUtf16)).toBe(span.text);
    expect(span.section).toBe(canonicalIdentity.section);
    if ("officialId" in citation) expect(citation.officialId).toBe(canonicalIdentity.officialId);
    if ("effectiveDate" in citation) expect(canonicalIdentity.date).toBe(citation.effectiveDate);
    if ("decisionDate" in citation) expect(canonicalIdentity.date).toBe(citation.decisionDate);
    if ("publishedDate" in citation) expect(citation.publishedDate).toBe(canonicalIdentity.date);
  }
});

test("annotated citations exercise shared strict type/date/URL boundaries, not upstream parsers", () => {
  const schema = v2OfficialCitationSchema(testHosts);
  for (const citation of annotated) expect(schema.safeParse(citation).success).toBe(true);
  for (const example of citationNegatives) {
    expect(example.expectedSharedSchemaAccepted).toBe(false);
    expect(schema.safeParse(example.citation).success).toBe(false);
  }
  const undated = guides.find((fixture) => fixture.id === "guide_unknown_date");
  expect(undated?.expected.citation?.publishedDate).toBeNull();
  expect(undated?.expected.availability).toBe("limited");
});

test("institution factories require a supplied test registry and reject endpoint identity substitution", () => {
  const guide = guides.find((fixture) => fixture.id === "guide_verified")?.expected.citation;
  if (!guide) throw new Error("Missing synthetic guide annotation");
  expect(v2OfficialCitationsForRegistrySchema([]).safeParse([guide]).success).toBe(false);
  const testRegistrySchema = v2OfficialCitationsForRegistrySchema(manifest.testOnlyGuideRegistry);
  expect(testRegistrySchema.safeParse([guide]).success).toBe(true);
  expect(testRegistrySchema.safeParse([{ ...guide, endpointId: "other_endpoint" }]).success).toBe(
    false,
  );
  expect(
    testRegistrySchema.safeParse([{ ...guide, institutionId: "other_institution" }]).success,
  ).toBe(false);
  expect(
    testRegistrySchema.safeParse([{ ...guide, url: "https://www.easylaw.go.kr/CSP/private.laf" }])
      .success,
  ).toBe(false);
  expect(
    manifest.registryCandidates.find((entry) => entry.id === "klac_summary_candidate")?.state,
  ).toBe("corpus_disabled_rights_pending");
  expect(manifest.registryCandidates.find((entry) => entry.id === "moleg_easylaw")?.state).toBe(
    "proposed_unapproved",
  );
});

test("server allowlist rejects altered metadata and a citation missing from the selected retrieval", () => {
  const citation = statutes.find((fixture) => fixture.id === "statute_detail_verified")?.expected
    .citation;
  if (!citation) throw new Error("Missing synthetic statute annotation");
  const schema = v2CitationsForRetrievedSourcesSchema([citation]);
  expect(schema.safeParse([citation]).success).toBe(true);
  expect(schema.safeParse([{ ...citation, contentHash: "f".repeat(64) }]).success).toBe(false);
  expect(schema.safeParse([{ ...citation, title: "변조된 합성 제목" }]).success).toBe(false);
  expect(v2CitationsForRetrievedSourcesSchema([]).safeParse([citation]).success).toBe(false);
});

test("all target families admit KR narrative and keep source-backed factual preparation in both source states", () => {
  expect(new Set(families.map((fixture) => fixture.family)).size).toBe(8);
  const schema = v2FactsForSourcesSchema({
    intakeRevision: 1,
    answeredQuestionIds: [],
    messages: [],
    files: [],
    verifiedCitationIds: [],
  });
  for (const fixture of families) {
    expect(
      families
        .filter((other) => other.family === fixture.family)
        .map((other) => other.sourceState)
        .sort(),
    ).toEqual(["available", "gap"]);
    expect(fixture.synthetic).toBe(true);
    expect(fixture.adapterValidation).toBe("not_run");
    expect(
      v2CreateCaseRequestSchema.safeParse({
        narrative: fixture.narrative,
        subjectContext: fixture.subjectContext,
        jurisdiction: fixture.jurisdiction,
        turnstileToken: "synthetic_not_a_live_token",
      }).success,
    ).toBe(true);
    expect(fixture.expected.familyOutOfScope).toBe(false);
    expect(fixture.expected.factualPreparationAllowed).toBe(true);
    expect(fixture.expected.modelMemoryFallbackAllowed).toBe(false);
    expect(fixture.expected.unverifiedLegalExplanationAllowed).toBe(false);
    expect(fixture.expected.automaticContactAllowed).toBe(false);
    expect(
      fixture.sourceFixtureIds.every((id) => responses.some((source) => source.id === id)),
    ).toBe(true);
    const fact = {
      id: `fact_${fixture.id}`,
      text: fixture.narrative,
      attribution: "user_statement",
      certainty: "reported",
      significance: "neutral",
      references: [{ kind: "intake_narrative", intakeRevision: 1 }],
      conflictingFactIds: [],
      userEdited: false,
    };
    expect(schema.safeParse([fact]).success).toBe(true);
    expect(
      schema.safeParse([
        {
          ...fact,
          attribution: "official_source",
          certainty: "observed",
          references: [{ kind: "official_source", citationId: "invented_source" }],
        },
      ]).success,
    ).toBe(false);
    expect(
      v2MessageSchema().safeParse({
        schemaVersion: "2",
        id: `message_${fixture.id}`,
        operationId: `operation_${fixture.id}`,
        workspaceRevision: 1,
        createdAt: "2026-10-06T00:00:00Z",
        role: "assistant",
        safety: "validated",
        text: "합성 자료의 날짜와 보유 여부를 확인할 질문으로 정리했습니다.",
        references: [{ kind: "intake_narrative", intakeRevision: 1 }],
        citations: [],
        warnings: ["공식 근거 적용은 별도 확인이 필요합니다."],
      }).success,
    ).toBe(true);
  }
});

test("a schema-valid message is explicitly not evidence that its legal claim is supported", () => {
  const citation = statutes.find((fixture) => fixture.id === "statute_detail_verified")?.expected
    .citation;
  if (!citation) throw new Error("Missing synthetic statute annotation");
  // This intentionally demonstrates the remaining #63/#64 semantic check, rather than claiming rejection.
  expect(
    v2MessageSchema().safeParse({
      schemaVersion: "2",
      id: "unrelated_claim",
      operationId: "operation_unrelated",
      workspaceRevision: 1,
      createdAt: "2026-10-06T00:00:00Z",
      role: "assistant",
      safety: "validated",
      text: "합성 조문에 없는 결론을 주장하는 의도적인 반례입니다.",
      references: [{ kind: "official_source", citationId: citation.id }],
      citations: [citation],
      warnings: [],
    }).success,
  ).toBe(true);
  expect(manifest.unexecutedAcceptanceCases).toContain(
    "span mismatch/hash mismatch and semantically unrelated claim",
  );
});
