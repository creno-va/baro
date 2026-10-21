import { createCaseDataCipher } from "../../crypto";
import { createV2Core, type V2Core } from "../../db/v2-core";
import { createV2DeletionRepository } from "../../db/v2-deletion";
import { createV2StorageRepository } from "../../db/v2-storage";
import { authorizeBlobCleanup, createStorageMaintenance } from "../budget/storage-maintenance";
import { isNamedNativeRuntime } from "../file-processing/native-identity";
import type { PrivateBucket } from "../files/service";
import { type CleanupWorkflow, deleteWorkflowInstance } from "./workflow-cleanup";
import { provesWorkspaceOnlyCleanup } from "./workspace-cleanup-proof";

const cleanupReasons = [
  "CLEANUP_BINDING_UNAVAILABLE",
  "CLEANUP_LEGACY_RUNTIME_PROOF_REQUIRED",
  "CLEANUP_INVENTORY_INVALID",
  "CLEANUP_BUCKET_UNAVAILABLE",
  "CLEANUP_WRITER_OR_BUDGET_PENDING",
  "CLEANUP_FENCED",
  "CLEANUP_OBJECT_REMAINS",
  "CLEANUP_INVENTORY_PENDING",
  "CLEANUP_WORKFLOW_RESPONSE_INVALID",
] as const;
type CleanupStage =
  | "unknown"
  | "native_revoke"
  | "workflow_get"
  | "workflow_delete"
  | "r2_delete"
  | "r2_head"
  | "inventory_sql";
type CleanupNamespace = "unknown" | "file" | "asset" | "workspace" | "profile";
type ObserveStop = <T>(stage: CleanupStage, work: () => Promise<T>) => Promise<T>;
type CleanupErrorDetails = {
  errorShape: "error" | "non_error";
  errorName: "Error" | "TypeError" | "WorkflowError" | "other";
  messageClass:
    | "instance_missing_exact"
    | "instance_missing_wrapped"
    | "instance_missing_marker"
    | "workflow_missing_marker"
    | "invalid_identifier_marker"
    | "request_limit_marker"
    | "network_marker"
    | "internal_marker"
    | "other";
  codeClass: "absent" | "numeric" | "other" | "unreadable";
  httpStatus: number | null;
};
const unreadable = Symbol("unreadable");
function errorField(error: unknown, field: "name" | "message" | "code" | "status"): unknown {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return undefined;
  try {
    return Reflect.get(error, field);
  } catch {
    return unreadable;
  }
}
function isError(error: unknown): error is Error {
  try {
    return error instanceof Error;
  } catch {
    return false;
  }
}
/** Fixed diagnostic labels only. A marker is never an absence receipt. */
function cleanupMessageClass(message: unknown): CleanupErrorDetails["messageClass"] {
  if (message === "instance.not_found") return "instance_missing_exact";
  if (message === "(instance.not_found) Instance does not exist") return "instance_missing_wrapped";
  if (typeof message !== "string" || message.length > 4096) return "other";
  const text = message.toLowerCase();
  if (text.includes("instance.not_found") || text.includes("instance does not exist"))
    return "instance_missing_marker";
  if (text.includes("workflow.not_found")) return "workflow_missing_marker";
  if (
    text.includes("invalid id") ||
    text.includes("invalid_id") ||
    text.includes("invalid identifier")
  )
    return "invalid_identifier_marker";
  if (text.includes("too many subrequests") || text.includes("too many api requests"))
    return "request_limit_marker";
  if (text.includes("network connection") || text.includes("network error"))
    return "network_marker";
  if (text.includes("internal error")) return "internal_marker";
  return "other";
}
/** Diagnostics only. Never infer a missing instance from a wrapped message.
 * The exact wrapped form comes from pinned Miniflare's createWorkflowError;
 * neither arbitrary prefixes/suffixes nor user data are included in the output. */
export function cleanupErrorDetails(error: unknown): CleanupErrorDetails {
  const name = errorField(error, "name"),
    message = errorField(error, "message"),
    code = errorField(error, "code"),
    status = errorField(error, "status");
  return {
    errorShape: isError(error) ? "error" : "non_error",
    errorName:
      name === "Error" || name === "TypeError" || name === "WorkflowError" ? name : "other",
    messageClass: cleanupMessageClass(message),
    codeClass:
      code === unreadable
        ? "unreadable"
        : code === undefined
          ? "absent"
          : typeof code === "number" && Number.isFinite(code)
            ? "numeric"
            : "other",
    httpStatus:
      typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
        ? status
        : null,
  };
}
export type CleanupFailureEvent = {
  event: "v2_deletion_cleanup_failed";
  environment: "preview" | "production";
  reason: (typeof cleanupReasons)[number] | "CLEANUP_DEPENDENCY_UNAVAILABLE";
  attempts: number;
  ageSeconds: number;
  stage: CleanupStage;
  namespace: CleanupNamespace;
} & CleanupErrorDetails;
function reportCleanupFailure(event: CleanupFailureEvent) {
  console.error(
    JSON.stringify({
      event: "v2_deletion_cleanup_failed",
      environment: event.environment,
      reason: event.reason,
      attempts: event.attempts,
      ageSeconds: event.ageSeconds,
      stage: event.stage,
      namespace: event.namespace,
      errorShape: event.errorShape,
      errorName: event.errorName,
      messageClass: event.messageClass,
      codeClass: event.codeClass,
      httpStatus: event.httpStatus,
    }),
  );
}
/** Only versioned attempts and explicitly named probes have recoverable identity.
 * Stopping an empty named instance cannot prove an older random one is gone. */
export async function revokeNamedProcessor(binding: Env["FILE_PROCESSOR"] | undefined, id: string) {
  if (!isNamedNativeRuntime(id)) throw new Error("CLEANUP_LEGACY_RUNTIME_PROOF_REQUIRED");
  if (!binding) throw new Error("CLEANUP_BINDING_UNAVAILABLE");
  await binding.get(binding.idFromName(id)).revoke();
}
export type { CleanupWorkflow } from "./workflow-cleanup";
export type DeletionCleanupDependencies = {
  environment: "preview" | "production";
  privateBucket?: PrivateBucket;
  publicBucket?: PrivateBucket;
  /** All namespaces are required because the durable inventory retains runtime IDs after cascade deletion. */
  workflows: readonly (CleanupWorkflow | undefined)[];
  legacyWorkflow?: CleanupWorkflow;
  stopNative?: (runtimeId: string) => Promise<void>;
  /** Coordinator receipt for legacy/unknown runtime IDs. Absence from Workflow
   * namespaces alone cannot prove that an older Container probe has stopped. */
  confirmLegacyJob?: (runtimeId: string) => Promise<boolean>;
  onFailure?: (event: CleanupFailureEvent) => void;
  clock?: () => string;
  testOnlyUnmeteredStorage?: true;
};
/** Only an exact structured deletion/absence result is a receipt. All thrown
 * errors, including missing-instance messages, retain the target for retry. */
async function stop(binding: CleanupWorkflow | undefined, id: string, observe: ObserveStop) {
  return observe("workflow_delete", () => deleteWorkflowInstance(binding, id));
}
export function createV2DeletionReconciler(core: V2Core, deps: DeletionCleanupDependencies) {
  const now = deps.clock ?? (() => new Date().toISOString());
  const deletion = createV2DeletionRepository(core),
    storage = createV2StorageRepository(core);
  const maintenance = createStorageMaintenance(core, deps.environment, now);
  const test = deps.environment === "preview" && deps.testOnlyUnmeteredStorage === true;
  if (deps.testOnlyUnmeteredStorage && !test) throw new Error("CLEANUP_TEST_COMPOSITION_INVALID");
  return {
    async run(limit = 4) {
      const result = { acquired: 0, completed: 0, retry: 0 };
      for (const journal of await deletion.pending(now(), limit)) {
        const started = now();
        const lease = await deletion.acquire(
          journal.id,
          crypto.randomUUID(),
          started,
          new Date(Date.parse(started) + 60000).toISOString(),
        );
        if (!lease) continue;
        result.acquired++;
        let failure: CleanupFailureEvent["reason"] | undefined;
        let stage: CleanupStage = "unknown",
          namespace: CleanupNamespace = "unknown";
        let details: CleanupErrorDetails | undefined;
        const observe = async <T>(
          at: CleanupStage,
          scope: CleanupNamespace,
          work: () => Promise<T>,
        ): Promise<T> => {
          try {
            return await work();
          } catch (error) {
            stage = at;
            namespace = scope;
            details = cleanupErrorDetails(error);
            throw error;
          }
        };
        const inventory = <T>(work: () => Promise<T>) => observe("inventory_sql", "unknown", work);
        const stopWorkflow = (
          binding: CleanupWorkflow | undefined,
          id: string,
          scope: CleanupNamespace,
        ) => stop(binding, id, (at, work) => observe(at, scope, work));
        try {
          // Work per invocation is bounded. Receipts and remaining targets survive
          // lease expiry, partial transport failures and another scheduler's replay.
          for (const target of await inventory(() => deletion.targets(lease, now(), 8))) {
            if (target.kind === "job" || target.kind === "legacy_workflow") {
              if (target.kind === "legacy_workflow")
                await stopWorkflow(deps.legacyWorkflow, target.target_id, "unknown");
              else if (!/^report-local-[a-f0-9-]{36}-1$/.test(target.target_id)) {
                const named = isNamedNativeRuntime(target.target_id);
                if (named) {
                  const stopNative = deps.stopNative;
                  if (!stopNative) throw new Error("CLEANUP_BINDING_UNAVAILABLE");
                  // Revoke first: a Workflow may already have dispatched a late
                  // native request, or may outlive a failed Workflow deletion.
                  await observe("native_revoke", "unknown", () => stopNative(target.target_id));
                }
                const probe =
                  named && /^(?:(?:native-v1-)?probe|native-v1-report)-/.test(target.target_id);
                if (!probe) {
                  if (deps.workflows.length !== 4) throw new Error("CLEANUP_BINDING_UNAVAILABLE");
                  let observed = false;
                  let nativeObserved = false;
                  for (const [index, binding] of deps.workflows.entries()) {
                    const scope =
                      (["file", "asset", "workspace", "profile"] as const)[index] ?? "unknown";
                    const found = await stopWorkflow(binding, target.target_id, scope);
                    observed = found || observed;
                    nativeObserved = (index < 2 && found) || nativeObserved;
                  }
                  if (
                    !named &&
                    (!observed || nativeObserved || /^file-processing-/.test(target.target_id)) &&
                    !(
                      !observed &&
                      !nativeObserved &&
                      journal.target_kind === "workspace" &&
                      (await inventory(() =>
                        provesWorkspaceOnlyCleanup(
                          core,
                          lease,
                          target.target_id,
                          deps.environment,
                          now,
                        ),
                      ))
                    ) &&
                    !(await deps.confirmLegacyJob?.(target.target_id))
                  )
                    throw new Error("CLEANUP_LEGACY_RUNTIME_PROOF_REQUIRED");
                }
              }
              // Local report jobs never invoke a Workflow. Their running R2 writer
              // is independently fenced below; a cancelled lease cannot send new I/O.
              if (
                !(await inventory(() =>
                  deletion.recordReceipt(lease, {
                    kind: target.kind,
                    targetId: target.target_id,
                    receiptId: crypto.randomUUID(),
                    now: now(),
                  }),
                ))
              )
                throw new Error("CLEANUP_FENCED");
            } else if (target.kind === "blob") {
              const blob = await inventory(() =>
                core
                  .statement(
                    "SELECT visibility,object_key,cipher_hash,state FROM v2_blobs WHERE id=?",
                    [target.target_id],
                  )
                  .first<{
                    visibility: string;
                    object_key: string;
                    cipher_hash: string | null;
                    state: string;
                  }>(),
              );
              if (!blob || blob.object_key !== target.object_key)
                throw new Error("CLEANUP_INVENTORY_INVALID");
              if (blob.state === "deleted") {
                if (
                  !(await inventory(() =>
                    deletion.recordReceipt(lease, {
                      kind: "blob",
                      targetId: target.target_id,
                      receiptId: crypto.randomUUID(),
                      now: now(),
                    }),
                  ))
                )
                  throw new Error("CLEANUP_FENCED");
                continue;
              }
              const prefix = blob.visibility === "public" ? "public" : "private";
              const bucket = blob.visibility === "public" ? deps.publicBucket : deps.privateBucket;
              if (!bucket || !new RegExp(`^${prefix}/[A-Za-z0-9_-]{1,128}$`).test(blob.object_key))
                throw new Error("CLEANUP_BUCKET_UNAVAILABLE");
              const authorize = () =>
                inventory(
                  async () =>
                    (await authorizeBlobCleanup(
                      core,
                      lease,
                      target.target_id,
                      blob.object_key,
                      now(),
                    )) &&
                    !(await core
                      .statement(
                        "SELECT 1 FROM v2_deletion_targets b JOIN v2_deletion_targets jobs ON jobs.journal_id=b.journal_id WHERE b.kind='blob' AND b.target_id=? AND jobs.kind IN ('job','legacy_workflow') AND jobs.state='pending' LIMIT 1",
                        [target.target_id],
                      )
                      .first()),
                );
              if (
                !(await authorize()) ||
                (!test &&
                  !(await maintenance.admit(
                    target.target_id,
                    blob.object_key,
                    "delete",
                    authorize,
                  )))
              )
                throw new Error("CLEANUP_WRITER_OR_BUDGET_PENDING");
              await observe("r2_delete", "unknown", () => bucket.delete(blob.object_key));
              if (
                !(await authorize()) ||
                (!test &&
                  !(await maintenance.admit(target.target_id, blob.object_key, "head", authorize)))
              )
                throw new Error("CLEANUP_FENCED");
              if (await observe("r2_head", "unknown", () => bucket.head(blob.object_key)))
                throw new Error("CLEANUP_OBJECT_REMAINS");
              if (
                !(await inventory(() =>
                  storage.confirmBlobDeleted(target.target_id, now(), {
                    lease,
                    receiptId: crypto.randomUUID(),
                    objectKey: blob.object_key,
                    cipherHash: blob.cipher_hash,
                  }),
                ))
              )
                throw new Error("CLEANUP_FENCED");
            } else {
              // SQL checks the complete retained blob inventory, including late
              // arrivals, and that every job/blob target has an earlier receipt.
              if (
                !(await inventory(() =>
                  storage.confirmEmptyReservation(lease, {
                    receiptId: crypto.randomUUID(),
                    reservationId: target.target_id,
                    now: now(),
                    inventoryVerified: true,
                  }),
                ))
              )
                throw new Error("CLEANUP_INVENTORY_PENDING");
            }
          }
          if (await inventory(() => deletion.finish(lease, now()))) {
            result.completed++;
            continue;
          }
        } catch (error) {
          // Never log provider errors, IDs, keys, SQL or payloads.
          const message = isError(error) ? errorField(error, "message") : undefined;
          failure = cleanupReasons.some((reason) => reason === message)
            ? (message as CleanupFailureEvent["reason"])
            : "CLEANUP_DEPENDENCY_UNAVAILABLE";
          details ??= cleanupErrorDetails(error);
        }
        result.retry++;
        const failedAt = now();
        const retained = await deletion.fail(
          lease,
          failedAt,
          new Date(Date.parse(failedAt) + 60000).toISOString(),
        );
        if (retained && failure) {
          const event: CleanupFailureEvent = {
            event: "v2_deletion_cleanup_failed",
            environment: deps.environment,
            reason: failure,
            stage,
            namespace,
            ...(details ?? cleanupErrorDetails(undefined)),
            attempts: journal.attempts + 1,
            ageSeconds: Math.max(
              0,
              Math.floor((Date.parse(failedAt) - Date.parse(journal.created_at)) / 1000),
            ),
          };
          try {
            (deps.onFailure ?? reportCleanupFailure)(event);
          } catch {
            /* Observability failure cannot discard the durable retry. */
          }
        }
      }
      return result;
    },
  };
}
/** Session 4 mounts this in scheduled(), after auth/file intent reconciliation. */
export async function reconcileV2Deletion(env: Env) {
  const core = createV2Core(env.DB, await createCaseDataCipher(env), {
    applicationCostLimitsEnabled: env.APPLICATION_COST_LIMITS_ENABLED !== "false",
    monthlyBudgetCapEnabled: env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
  });
  return createV2DeletionReconciler(core, {
    environment: env.APP_ENV === "production" ? "production" : "preview",
    privateBucket: env.CASE_PRIVATE_R2,
    publicBucket: env.PROFILE_PUBLIC_R2,
    workflows: [
      env.FILE_PROCESSING,
      env.ASSET_PROCESSING,
      env.WORKSPACE_PROCESSING,
      env.PROFILE_PUBLICATION,
    ],
    legacyWorkflow: env.ANALYSIS_WORKFLOW,
    stopNative: (id) => revokeNamedProcessor(env.FILE_PROCESSOR, id),
  }).run();
}
