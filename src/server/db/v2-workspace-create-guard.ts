import { z } from "zod";
import { opaqueIdSchema, revisionSchema } from "../../contracts";
import { CURRENT_POLICY_VERSIONS } from "../../contracts/consent";
import { MAX_ENVELOPE_CHARACTERS } from "../crypto";
import { parse } from "./v2-core";

const sourceSchema = z.strictObject({
  profileId: opaqueIdSchema,
  snapshotId: opaqueIdSchema,
  revision: revisionSchema,
  encryptedPayload: z.string().min(1).max(MAX_ENVELOPE_CHARACTERS),
});

/** Server-owned additional creation fence; never accepted by an HTTP request schema. */
export type WorkspaceCreationSource = z.infer<typeof sourceSchema>;

export function workspaceCreationSourcePredicate(source: WorkspaceCreationSource, ownerId: string) {
  const value = parse(sourceSchema, source);
  return {
    sql: `EXISTS(SELECT 1 FROM v2_profiles p
      JOIN v2_private_snapshots s ON s.target_id=p.id AND s.owner_id=p.owner_id AND s.purpose='profile_revision'
      JOIN v2_consents c ON c.id=s.id AND c.owner_id=p.owner_id AND c.revision=s.revision AND c.kind='profile_publication'
      WHERE p.id=? AND p.owner_id=? AND s.revision=? AND s.id=? AND s.encrypted_payload=?
      AND s.state='published' AND s.workspace_id IS NULL AND c.version='mvp-self-profile-private-v1'
      AND s.revision=(SELECT max(revision) FROM v2_private_snapshots WHERE target_id=p.id AND purpose='profile_revision')
      AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='profile' AND target_id=p.id) OR (target_kind='account' AND target_id=p.owner_id)))
      AND coalesce((SELECT value FROM app_metadata WHERE key=? AND value IN ('customer','lawyer')),
        CASE WHEN EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=? AND role IN ('lawyer_applicant','verified_lawyer')) THEN 'lawyer' ELSE 'customer' END)='customer'
      AND EXISTS(SELECT 1 FROM user_consents WHERE user_id=? AND terms_version=? AND privacy_version=? AND ai_notice_version=? AND over_14_confirmed=1)`,
    values: [
      value.profileId,
      ownerId,
      value.revision,
      value.snapshotId,
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
