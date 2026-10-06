import type { WorkflowStep } from "cloudflare:workers";
import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { opaqueIdSchema, revisionSchema, timestampSchema } from "../../../contracts";
import type { V2Core } from "../../db/v2-core";
import { hex } from "../files/binary";
import { createLawyerPublicationService, type PublicationDependencies } from "./publication";
import { LawyerError } from "./service";

export const profilePublicationParamsSchema = z.strictObject({
  outboxId: opaqueIdSchema,
  profileId: opaqueIdSchema,
  approvedRevision: revisionSchema,
  operationId: opaqueIdSchema,
});
export type ProfilePublicationParams = z.infer<typeof profilePublicationParamsSchema>;
export function profilePublicationInstanceId(input: ProfilePublicationParams) {
  const p = profilePublicationParamsSchema.parse(input);
  return `profile-publish-${hex(sha256(new TextEncoder().encode(JSON.stringify([p.outboxId, p.approvedRevision]))))}`;
}

export async function runProfilePublicationSteps(
  execution: ReturnType<typeof createProfilePublicationExecution>,
  step: Pick<WorkflowStep, "do">,
) {
  const config = {
    retries: { limit: 0, delay: "1 second" as const },
    timeout: "5 minutes" as const,
  };
  const initial = await step.do("verify approved sources", config, () => execution.initialize());
  if (initial.status !== "ready") return initial;
  for (let index = 0; index < initial.assetCount; index++) {
    const result = await step.do(`copy approved asset ${index}`, config, () =>
      execution.copyAsset(index),
    );
    if (result.status !== "copied") return result;
  }
  return step.do("publish approved profile", config, () => execution.finalize());
}
export type PublicationStepResult =
  | { status: "ready"; assetCount: number }
  | { status: "copied" }
  | { status: "published" }
  | { status: "pending"; reason: "capability_unavailable" | "copy_unverified" }
  | { status: "stopped" };

export function createProfilePublicationExecution(
  core: V2Core,
  deps: PublicationDependencies,
  input: ProfilePublicationParams,
  instanceId: string,
) {
  const params = profilePublicationParamsSchema.parse(input);
  if (instanceId !== profilePublicationInstanceId(params)) throw new LawyerError("NOT_FOUND");
  const publication = createLawyerPublicationService(core, deps);
  const now = () =>
    new Date(
      timestampSchema.parse((deps.clock ?? (() => new Date().toISOString()))()),
    ).toISOString();
  const current = async () =>
    core
      .statement(
        "SELECT p.owner_id FROM v2_outbox outbox JOIN v2_operations operation ON operation.id=outbox.operation_id JOIN v2_profiles p ON p.id=outbox.target_id AND p.owner_id=operation.owner_id JOIN v2_profile_revisions revision ON revision.profile_id=p.id AND revision.revision=outbox.revision WHERE outbox.id=? AND outbox.kind='profile_publish' AND outbox.target_id=? AND outbox.revision=? AND outbox.operation_id=? AND outbox.attempts>0 AND (outbox.state='dispatched' OR (outbox.state IN ('pending','failed') AND outbox.next_attempt_at>?)) AND revision.status='approved' AND EXISTS(SELECT 1 FROM v2_moderation_decisions WHERE target_kind='profile' AND target_id=revision.id AND target_revision=revision.revision AND decision='approve') AND NOT EXISTS(SELECT 1 FROM v2_profile_revisions newer WHERE newer.profile_id=p.id AND newer.status='approved' AND newer.revision>revision.revision) AND EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=p.owner_id AND role='verified_lawyer') AND EXISTS(SELECT 1 FROM v2_applications WHERE id=revision.application_id AND owner_id=p.owner_id AND status='approved') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=p.owner_id) OR (target_kind='profile' AND target_id=p.id))",
        [params.outboxId, params.profileId, params.approvedRevision, params.operationId, now()],
      )
      .first<{ owner_id: string }>();
  const stopped = (error: unknown): PublicationStepResult => {
    if (error instanceof LawyerError && error.code === "PROCESSING_UNAVAILABLE")
      return { status: "pending", reason: "capability_unavailable" };
    if (
      error instanceof LawyerError &&
      ["NOT_FOUND", "REVIEW_REQUIRED", "STALE_REVISION"].includes(error.code)
    )
      return { status: "stopped" };
    // Transport, receipt and persistence failure never become a paid/R2 retry.
    return { status: "pending", reason: "copy_unverified" };
  };
  return {
    async initialize(): Promise<PublicationStepResult> {
      try {
        const row = await current();
        if (!row) return { status: "stopped" };
        const ids = await publication.approvedAssetIds(
          row.owner_id,
          params.profileId,
          params.approvedRevision,
        );
        z.array(opaqueIdSchema).min(1).max(31).parse(ids);
        return { status: "ready", assetCount: ids.length };
      } catch (error) {
        return stopped(error);
      }
    },
    async copyAsset(index: number): Promise<PublicationStepResult> {
      z.number().int().min(0).max(30).parse(index);
      try {
        const row = await current();
        if (!row) return { status: "stopped" };
        const ids = await publication.approvedAssetIds(
          row.owner_id,
          params.profileId,
          params.approvedRevision,
        );
        const assetId = ids[index];
        if (!assetId) return { status: "stopped" };
        await publication.copyApprovedAsset(
          row.owner_id,
          params.profileId,
          params.approvedRevision,
          assetId,
        );
        return { status: "copied" };
      } catch (error) {
        return stopped(error);
      }
    },
    async finalize(): Promise<PublicationStepResult> {
      try {
        const row = await current();
        if (!row) return { status: "stopped" };
        await publication.finalize(row.owner_id, params.profileId, params.approvedRevision);
        return { status: "published" };
      } catch (error) {
        return stopped(error);
      }
    },
  };
}
