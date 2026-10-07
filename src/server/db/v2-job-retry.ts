import type { V2Job, V2Workspace } from "../../contracts/v2";

const MAX_INTAKE_POLICY_ATTEMPTS = 3;
const MAX_JOB_ATTEMPTS = 10;

/** Legacy intake policy failures stored retryable=0; a new attempt still runs every validation. */
export function canRetryV2Job(
  job: Pick<V2Job, "status" | "target" | "kind" | "failure" | "retryable" | "attempts">,
  workspace?: Pick<V2Workspace, "status" | "workspaceRevision">,
) {
  if (job.status !== "failed") return false;
  if (job.failure === "POLICY_REJECTED")
    return (
      job.target.kind === "workspace" &&
      (job.kind === "intake_questions" || job.kind === "intake_summary") &&
      job.attempts < MAX_INTAKE_POLICY_ATTEMPTS &&
      (!workspace ||
        (workspace.status === "intake" &&
          workspace.workspaceRevision === job.target.workspaceRevision + 1))
    );
  return job.retryable && job.attempts < MAX_JOB_ATTEMPTS;
}

/** Keep the same eligibility inside the atomic retry claim, including attempt limits. */
export const v2JobRetryPredicate = `j.status='failed' AND (
  (j.failure_code='POLICY_REJECTED' AND j.target_kind='workspace' AND j.kind IN ('intake_questions','intake_summary') AND j.attempts<${MAX_INTAKE_POLICY_ATTEMPTS}) OR
  (j.failure_code IS NOT 'POLICY_REJECTED' AND j.retryable=1 AND j.attempts<${MAX_JOB_ATTEMPTS})
)`;
