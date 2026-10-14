import { z } from "zod";
import { opaqueIdSchema, revisionSchema } from "../../contracts";
import { CURRENT_POLICY_VERSIONS } from "../../contracts/consent";
import { MAX_ENVELOPE_CHARACTERS } from "../crypto";
import { parse } from "./v2-core";

const sourceSchema = z.strictObject({
  profileId: opaqueIdSchema,
  revisionId: opaqueIdSchema,
  revision: revisionSchema,
  encryptedPayload: z.string().min(1).max(MAX_ENVELOPE_CHARACTERS),
});

/** Server-owned additional creation fence; never accepted by an HTTP request schema. */
export type WorkspaceCreationSource = z.infer<typeof sourceSchema>;

export function workspaceCreationSourcePredicate(source: WorkspaceCreationSource, ownerId: string) {
  const value = parse(sourceSchema, source);
  return {
    sql: `EXISTS(SELECT 1 FROM v2_profiles p JOIN v2_profile_revisions r ON r.profile_id=p.id AND r.revision=p.revision
      WHERE p.id=? AND p.owner_id=? AND p.revision=? AND r.id=? AND r.status='draft' AND r.encrypted_payload=?
      AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='profile' AND target_id=p.id))
      AND coalesce((SELECT value FROM app_metadata WHERE key=? AND value IN ('customer','lawyer')),
        CASE WHEN EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=? AND role IN ('lawyer_applicant','verified_lawyer')) THEN 'lawyer' ELSE 'customer' END)='customer'
      AND EXISTS(SELECT 1 FROM user_consents WHERE user_id=? AND terms_version=? AND privacy_version=? AND ai_notice_version=? AND over_14_confirmed=1)`,
    values: [
      value.profileId,
      ownerId,
      value.revision,
      value.revisionId,
      value.encryptedPayload,
      `account-type:${ownerId}`,
      ownerId,
      ownerId,
      CURRENT_POLICY_VERSIONS.termsVersion,
      CURRENT_POLICY_VERSIONS.privacyVersion,
      CURRENT_POLICY_VERSIONS.aiNoticeVersion,
    ],
  };
}
