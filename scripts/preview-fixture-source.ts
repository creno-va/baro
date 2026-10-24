import { opaqueIdSchema } from "../src/contracts";
import { readSnapshot, type V2Core } from "../src/server/db/v2-core";
import { workspaceCreationSourcePredicate } from "../src/server/db/v2-workspace-create-guard";
import { selfProfileSchema } from "../src/server/modules/lawyers/self-profile-contract";

// One reviewed synthetic source. Never enumerate or decrypt unrelated profiles.
export const PREVIEW_FIXTURE_PROFILE_ID = "4d279ff5-aaf2-4481-86ec-09b2d288495c";
export async function readPreviewFixtureSource(core: V2Core, now: string) {
  const profileId = PREVIEW_FIXTURE_PROFILE_ID;
  const row = await core.binding
    .prepare(
      `SELECT p.owner_id,s.revision,s.id,s.encrypted_payload FROM v2_profiles p
      JOIN v2_private_snapshots s ON s.target_id=p.id AND s.owner_id=p.owner_id AND s.purpose='profile_revision'
      JOIN v2_consents c ON c.id=s.id AND c.owner_id=p.owner_id AND c.revision=s.revision AND c.kind='profile_publication'
      WHERE p.id=? AND s.state='published' AND s.workspace_id IS NULL AND c.version='mvp-self-profile-private-v1'
      AND s.revision=(SELECT max(revision) FROM v2_private_snapshots WHERE target_id=p.id AND purpose='profile_revision')
      AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='profile' AND target_id=p.id) OR (target_kind='account' AND target_id=p.owner_id))`,
    )
    .bind(profileId)
    .first<{ owner_id: string; revision: number; id: string; encrypted_payload: string }>();
  if (!row) return { ok: false, code: "SOURCE_UNAVAILABLE" } as const;
  const ownerId = opaqueIdSchema.parse(row.owner_id);
  const profile = await readSnapshot(
    core,
    { ownerId, now },
    row.id,
    "profile_revision",
    profileId,
    row.revision,
    selfProfileSchema,
  );
  if (
    !profile ||
    profile.id !== profileId ||
    profile.revision !== row.revision ||
    profile.published ||
    profile.name !== "합성검증 프로필 1014" ||
    profile.officeName !== "합성 테스트 사무실"
  )
    return { ok: false, code: "SOURCE_MARKER_MISMATCH" } as const;
  const source = {
    profileId,
    snapshotId: row.id,
    revision: row.revision,
    encryptedPayload: row.encrypted_payload,
  };
  const fence = workspaceCreationSourcePredicate(source, ownerId);
  if (
    !(await core.binding
      .prepare(`SELECT 1 WHERE ${fence.sql}`)
      .bind(...fence.values)
      .first())
  )
    return { ok: false, code: "ACCESS_OR_QUOTA_REJECTED" } as const;
  // Private in-memory capability; never include this object in a public receipt.
  return { ok: true, ownerId, source, fence } as const;
}
