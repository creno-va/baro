import { expect, test } from "bun:test";
import fixtures from "../tests/fixtures/legal/v2/precedents.json";
import { syntheticComparisonContext, syntheticLegalContext } from "./ai-readiness-fixture";
import { createSyntheticLegalLookup } from "./ai-readiness-legal";
import { deleteSyntheticLawCredential } from "./ai-readiness-secrets";

test("isolated legal probe refuses other sources before HTTP and caps failed public requests", async () => {
  const urls: URL[] = [];
  const lookup = createSyntheticLegalLookup("synthetic-oc", async (url) => {
    urls.push(new URL(url));
    return Response.json({ result: "synthetic rejection", msg: "fixture" });
  });
  const context = syntheticLegalContext();
  await expect(
    lookup.retrieve(context, [
      { kind: "statute", lawTitle: "민법", articles: [{ number: "600", branch: "0" }] },
    ]),
  ).rejects.toThrow("POLICY_REJECTED");
  expect(urls).toHaveLength(0);
  const selected = [
    {
      kind: "statute" as const,
      lawTitle: "민법" as const,
      articles: [{ number: "598", branch: "0" }],
    },
  ];
  for (let i = 0; i < 11; i++) {
    const result = await lookup.retrieve(context, selected);
    expect(result.citations).toEqual([]);
    expect(result.references.verifiedCitationIds).toEqual([]);
  }
  expect(urls).toHaveLength(9);
  expect(lookup.snapshot(0)).toMatchObject({
    requests: 9,
    verifiedSourceCount: 0,
    acceptedQuotationCount: 0,
  });
  for (const url of urls) {
    expect(url.origin).toBe("https://www.law.go.kr");
    expect(url.pathname).toBe("/DRF/lawSearch.do");
    expect(url.searchParams.get("target")).toBe("eflaw");
    expect(url.searchParams.get("query")).toBe("민법");
    expect(url.toString()).not.toContain("synthetic_chat");
  }
});

test("temporary credential cleanup deletes only the isolated Worker secret and checks API success", async () => {
  const scope = { accountId: "a".repeat(32), token: "synthetic-token" };
  const network = async (url: string, init: RequestInit) => {
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${scope.accountId}/workers/scripts/baro-synthetic-ai-readiness/secrets/LAW_API_OC?url_encoded=true`,
    );
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-token");
    expect(init.redirect).toBe("error");
    expect(init.body).toBeUndefined();
    return Response.json({ success: true });
  };
  await deleteSyntheticLawCredential(scope, network);
  await deleteSyntheticLawCredential(scope, async () => new Response(null, { status: 404 }));
  await expect(
    deleteSyntheticLawCredential(scope, async () =>
      Response.json({ success: false, errors: ["private sentinel"] }),
    ),
  ).rejects.toThrow("PROBE_SECRET_CLEANUP_FAILED");
  await expect(
    deleteSyntheticLawCredential({ ...scope, accountId: "../production" }, network),
  ).rejects.toThrow("PROBE_SECRET_CLEANUP_INVALID");
});

test("comparison fetches only the fixed public precedent and preserves the verified original", async () => {
  const urls: URL[] = [];
  const list = JSON.parse(
    fixtures.find((f) => f.id === "precedent_list_candidate")?.response.body ?? "{}",
  );
  const detail = JSON.parse(
    fixtures.find((f) => f.id === "precedent_verified")?.response.body ?? "{}",
  );
  const lookup = createSyntheticLegalLookup(
    "synthetic-oc",
    async (url) => {
      urls.push(new URL(url));
      return Response.json(
        new URL(url).pathname.endsWith("lawSearch.do") ? list : { PrecService: detail.판례정보 },
      );
    },
    "precedent_compare",
  );
  const context = syntheticComparisonContext();
  await expect(lookup.retrieve(context, [{ kind: "precedent", concept: "이혼" }])).rejects.toThrow(
    "POLICY_REJECTED",
  );
  await expect(
    lookup.retrieve(context, [
      { kind: "statute", lawTitle: "민법", articles: [{ number: "598", branch: "0" }] },
    ]),
  ).rejects.toThrow("POLICY_REJECTED");
  expect(urls).toHaveLength(0);
  const output = await lookup.retrieve(context, [{ kind: "precedent", concept: "대여금" }]);
  expect(urls).toHaveLength(2);
  expect(urls[0]?.searchParams.get("query")).toBe("대여금");
  expect(urls[0]?.searchParams.get("datSrcNm")).toBe("대법원");
  expect(urls[1]?.searchParams.get("ID")).toBe("90000000201");
  expect(output.sourceRetrieval?.chunks[0]?.source.body).toContain("합성 전문");
  expect(output.sourceStatus).toBe("verified");
  expect(lookup.snapshot(0)).toMatchObject({
    requests: 2,
    verifiedSourceCount: 1,
    sourceFailures: [],
  });
  expect(context.facts).toHaveLength(3);
  for (const fact of context.facts) {
    expect(context.intake.narrative).toContain(fact.text);
    expect(fact.certainty).toBe("reported");
    expect(fact.references).toEqual([{ kind: "intake_narrative", intakeRevision: 1 }]);
  }
  for (const url of urls) {
    expect(url.origin).toBe("https://www.law.go.kr");
    expect(url.searchParams.get("target")).toBe("prec");
    expect(url.toString()).not.toContain("synthetic_comparison");
  }
});
