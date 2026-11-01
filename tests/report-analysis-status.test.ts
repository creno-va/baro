import { expect, test } from "bun:test";
import { type V2LegalAnalysisSnapshot, v2ReportAnalysisStatus } from "../src/contracts/v2";

const confirmed: V2LegalAnalysisSnapshot["context"] = {
  casePurpose: "respond_to_claim",
  subjectContext: "company",
  procedure: { kind: "civil", stage: "first_instance", description: null },
};
const contexts: { name: string; context: typeof confirmed; readyStatus: "ready" | "partial" }[] = [
  { name: "confirmed response", context: confirmed, readyStatus: "ready" },
  {
    name: "unknown purpose",
    context: { ...confirmed, casePurpose: "unconfirmed" },
    readyStatus: "partial",
  },
  {
    name: "unknown proceeding",
    context: { ...confirmed, procedure: { ...confirmed.procedure, kind: "unconfirmed" } },
    readyStatus: "partial",
  },
  {
    name: "unknown stage",
    context: { ...confirmed, procedure: { ...confirmed.procedure, stage: "unconfirmed" } },
    readyStatus: "partial",
  },
  {
    name: "confirmed claim",
    context: { ...confirmed, casePurpose: "prepare_claim", subjectContext: "individual" },
    readyStatus: "ready",
  },
];
for (const { name, context, readyStatus } of contexts)
  for (const status of ["ready", "partial", "empty", "unavailable"] as const)
    test(`${name}: ${status} report display preserves unknowns and never upgrades source status`, () => {
      const snapshot = { status, context: structuredClone(context) };
      const before = structuredClone(snapshot);
      expect(v2ReportAnalysisStatus(snapshot)).toBe(status === "ready" ? readyStatus : status);
      expect(snapshot).toEqual(before);
    });
