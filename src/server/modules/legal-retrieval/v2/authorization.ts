import { CURRENT_POLICY_VERSIONS } from "../../../../contracts";
import { aliveWorkspace, guardSchema, type WorkspaceGuard } from "../../../db/v2-core";

// Query only identity/revision/consent. Operators get no private source plaintext.
export function createWorkspaceSourceAuthorization(
  binding: D1Database,
  input: WorkspaceGuard,
  versions = CURRENT_POLICY_VERSIONS,
) {
  const g = guardSchema.parse(input);
  return async () =>
    Boolean(
      await binding
        .prepare(
          `SELECT w.id FROM v2_workspaces w JOIN user_consents c ON c.user_id=w.owner_id WHERE w.id=? AND w.owner_id=? AND w.revision=? AND c.terms_version=? AND c.privacy_version=? AND c.ai_notice_version=? AND c.over_14_confirmed=1 AND c.consented_at<=? AND ${aliveWorkspace}`,
        )
        .bind(
          g.workspaceId,
          g.ownerId,
          g.expectedRevision,
          versions.termsVersion,
          versions.privacyVersion,
          versions.aiNoticeVersion,
          g.now,
        )
        .first(),
    );
}
