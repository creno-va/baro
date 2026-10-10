import { expect, test } from "bun:test";
import {
  isWorkspacePublicQuery,
  workspaceRetrievalPlans,
} from "../src/server/modules/legal-retrieval/v2/workspace-plans";

test("legal lookup uses bounded public concepts and rejects private free-form queries", () => {
  expect(workspaceRetrievalPlans([{ kind: "precedent", concept: "임대차" }])).toEqual([
    { kind: "precedent", query: "임대차", limit: 1 },
  ]);
  expect(isWorkspacePublicQuery("근로기준법")).toBe(true);
  expect(isWorkspacePublicQuery("합성 사용자 거래 내역")).toBe(false);
  expect(() =>
    workspaceRetrievalPlans([{ kind: "precedent", concept: "합성 사용자 거래 내역" }]),
  ).toThrow();
});

test("workspace article limits reject omissions and guide keys resolve only server-owned IDs", () => {
  expect(() =>
    workspaceRetrievalPlans([
      {
        kind: "statute",
        lawTitle: "민법",
        articles: ["598", "600", "603"].map((number) => ({ number, branch: "0" })),
      },
    ]),
  ).toThrow();
  expect(
    workspaceRetrievalPlans([{ kind: "official_guide", guideKey: "legal_consultation" }])[0],
  ).toMatchObject({ kind: "official_guide", csmSeq: "734", cnpClsNo: "4" });
  expect(() =>
    workspaceRetrievalPlans([
      { kind: "official_guide", guideKey: "legal_consultation", csmSeq: "999" },
    ]),
  ).toThrow();
});
