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
