import { expect, test } from "bun:test";
import {
  v2PrecedentSearchRequestSchema,
  v2PrecedentSearchResponseSchema,
} from "../src/contracts/v2/precedent-research";
import fixture from "./fixtures/legal/research/synthetic-search.json";

test("research wire input contains only reviewed topic IDs and exact version guards", () => {
  const request = { expectedRevision: 7, summaryRevision: 2, topics: ["loan"] };
  expect(v2PrecedentSearchRequestSchema.safeParse(request).success).toBe(true);
  for (const extra of [
    { query: "김테스트에게 돈을 빌려줬습니다" },
    { narrative: "합성 비공개 사건" },
    { url: "https://private.invalid" },
    { ownerId: "other" },
  ])
    expect(v2PrecedentSearchRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false);
  for (const topics of [["loan", "loan"], ["private narrative"], [], ["loan", "lease", "wages"]])
    expect(v2PrecedentSearchRequestSchema.safeParse({ ...request, topics }).success).toBe(false);
  for (const summaryRevision of [0, -1, 1.5])
    expect(v2PrecedentSearchRequestSchema.safeParse({ ...request, summaryRevision }).success).toBe(
      false,
    );
});

test("bounded discovery may return a verified original with explicit partial search coverage", () => {
  const value = v2PrecedentSearchResponseSchema.parse(fixture);
  expect(value.status).toBe("complete");
  expect(value.searchTruncated).toBe(true);
  expect(value.items[0]?.citation.kind).toBe("precedent");
  expect(JSON.stringify(value)).not.toMatch(/similarity|winProbability|score/u);
});

test("research rejects changed spans, out-of-scope topics, untrusted URLs and forged result identities", () => {
  const item = fixture.items[0];
  if (!item) throw new Error("Missing synthetic precedent");
  for (const changed of [
    { ...item, id: "another" },
    { ...item, matchedTopics: ["lease"] },
    { ...item, excerpt: { ...item.excerpt, endUtf16: 999 } },
    { ...item, excerpt: { ...item.excerpt, truncated: true } },
    { ...item, citation: { ...item.citation, url: "https://private.invalid/example" } },
    {
      ...item,
      citation: { ...item.citation, url: `${item.citation.url}&OC=synthetic-private-key` },
    },
    { ...item, citation: { ...item.citation, verifiedAt: "2026-10-22T00:00:00.000Z" } },
    { ...item, citation: { ...item.citation, officialId: "90000000999" } },
    { ...item, citation: { ...item.citation, url: "https://www.law.go.kr/other" } },
    { ...item, citation: { ...item.citation, decisionDate: "2026-10-22" } },
    { ...item, similarity: 99 },
  ])
    expect(
      v2PrecedentSearchResponseSchema.safeParse({ ...fixture, items: [changed] }).success,
    ).toBe(false);
  expect(
    v2PrecedentSearchResponseSchema.safeParse({ ...fixture, items: [item, item] }).success,
  ).toBe(false);
});

test("empty, unavailable and partial research cannot masquerade as complete", () => {
  expect(
    v2PrecedentSearchResponseSchema.safeParse({ ...fixture, status: "empty", items: [] }).success,
  ).toBe(true);
  expect(
    v2PrecedentSearchResponseSchema.safeParse({
      ...fixture,
      status: "unavailable",
      items: [],
      unavailableTopics: ["loan"],
    }).success,
  ).toBe(true);
  expect(
    v2PrecedentSearchResponseSchema.safeParse({
      ...fixture,
      status: "partial",
      topics: ["loan", "lease"],
      unavailableTopics: ["lease"],
    }).success,
  ).toBe(true);
  for (const changed of [
    { items: [] },
    { unavailableTopics: ["loan"] },
    { status: "empty" },
    { status: "unavailable" },
    { status: "partial", unavailableTopics: [] },
  ])
    expect(v2PrecedentSearchResponseSchema.safeParse({ ...fixture, ...changed }).success).toBe(
      false,
    );
});

test("availability metadata is optional, finite, unique and restricted to selected unavailable topics", () => {
  const partial = {
    ...fixture,
    status: "partial",
    unavailableTopics: ["loan"],
    availabilityIssues: [{ topic: "loan", reason: "timeout" }],
  };
  expect(v2PrecedentSearchResponseSchema.safeParse(partial).success).toBe(true);
  for (const availabilityIssues of [
    [{ topic: "loan", reason: "raw private upstream message" }],
    [{ topic: "lease", reason: "timeout" }],
    [{ topic: "loan", reason: "timeout", url: "https://private.invalid" }],
    [
      { topic: "loan", reason: "timeout" },
      { topic: "loan", reason: "timeout" },
    ],
  ])
    expect(
      v2PrecedentSearchResponseSchema.safeParse({ ...partial, availabilityIssues }).success,
    ).toBe(false);
  expect(
    v2PrecedentSearchResponseSchema.safeParse({ ...partial, unavailableTopics: [] }).success,
  ).toBe(false);
});
