import type { SelfProfile } from "../../src/contracts/v2/self-profile";
import { snapshotStatements, type V2Core } from "../../src/server/db/v2-core";

/** Test-only historical data writer. New product saves never create private revisions. */
export async function seedLegacySelfProfile(core: V2Core, ownerId: string, value: SelfProfile) {
  const id = crypto.randomUUID();
  const claim = crypto.randomUUID();
  const now = "2026-10-14T00:00:00.000Z";
  await core.changed([
    core.statement(
      "INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) VALUES(?,?,?,?)",
      [claim, ownerId, value.id, value.revision],
    ),
    ...(await snapshotStatements(
      core,
      {
        id,
        ownerId,
        workspaceId: null,
        targetId: value.id,
        revision: value.revision,
        purpose: "profile_revision",
        now,
      },
      value,
      claim,
    )),
    core.statement(
      "INSERT INTO v2_consents(id,owner_id,kind,version,revision,encrypted_payload,created_at) VALUES(?,?,'profile_publication',?,?,?,?)",
      [
        id,
        ownerId,
        value.published ? "mvp-self-profile-public-v1" : "mvp-self-profile-private-v1",
        value.revision,
        await core.encrypt("v2_consents", id, ownerId, value.revision, {
          published: value.published,
        }),
        now,
      ],
    ),
    core.statement("DELETE FROM v2_directory_entries WHERE profile_id=?", [value.id]),
    core.statement(
      "DELETE FROM v2_consents WHERE id IN (SELECT id FROM v2_private_snapshots WHERE target_id=? AND purpose='profile_revision' AND revision<?)",
      [value.id, value.revision],
    ),
    core.statement(
      "DELETE FROM v2_private_snapshots WHERE target_id=? AND purpose='profile_revision' AND revision<?",
      [value.id, value.revision],
    ),
    core.finish(claim),
  ]);
  return value;
}
