import type {
  V2CaseContext,
  V2LegalAnalysisSnapshot,
  V2OfficialCitation,
  V2SourceClaim,
} from "../../../contracts/v2";
import type {
  V2ResolutionBasis,
  V2ResolutionCheck,
  V2ResolutionDocumentKind,
  V2ResolutionDraft,
  V2ResolutionDraftRequest,
  V2ResolutionState,
} from "../../../contracts/v2/resolution";

/** Server-owned, owner-authorized, current report projection. Never accept this from request JSON. */
export interface ResolutionSource {
  basis: V2ResolutionBasis | null;
  context: V2CaseContext;
  report: {
    id: string;
    revision: number;
    stale: boolean;
    selectedFileIds: string[];
    maskIdentifiers: boolean;
  } | null;
  stored: V2ResolutionState | null;
  facts: { id: string; text: string; confirmed: boolean; fileIds: string[] }[];
  files: { id: string; revision: number; contentHash: string; name: string; text: string }[];
  analysis: V2LegalAnalysisSnapshot | null;
  /** Only freshly revalidated, bound, independently audited official claims. */
  citations: V2OfficialCitation[];
  sourceClaims: V2SourceClaim[];
  procedureChecks: V2ResolutionCheck[];
  /** Loader-audited document/context support. A generic consultation guide is insufficient. */
  documentSupport: { documentKind: V2ResolutionDocumentKind; sourceClaimIds: string[] }[];
  /** Literal names/addresses/other private strings from the current authorized report. */
  maskingTokens: string[];
}
export interface ResolutionDependencies {
  load(ownerId: string, caseId: string): Promise<ResolutionSource>;
  /** Includes current owner/session/consent/deletion, source authority and semantic basis. */
  authorize(
    ownerId: string,
    caseId: string,
    basis: V2ResolutionBasis | null,
    mode: "read" | "write",
  ): Promise<boolean>;
  /** Encrypt and atomically compare revision AND basis/authorization in the final write. False means conflict. */
  saveCAS(
    ownerId: string,
    caseId: string,
    input: { expectedRevision: number; basis: V2ResolutionBasis | null; state: V2ResolutionState },
  ): Promise<boolean>;
  now(): string;
  newId(): string;
  guideHosts: readonly string[];
  /** Optional existing gateway job: durable attempts/lease/AI200 + independent audit; never a direct SDK call. */
  auditedDraft?: (input: {
    source: ResolutionSource;
    request: V2ResolutionDraftRequest;
    template: V2ResolutionDraft;
  }) => Promise<V2ResolutionDraft>;
}
