import { z } from "zod";

const publicationFailureSchema = z.strictObject({
  stage: z.enum([
    "input",
    "confirmed_summary",
    "references",
    "fact_ids",
    "relations",
    "entity_ids",
    "summary_metadata",
    "summary_revision",
    "summary_copy",
    "summary_begin",
    "summary_entities",
    "summary_append",
    "summary_seal",
    "claim_prepare",
    "action_encryption",
    "timeline_encryption",
    "message_encryption",
    "commit",
  ]),
  reason: z.enum([
    "message_mismatch",
    "summary_unconfirmed",
    "reference_unauthorized",
    "duplicate_fact_id",
    "existing_fact_id",
    "fact_user_edited",
    "unknown_conflicting_fact",
    "action_invalid",
    "timeline_invalid",
    "duplicate_party_id",
    "duplicate_action_id",
    "duplicate_timeline_id",
    "summary_mismatch",
    "summary_revision_invalid",
    "summary_count_exceeded",
    "summary_notices_missing",
    "summary_conflict_invalid",
    "claim_not_acquired",
    "repository_input_invalid",
    "snapshot_invalid",
    "snapshot_stream_required",
    "dependency_exception",
  ]),
});
export type WorkspacePublicationFailure = z.infer<typeof publicationFailureSchema>;

/** Internal receipt only: reject additional properties, IDs, text and arbitrary error values. */
export function safeWorkspacePublicationFailure(value: unknown) {
  const result = publicationFailureSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

/** Observe existing checks without adding reads or changing false/throw/success semantics. */
export function createWorkspacePublicationDiagnostics(
  onFailure?: (failure: WorkspacePublicationFailure) => void,
) {
  let stage: WorkspacePublicationFailure["stage"] = "input";
  let reported = false;
  const failed = (reason: WorkspacePublicationFailure["reason"]) => {
    if (reported) return;
    reported = true;
    const failure = safeWorkspacePublicationFailure({ stage, reason });
    if (failure) {
      try {
        onFailure?.(failure);
      } catch {
        // Observation must never replace the original publication result/error.
      }
    }
  };
  return {
    at(value: WorkspacePublicationFailure["stage"]) {
      stage = value;
    },
    failed,
    reject(reason: WorkspacePublicationFailure["reason"]) {
      failed(reason);
      return false as const;
    },
    async run<T>(action: () => Promise<T>): Promise<T> {
      try {
        return await action();
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : null;
        failed(
          code === "REPOSITORY_INPUT_INVALID"
            ? "repository_input_invalid"
            : code === "SNAPSHOT_INVALID"
              ? "snapshot_invalid"
              : code === "SNAPSHOT_STREAM_REQUIRED"
                ? "snapshot_stream_required"
                : "dependency_exception",
        );
        throw error;
      }
    },
  };
}
