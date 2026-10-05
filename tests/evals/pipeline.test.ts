import { expect, test } from "bun:test";
import corpus from "../fixtures/evals/corpus.json";
import { corpusSchema } from "../helpers/evals";
import { type Fault, runPipelineFixture } from "./pipeline";

const fixtures = corpusSchema.parse(corpus).fixtures;
test("50-fixture deterministic product pipeline has zero critical findings; policy paths stop before retrieval", async () => {
  for (const fixture of fixtures) {
    const result = await runPipelineFixture(fixture);
    try {
      expect(result.report).toEqual({
        fixtureId: fixture.id,
        fixtureVersion: fixture.version,
        findings: [],
      });
      if (["urgent", "out_of_scope"].includes(fixture.category))
        expect(result.calls).not.toContain("generation");
      expect(JSON.stringify(result.report)).not.toContain(fixture.narrative);
    } finally {
      result.db.close();
    }
  }
});
test("one injected fact/citation/prohibited/schema/policy/owner critical failure fails the product eval, without averaging", async () => {
  const fixture = fixtures[0];
  if (!fixture) throw new Error("fixture");
  for (const fault of [
    "invented_fact",
    "citation",
    "prohibited",
    "schema",
    "policy",
    "owner",
  ] as Fault[]) {
    const result = await runPipelineFixture(fixture, fault);
    try {
      expect(result.report.findings.length).toBeGreaterThan(0);
    } finally {
      result.db.close();
    }
  }
});
