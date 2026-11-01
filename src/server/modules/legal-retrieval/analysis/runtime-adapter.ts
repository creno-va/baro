import { timestampSchema } from "../../../../contracts/common";
import { guardSchema, type V2Core, type WorkspaceGuard } from "../../../db/v2-core";
import { createV2OfficialSourceRepository } from "../../../db/v2-official-sources";
import { invocationIdSchema } from "../../llm-gateway/attempts";
import { workspaceModelInput } from "../../workspace/pipeline";
import { createWorkspaceSourceAuthorization } from "../v2/authorization";
import { BOUND_SOURCE_BATCH_SIZE, readBoundSourceBatch } from "../v2/bound-sources";
import { type Access, type SourceChunk, safePermit } from "../v2/contracts";
import { GUIDE_HOSTS } from "../v2/registry";
import { createV2LegalRetrieval } from "../v2/service";
import type { Transport } from "../v2/transport";
import { type LegalAnalysisInput, legalAnalysisInputSchema } from "./context";
import { analysisPrecedentDiscovery } from "./discovery";
import { createAutomaticLegalAnalysis, LegalAnalysisError } from "./service";

// Central llm-gateway owns registration, schemas, LOW generation/MEDIUM audit,
// native wire, timeout and the existing paid attempt ledger for these phases.
export type LegalAnalysisGatewayPhase =
  | "workspace_legal_plan"
  | "workspace_legal_analysis"
  | "workspace_legal_audit";
export type LegalAnalysisRuntimeDependencies = {
  core: V2Core;
  env: Pick<Env, "LAW_API_OC">;
  guard: WorkspaceGuard;
  requestId: string;
  gateway: {
    /** Same six-argument signature as createLlmGateway().call; no direct AI access. */
    call(
      phase: LegalAnalysisGatewayPhase,
      input: unknown,
      requestId: string,
      reserve: () => Promise<boolean>,
      reserveCorrection: () => Promise<boolean>,
      invocationId: string,
    ): Promise<unknown>;
  };
  modelAdmission: {
    /** Root supplies the durable phase identity, including replay; never synthesized here. */
    invocationId(phase: LegalAnalysisGatewayPhase): string;
    reserve(
      phase: LegalAnalysisGatewayPhase,
      input: unknown,
      invocationId: string,
    ): Promise<boolean>;
    reserveCorrection(
      phase: LegalAnalysisGatewayPhase,
      input: unknown,
      invocationId: string,
    ): Promise<boolean>;
  };
  /** Root owns current role, confirmed summary, job/lease/attempt and scope guards. */
  authorize: () => Promise<boolean>;
  reserveRequest: Access["reserveRequest"];
  /** Trusted current-case bound-source reader; receives at most four IDs. */
  readBoundSources?: (ids: readonly string[], now: string) => Promise<(SourceChunk | null)[]>;
  clock?: () => string;
  signal?: AbortSignal;
  transport?: Transport;
};

/** One admitted job: real official cache/binding + native gateway callbacks.
 * Only existing public cache/citation-binding writes occur here. Root retains
 * analysis persistence, dispatch, quota, paid admission and final atomic publication. */
export function createLegalAnalysisRuntimeAdapter(deps: LegalAnalysisRuntimeDependencies) {
  const parsedGuard = guardSchema.safeParse(deps.guard);
  if (!parsedGuard.success || !/^[A-Za-z0-9_-]{1,128}$/.test(deps.requestId))
    throw new LegalAnalysisError("INVALID_INPUT");
  const baseGuard = parsedGuard.data;
  const clock = () => {
    const now = timestampSchema.safeParse((deps.clock ?? (() => new Date().toISOString()))());
    if (!now.success) throw new LegalAnalysisError("INVALID_INPUT");
    return new Date(now.data).toISOString();
  };
  const guard = () => ({ ...baseGuard, now: clock() });
  const authorize = async () => {
    if (deps.signal?.aborted || !(await safePermit(deps.authorize))) return false;
    // Even an incorrectly permissive outer callback cannot grant another case's
    // bindings or bypass current policy consent/revision/deletion checks.
    return safePermit(createWorkspaceSourceAuthorization(deps.core.binding, guard()));
  };
  const permit = async () => {
    if (deps.signal?.aborted) throw new LegalAnalysisError("CANCELLED");
    if (!(await authorize())) throw new LegalAnalysisError("NOT_AUTHORIZED");
    if (deps.signal?.aborted) throw new LegalAnalysisError("CANCELLED");
  };
  const ids = new Map<LegalAnalysisGatewayPhase, string>();
  async function call(phase: LegalAnalysisGatewayPhase, raw: unknown) {
    await permit();
    // The reservation planner and actual dispatch must see the same projection.
    // Supplier IDs are not promulgation numbers; proof originals stay server-side.
    const input = workspaceModelInput(raw);
    let invocationId = ids.get(phase);
    if (!invocationId) {
      try {
        invocationId = deps.modelAdmission.invocationId(phase);
      } catch {
        throw new LegalAnalysisError("INVALID_INPUT");
      }
      if (!invocationIdSchema.test(invocationId)) throw new LegalAnalysisError("INVALID_INPUT");
      ids.set(phase, invocationId);
    }
    const identity = invocationId;
    const reserve = (correction: boolean) => async () => {
      if (!(await authorize())) return false;
      const admitted = await safePermit(() =>
        correction
          ? deps.modelAdmission.reserveCorrection(phase, input, identity)
          : deps.modelAdmission.reserve(phase, input, identity),
      );
      // Root reservation/lease renewal yields to revocation; the final guard
      // precedes provider dispatch and does not release an ambiguous paid hold.
      return admitted && authorize();
    };
    const output = await deps.gateway.call(
      phase,
      input,
      deps.requestId,
      reserve(false),
      reserve(true),
      identity,
    );
    await permit();
    return output;
  }
  const sources = createV2OfficialSourceRepository(deps.core, GUIDE_HOSTS);
  const readBound = async (sourceIds: readonly string[], now: string) => {
    await permit();
    const chunks: (SourceChunk | null)[] = [];
    for (let offset = 0; offset < sourceIds.length; offset += BOUND_SOURCE_BATCH_SIZE) {
      await permit();
      const batch = sourceIds.slice(offset, offset + BOUND_SOURCE_BATCH_SIZE);
      let result: (SourceChunk | null)[];
      try {
        result = deps.readBoundSources
          ? await deps.readBoundSources(batch, now)
          : await readBoundSourceBatch(deps.core, baseGuard.workspaceId, batch, now, GUIDE_HOSTS);
      } catch {
        await permit();
        throw new LegalAnalysisError("SOURCE_UNAVAILABLE");
      }
      if (result.length !== batch.length) return sourceIds.map(() => null);
      chunks.push(...result);
      await permit();
    }
    await permit();
    const current = Date.parse(clock());
    return chunks.map((chunk) =>
      chunk && Date.parse(chunk.source.expiresAt) > current ? chunk : null,
    );
  };
  let service: ReturnType<typeof createAutomaticLegalAnalysis> | undefined;
  return {
    async prepare(raw: LegalAnalysisInput) {
      await permit();
      const input = legalAnalysisInputSchema.safeParse(raw);
      if (!input.success) throw new LegalAnalysisError("INVALID_INPUT");
      if (!service) {
        const retrieval = createV2LegalRetrieval(deps.env, sources, {
          ...(deps.transport ? { transport: deps.transport } : {}),
          precedentDiscovery: analysisPrecedentDiscovery(input.data),
          bindCitation: async (citation) =>
            (await authorize()) && sources.bindCitation(guard(), citation),
        });
        service = createAutomaticLegalAnalysis({
          model: {
            plan: (value) => call("workspace_legal_plan", value),
            analyze: (value) => call("workspace_legal_analysis", value),
            audit: (value) => call("workspace_legal_audit", value),
          },
          retrieve: (request, access) => retrieval.retrieve(request, access),
          readBoundSources: readBound,
          authorize,
          reserveRequest: deps.reserveRequest,
          clock,
          guideHosts: GUIDE_HOSTS,
          ...(deps.signal ? { signal: deps.signal } : {}),
        });
      }
      return service.prepare(input.data);
    },
  };
}
