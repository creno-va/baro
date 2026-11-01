import type { V2ResolutionState } from "../../src/contracts/v2/resolution";
import { createResolutionService } from "../../src/server/modules/resolution/service";
import type {
  ResolutionDependencies,
  ResolutionSource,
} from "../../src/server/modules/resolution/types";
import fixture from "../fixtures/resolution/material-selection.json";

export const resolutionNow = "2026-11-01T10:00:00.000Z";
export function resolutionSource(): ResolutionSource {
  const context = {
    casePurpose: "prepare_claim" as const,
    subjectContext: "individual" as const,
    procedure: { kind: "civil" as const, stage: "before_filing" as const, description: null },
  };
  const basis = {
    researchRevision: 1,
    summaryRevision: 1,
    evidenceHash: "a".repeat(64),
    casePurpose: context.casePurpose,
    workspaceRevision: 3,
    analysisId: "analysis",
    reportId: "report",
    reportRevision: 1,
    procedure: context.procedure,
  };
  return {
    basis,
    context,
    report: {
      id: "report",
      revision: 1,
      stale: false,
      selectedFileIds: ["selected-file"],
      maskIdentifiers: true,
    },
    stored: null,
    facts: structuredClone(fixture.facts),
    files: fixture.files.map((file) => ({ ...file, contentHash: "b".repeat(64) })),
    analysis: null,
    citations: [],
    sourceClaims: [],
    procedureChecks: [],
    documentSupport: [],
    maskingTokens: ["합성 당사자 이름"],
  };
}
export function resolutionHarness(initial = resolutionSource()) {
  let source = initial,
    access = true,
    consent = true,
    count = 0;
  const writes: V2ResolutionState[] = [];
  const deps: ResolutionDependencies = {
    load: async () => structuredClone(source),
    authorize: async (owner, _case, _basis, mode) =>
      owner === "owner" && access && (mode === "read" || consent),
    saveCAS: async (_owner, _case, { expectedRevision, state }) => {
      if (!access || !consent || (source.stored?.revision ?? 1) !== expectedRevision) return false;
      source = { ...source, stored: structuredClone(state) };
      writes.push(state);
      return true;
    },
    now: () => resolutionNow,
    newId: () => `draft-${++count}`,
    guideHosts: ["www.easylaw.go.kr"],
  };
  return {
    service: createResolutionService(deps),
    deps,
    writes,
    get source() {
      return source;
    },
    set source(next: ResolutionSource) {
      source = next;
    },
    setAccess: (next: boolean) => {
      access = next;
    },
    setConsent: (next: boolean) => {
      consent = next;
    },
  };
}
export function resolutionMutation(state: V2ResolutionState) {
  return {
    expectedRevision: state.revision,
    reportId: state.basis?.reportId ?? "report",
    reportRevision: state.basis?.reportRevision ?? 1,
  };
}
