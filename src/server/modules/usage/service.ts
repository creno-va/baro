import { opaqueIdSchema } from "../../../contracts";
import {
  type V2OperationQuota,
  type V2Usage,
  v2CaseOriginalUsageSchema,
  v2FileProbeSchema,
  v2OperationQuotaSchema,
  v2UsageSchema,
} from "../../../contracts/v2";
import { createV2AccountingRepository } from "../../db/v2-accounting";
import { type Actor, actorSchema, createV2Core } from "../../db/v2-core";
import { createV2StorageRepository } from "../../db/v2-storage";
import { createPaidAvailability } from "../budget/availability";

export class UsageError extends Error {
  constructor(
    readonly code: "UNAUTHENTICATED" | "NOT_FOUND" | "USER_QUOTA_EXCEEDED" | "STORAGE_UNAVAILABLE",
  ) {
    super(code);
  }
}

/** A display/preflight decision; only guarded repository mutations reserve capacity. */
export function quotaWaitReason(usage: V2Usage, quota: V2OperationQuota) {
  const snapshot = v2UsageSchema.parse(usage);
  const operation = v2OperationQuotaSchema.parse(quota);
  if (operation.kind === "new_case" && snapshot.newCases.remaining < 1)
    return "daily_cases" as const;
  if (operation.kind === "visible_ai_response" && snapshot.aiResponses.remaining < 1)
    return "daily_ai_responses" as const;
  if (
    operation.kind === "media_processing" &&
    snapshot.mediaSeconds.remaining < operation.originalDurationSeconds
  )
    return "daily_media" as const;
  return null;
}

/** These queries read counters and ownership metadata, never private ciphertext. */
export function createUsageService(
  binding: D1Database,
  options: {
    environment: "preview" | "production";
    clock?: () => string;
    paidAvailable?: (now: string) => Promise<boolean>;
    budgetProofs?: (environment: "preview" | "production") => Promise<{
      pricingProofId: string;
      fundingProofId: string;
      allocationProofId: string;
    } | null>;
    processingAvailable?: () => Promise<boolean>;
  },
) {
  const core = createV2Core(binding, {
    async encrypt() {
      throw new Error("Counter service cannot encrypt private data");
    },
    async decrypt() {
      throw new Error("Counter service cannot decrypt private data");
    },
  });
  const accounting = createV2AccountingRepository(core, options.environment);
  const storage = createV2StorageRepository(core);
  const paidAvailable =
    options.paidAvailable ??
    createPaidAvailability(core, options.environment, {
      ...(options.clock ? { clock: options.clock } : {}),
      proofs: () => options.budgetProofs?.(options.environment) ?? Promise.resolve(null),
    });
  const actor = (ownerId: string): Actor =>
    actorSchema.parse({ ownerId, now: (options.clock ?? (() => new Date().toISOString()))() });
  async function requireAlive(a: Actor) {
    const found = await core
      .statement(
        "SELECT id FROM user WHERE id=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=user.id)",
        [a.ownerId],
      )
      .first<string>("id");
    if (!found) throw new UsageError("UNAUTHENTICATED");
  }
  async function requireWorkspace(a: Actor, workspaceId: string) {
    const found = await core
      .statement(
        "SELECT id FROM v2_workspaces WHERE id=? AND owner_id=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='workspace' AND target_id=v2_workspaces.id) OR (target_kind='account' AND target_id=v2_workspaces.owner_id))",
        [workspaceId, a.ownerId],
      )
      .first<string>("id");
    if (!found) throw new UsageError("NOT_FOUND");
  }
  async function accountSnapshot(a: Actor): Promise<V2Usage> {
    await requireAlive(a);
    const [usage, paid, capacity] = await Promise.all([
      accounting.usage(a),
      paidAvailable(a.now),
      options.processingAvailable?.() ?? Promise.resolve(true),
    ]);
    await requireAlive(a);
    const waitReasons: V2Usage["waitReasons"] = [];
    if (usage.newCases.remaining < 1) waitReasons.push("daily_cases");
    if (usage.aiResponses.remaining < 1) waitReasons.push("daily_ai_responses");
    if (usage.mediaSeconds.remaining <= 0) waitReasons.push("daily_media");
    if (usage.storageBytes.remaining < 1) waitReasons.push("account_storage");
    if (!paid) waitReasons.push("monthly_budget");
    if (!capacity) waitReasons.push("processing_capacity");
    return v2UsageSchema.parse({ ...usage, waitReasons });
  }
  return {
    async account(ownerId: string) {
      return accountSnapshot(actor(ownerId));
    },
    async caseOriginals(ownerId: string, workspaceId: string) {
      const a = actor(ownerId);
      opaqueIdSchema.parse(workspaceId);
      await requireAlive(a);
      const usage = await storage.caseUsage(a, workspaceId);
      await requireAlive(a);
      if (!usage) throw new UsageError("NOT_FOUND");
      await requireWorkspace(a, workspaceId);
      return v2CaseOriginalUsageSchema.parse(usage);
    },
    async preflightQuota(ownerId: string, quota: V2OperationQuota) {
      const usage = await accountSnapshot(actor(ownerId));
      return { usage, waitReason: quotaWaitReason(usage, quota) };
    },
    async preflightOriginal(ownerId: string, workspaceId: string, serverProbe: unknown) {
      // Caller is the trusted processor. A client MIME/declared duration is insufficient.
      const probe = v2FileProbeSchema.parse(serverProbe);
      const a = actor(ownerId);
      const usage = await accountSnapshot(a);
      const originals = await storage.caseUsage(a, opaqueIdSchema.parse(workspaceId));
      await requireAlive(a);
      if (!originals) throw new UsageError("NOT_FOUND");
      await requireWorkspace(a, workspaceId);
      const waits: V2Usage["waitReasons"] = [];
      if (usage.storageBytes.remaining < probe.byteLength) waits.push("account_storage");
      if (originals.count.remaining < 1 || originals.originalBytes.remaining < probe.byteLength)
        waits.push("case_original_storage");
      if (probe.category === "audio" || probe.category === "video") {
        const reason = quotaWaitReason(usage, {
          kind: "media_processing",
          originalDurationSeconds: probe.durationSeconds,
        });
        if (reason) waits.push(reason);
      }
      return { usage, originals: v2CaseOriginalUsageSchema.parse(originals), waitReasons: waits };
    },
  };
}
