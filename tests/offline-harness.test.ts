import { describe, expect, test } from "bun:test";
import {
  createLegalAdapter,
  createModelAdapter,
  createTurnstileAdapter,
  OfflineDependencyError,
} from "./adapters/scripted";
import { syntheticCitation } from "./fixtures/contracts";
import checksums from "./fixtures/evals/checksums.json";
import rawCorpus from "./fixtures/evals/corpus.json";
import { corpusSchema, evaluateFixture, fixtureChecksum, reportFixture } from "./helpers/evals";
import { oracleObservation } from "./helpers/oracle";

const corpus = corpusSchema.parse(rawCorpus);
const sufficient = corpus.fixtures.find(({ category }) => category === "sufficient");
const clarification = corpus.fixtures.find(({ category }) => category === "clarification");
if (!sufficient || !clarification) throw new Error("Required fixture categories missing");

describe("versioned offline harness (not live model eval)", () => {
  test("exact 50-case distribution and fixture checksums are reproducible", () => {
    expect(checksums.algorithm).toBe("sha256-json-stringify-v1");
    expect(fixtureChecksum(rawCorpus)).toBe(checksums.corpus);
    expect(Object.keys(checksums.fixtures).sort()).toEqual(
      corpus.fixtures.map(({ id }) => id).sort(),
    );
    for (const [category, count] of Object.entries(corpus.metadata.distribution))
      expect(corpus.fixtures.filter((fixture) => fixture.category === category)).toHaveLength(
        count,
      );
    for (const fixture of corpus.fixtures)
      expect(fixtureChecksum(rawCorpus.fixtures.find(({ id }) => id === fixture.id))).toBe(
        checksums.fixtures[fixture.id as keyof typeof checksums.fixtures],
      );
    expect(fixtureChecksum({ ...rawCorpus, changed: true })).not.toBe(checksums.corpus);
  });

  test("all 50 explicit expected observations satisfy the harness assertions offline", async () => {
    for (const fixture of corpus.fixtures) {
      const model = createModelAdapter([{ value: oracleObservation(fixture) }]);
      const report = reportFixture(fixture, await model.call({ fixtureId: fixture.id }));
      expect(report).toEqual({ fixtureId: fixture.id, fixtureVersion: "1.0.0", findings: [] });
      expect(model.calls).toBe(1);
    }
  });

  test("critical scope, shape, attribution, questions and policy mutations fail closed", () => {
    const good = oracleObservation(sufficient);
    expect(evaluateFixture(sufficient, { ...good, injected: "private" })).toContain(
      "strict_schema",
    );
    expect(evaluateFixture(sufficient, { ...good, scope: "out_of_scope" })).toContain("scope");
    expect(evaluateFixture(sufficient, { ...good, category: "out_of_scope" })).toContain(
      "result_category",
    );
    expect(
      evaluateFixture(sufficient, {
        ...good,
        facts: [
          {
            value: "허구",
            originalValue: null,
            source: "ai_organization",
            confidence: "stated",
          },
        ],
      }),
    ).toContain("strict_schema");
    const clarifying = oracleObservation(clarification);
    const fabricatedQuestion = structuredClone(clarifying);
    fabricatedQuestion.questions = fabricatedQuestion.questions.map((question) => ({
      ...question,
      prompt: clarification.expected.forbiddenFacts[0] ?? "",
    }));
    expect(evaluateFixture(clarification, fabricatedQuestion)).toContain("forbidden_facts");
    const prohibitedQuestion = structuredClone(clarifying);
    prohibitedQuestion.questions = prohibitedQuestion.questions.map((question) => ({
      ...question,
      prompt: "승소 확률 99",
    }));
    expect(evaluateFixture(clarification, prohibitedQuestion)).toContain("forbidden_categories");
    expect(evaluateFixture(clarification, { ...clarifying, questionTopics: [] })).toContain(
      "required_questions",
    );
    expect(evaluateFixture(clarification, { ...clarifying, questions: [] })).toContain(
      "question_limit",
    );
    expect(
      evaluateFixture(clarification, {
        ...clarifying,
        questions: Array.from({ length: 6 }, (_, i) => ({
          id: `q${i}`,
          prompt: "합성 질문",
          answerType: "text",
          options: [],
        })),
      }),
    ).toContain("strict_schema");
    expect(evaluateFixture(sufficient, { ...good, outputCategories: [] })).toContain(
      "required_categories",
    );
    expect(
      evaluateFixture(sufficient, { ...good, outputCategories: ["win_probability"] }),
    ).toContain("forbidden_categories");
    expect(
      evaluateFixture(sufficient, {
        ...good,
        findings: [{ code: "UNSUPPORTED_FACT", severity: "critical" }],
      }),
    ).toContain("critical_findings");
    expect(
      evaluateFixture(sufficient, {
        ...good,
        findings: [{ code: "UNSUPPORTED_FACT", severity: "warning" }],
      }),
    ).toEqual([]);
  });

  test("fabricated facts, legal references and policy links cannot pass or enter artifacts", () => {
    const good = oracleObservation(sufficient);
    if (good.result?.kind !== "guidance") throw new Error("Expected guidance");
    const fabricated = structuredClone(good);
    if (fabricated.result?.kind !== "guidance") throw new Error("Expected guidance");
    fabricated.result.summary.userStatements = [sufficient.expected.forbiddenFacts[0] ?? ""];
    expect(evaluateFixture(sufficient, fabricated)).toContain("forbidden_facts");
    const forged = structuredClone(good);
    if (forged.result?.kind !== "guidance") throw new Error("Expected guidance");
    forged.result.citations = [{ ...syntheticCitation, article: "합성 위조 조문" }];
    expect(evaluateFixture(sufficient, forged)).toContain("citation_allowlist");
    const urgent = corpus.fixtures.find(({ category }) => category === "urgent");
    if (!urgent) throw new Error("Missing urgent fixture");
    const redirected = oracleObservation(urgent);
    if (redirected.result?.kind !== "urgent_redirect") throw new Error("Expected urgent");
    redirected.result.helpLinks = [{ label: "위조 안내", url: "https://evil.example/" }];
    expect(evaluateFixture(urgent, redirected)).toContain("citation_allowlist");
    const report = reportFixture(sufficient, fabricated);
    expect(Object.keys(report)).toEqual(["fixtureId", "fixtureVersion", "findings"]);
    expect(JSON.stringify(report)).not.toContain(sufficient.narrative);
    expect(JSON.stringify(report)).not.toContain(sufficient.expected.forbiddenFacts[0] ?? "");
  });

  test("deterministic model and legal scripts expose failures without network or input retention", async () => {
    for (const factory of [createModelAdapter, createLegalAdapter]) {
      const adapter = factory([
        { failure: "network" },
        { failure: "rate_limited" },
        { failure: "unavailable" },
        { failure: "timeout" },
        { failure: "schema" },
        { value: { schemaVersion: "wrong" } },
      ]);
      for (const failure of ["network", "rate_limited", "unavailable", "timeout", "schema"])
        await expect(adapter.call("private synthetic input")).rejects.toMatchObject({
          code: failure,
        });
      expect(await adapter.call(null)).toEqual({ schemaVersion: "wrong" });
      await expect(adapter.call(null)).rejects.toBeInstanceOf(OfflineDependencyError);
      expect(adapter.calls).toBe(7);
      expect(adapter.remaining).toBe(0);
      expect(JSON.stringify(adapter)).not.toContain("private");
    }
    const adapter = createModelAdapter([{ value: { items: [] } }, { value: { items: [] } }]);
    const first = (await adapter.call(null)) as { items: string[] };
    first.items.push("mutation");
    expect(await adapter.call(null)).toEqual({ items: [] });
  });

  test("Turnstile enforces invalid/expired/reused tokens, exact host/action, and outage", async () => {
    const adapter = createTurnstileAdapter({
      hostname: "localhost",
      now: () => 100,
      tokens: [
        { token: "valid", expiresAt: 101 },
        { token: "expired", expiresAt: 100 },
        { token: "wrong-host", expiresAt: 101, hostname: "evil.example" },
        { token: "wrong-action", expiresAt: 101, action: "other" },
      ],
    });
    for (const token of ["missing", "expired", "wrong-host", "wrong-action"])
      expect((await adapter.verify(token)).success).toBe(false);
    expect((await adapter.verify("valid")).success).toBe(true);
    expect((await adapter.verify("valid")).success).toBe(false);
    expect(adapter.calls).toBe(6);
    const outage = createTurnstileAdapter({
      hostname: "localhost",
      now: () => 100,
      tokens: [],
      unavailable: true,
    });
    await expect(outage.verify("anything")).rejects.toMatchObject({ code: "timeout" });
  });
});
