import { opaqueIdSchema } from "../../../contracts/common";
import {
  type V2ResolutionBasis,
  v2ResolutionStateForGuidesSchema,
} from "../../../contracts/v2/resolution";
import { aliveWorkspace, type V2Core, type WorkspaceGuard } from "../../db/v2-core";
import {
  createV2ReworkRepository,
  type ReworkWriteGuard,
  reworkConsentGuard,
} from "../../db/v2-rework";
import type { JobLease } from "../../db/v2-workspace";
import { ResolutionError } from "./service";
import type { ResolutionDependencies, ResolutionSource } from "./types";

export interface ResolutionRuntimeDependencies {
  /** Read-only owner-authorized projection. Must not create reports or dispatch analysis. */
  loadSource(ownerId: string, caseId: string): Promise<Omit<ResolutionSource, "stored">>;
  /** Fresh session/owner and semantic basis checks are supplied by the root runtime. */
  authorize: ResolutionDependencies["authorize"];
  /** Trusted source/report/context authority SQL, evaluated in the same final publication claim. */
  publicationAuthority(
    ownerId: string,
    caseId: string,
    basis: V2ResolutionBasis | null,
  ): Promise<ReworkWriteGuard | ((now: string) => ReworkWriteGuard)>;
  /** Root-bound idempotency receipt statements. Each must use sqlClaim with this claimId. */
  publicationStatements?(
    claimId: string,
    recordId: string,
    recordRevision: number,
  ): D1PreparedStatement[];
  now(): string;
  guideHosts: readonly string[];
  newId?: () => string;
  /** Trusted current worker lease only. Without it the repository requires no active writer job. */
  lease?: JobLease;
  auditedDraft?: ResolutionDependencies["auditedDraft"];
}

/** The public state revision and immutable record revision are intentionally separate counters. */
export function createResolutionRuntimeAdapter(
  core: V2Core,
  deps: ResolutionRuntimeDependencies,
): ResolutionDependencies {
  const records = createV2ReworkRepository(core, { clock: deps.now });
  const schema = v2ResolutionStateForGuidesSchema(deps.guideHosts);
  async function owned(
    ownerId: string,
    caseId: string,
    mode: "read" | "write",
  ): Promise<WorkspaceGuard | null> {
    opaqueIdSchema.parse(ownerId);
    opaqueIdSchema.parse(caseId);
    const consent = reworkConsentGuard(ownerId);
    const row = await core
      .statement(
        `SELECT w.revision FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace} AND (${mode === "write" ? consent.sql : "1"})`,
        [caseId, ownerId, ...(mode === "write" ? consent.values : [])],
      )
      .first<{ revision: number }>();
    return row
      ? { ownerId, workspaceId: caseId, expectedRevision: row.revision, now: deps.now() }
      : null;
  }
  const authorize: ResolutionDependencies["authorize"] = async (ownerId, caseId, basis, mode) =>
    (await deps.authorize(ownerId, caseId, basis, mode)) && !!(await owned(ownerId, caseId, mode));
  const read = (ownerId: string, caseId: string) =>
    records.read({ ownerId, now: deps.now() }, caseId, "resolution", caseId, schema);
  return {
    authorize,
    now: deps.now,
    newId: deps.newId ?? (() => crypto.randomUUID()),
    guideHosts: deps.guideHosts,
    ...(deps.auditedDraft ? { auditedDraft: deps.auditedDraft } : {}),
    async load(ownerId, caseId) {
      if (!(await authorize(ownerId, caseId, null, "read"))) throw new ResolutionError("NOT_FOUND");
      const [source, stored] = await Promise.all([
        deps.loadSource(ownerId, caseId),
        read(ownerId, caseId),
      ]);
      if (!(await authorize(ownerId, caseId, source.basis, "read")))
        throw new ResolutionError("NOT_FOUND");
      return { ...source, stored: stored?.value ?? null };
    },
    async saveCAS(ownerId, caseId, input) {
      const state = schema.parse(input.state);
      if (
        state.revision !== input.expectedRevision + 1 ||
        !(await authorize(ownerId, caseId, input.basis, "write"))
      )
        return false;
      const previous = await read(ownerId, caseId);
      if ((previous?.value.revision ?? 1) !== input.expectedRevision) return false;
      const authority = await deps.publicationAuthority(ownerId, caseId, input.basis);
      if (!(await authorize(ownerId, caseId, input.basis, "write"))) return false;
      const guard = await owned(ownerId, caseId, "write");
      if (!guard) return false;
      const written = await records.write(guard, {
        kind: "resolution",
        entityId: caseId,
        expectedVersion: previous?.revision ?? 0,
        value: state,
        schema,
        authority,
        bumpWorkspace: false,
        ...(deps.publicationStatements ? { statements: deps.publicationStatements } : {}),
        ...(deps.lease ? { lease: deps.lease } : {}),
      });
      return written !== null;
    },
  };
}
