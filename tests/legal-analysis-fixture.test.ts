import { expect, test } from "bun:test";
import type { RetrievalPlan } from "../src/server/modules/legal-retrieval/v2/contracts";
import sample from "./fixtures/legal/analysis/scenarios.json";
import { legalAnalysisFixture } from "./helpers/legal-analysis-fixture";

const plans: RetrievalPlan[] = [
  { kind: "statute", lawTitle: "민법", articles: [{ number: "598", branch: "0" }] },
  { kind: "precedent", query: "대여금", limit: 1 },
];
test("synthetic automatic research obtains exact originals and real workspace bindings", async () => {
  const f = await legalAnalysisFixture();
  try {
    const output = await f.service().retrieve(f.input(plans), f.access);
    expect(output.outcomes.map((o) => o.availability)).toEqual(["verified", "verified"]);
    expect(output.chunks).toHaveLength(2);
    expect(output.chunks[0]?.source.body).toBe(sample.law.body);
    expect(output.chunks[1]?.source.body).toBe(sample.precedent.body);
    expect(await f.bound(output.chunks.map((c) => c.citation.id))).toEqual(output.chunks);
    expect(f.calls.map((c) => c.query).filter(Boolean)).toEqual(["민법", "대여금"]);
    expect(f.calls).toHaveLength(4);
    expect(sample.liveAcceptance).toBe(false);
  } finally {
    f.db.close();
  }
});

test("verified public originals without a workspace binding grant no report authority", async () => {
  const f = await legalAnalysisFixture();
  try {
    const output = await f.service(undefined, false).retrieve(f.input(plans), f.access);
    expect(output.chunks).toHaveLength(2);
    expect(await f.bound(output.chunks.map((c) => c.citation.id))).toEqual([null, null]);
  } finally {
    f.db.close();
  }
});

test("one failed original preserves independently verified law and identifies failure", async () => {
  const f = await legalAnalysisFixture();
  try {
    const output = await f
      .service((url, init) =>
        new URL(url).searchParams.get("target") === "prec"
          ? Promise.resolve(Response.json({ PrecSearch: { totalCnt: 0, prec: [] } }))
          : f.transport(url, init),
      )
      .retrieve(f.input(plans), f.access);
    expect(output.chunks.map((c) => c.citation.kind)).toEqual(["statute"]);
    expect(output.outcomes[1]?.reason).toBe("no_results");
    expect((await f.bound(output.chunks.map((c) => c.citation.id)))[0]).not.toBeNull();
  } finally {
    f.db.close();
  }
});
