import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import { v2PublicLawyerSchema } from "../../../contracts/v2";
import { readSnapshot, type V2Core } from "../../db/v2-core";
import {
  type DirectoryProjection,
  directoryEligibleSql,
  directoryProjectionStatements,
  selfDirectoryProjection,
  verifiedDirectoryProjection,
} from "../../db/v2-directory-projection";
import { selfProfileSchema } from "./self-profile-contract";

export const directoryMaintenanceSchema = z.strictObject({
  maintenance: z.literal("directory-index"),
  expectedReleaseSha: z.string().regex(/^[a-f0-9]{40}$/),
  maximumProfiles: z.number().int().min(1).max(10000).default(10000),
  after: opaqueIdSchema.optional(),
});
export type DirectoryMaintenanceParams = z.infer<typeof directoryMaintenanceSchema>;

/** Operator-only migration of already-public profiles, 20 raw IDs per step.
 * The listing path never decrypts private snapshots. Replays skip unchanged cards. */
export function createDirectoryMaintenance(core: V2Core, clock = () => new Date().toISOString()) {
  const put = async (p: DirectoryProjection) => {
    const claim = crypto.randomUUID();
    return core.changed([
      core.statement(
        `WITH d(profile_id,owner_id,source,source_id,revision,refs_json) AS (SELECT ?,?,?,?,?,?) INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,owner_id,profile_id,revision FROM d WHERE ${directoryEligibleSql()}`,
        [p.profileId, p.ownerId, p.source, p.sourceId, p.revision, p.refsJson, claim],
      ),
      ...directoryProjectionStatements(core, p, claim),
      core.finish(claim),
    ]);
  };
  return {
    async batch(after = "", limit = 20) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20)
        throw new Error("DIRECTORY_BATCH_INVALID");
      const rows = (
        await core
          .statement("SELECT id,owner_id FROM v2_profiles WHERE id>? ORDER BY id LIMIT ?", [
            after,
            limit + 1,
          ])
          .all<{ id: string; owner_id: string }>()
      ).results;
      const page = rows.slice(0, limit);
      let indexed = 0;
      for (const profile of page) {
        const snapshot = await core
          .statement(
            "SELECT s.id,s.revision,s.state,c.version FROM v2_private_snapshots s JOIN v2_consents c ON c.id=s.id AND c.owner_id=s.owner_id WHERE s.target_id=? AND s.owner_id=? AND s.purpose='profile_revision' AND c.kind='profile_publication' AND c.version IN ('mvp-self-profile-public-v1','mvp-self-profile-private-v1') ORDER BY s.revision DESC LIMIT 1",
            [profile.id, profile.owner_id],
          )
          .first<{ id: string; revision: number; state: string; version: string }>();
        let projection: DirectoryProjection | undefined;
        if (snapshot) {
          // Only an explicit public source is decrypted, never a private draft.
          if (snapshot.state === "published" && snapshot.version === "mvp-self-profile-public-v1") {
            const authorized = await core
              .statement(
                `WITH d(profile_id,owner_id,source,source_id,revision,refs_json) AS (SELECT ?,?,'self',?,?,'[]') SELECT 1 FROM d WHERE ${directoryEligibleSql()}`,
                [profile.id, profile.owner_id, snapshot.id, snapshot.revision],
              )
              .first();
            if (!authorized) continue;
            const value = await readSnapshot(
              core,
              { ownerId: profile.owner_id, now: clock() },
              snapshot.id,
              "profile_revision",
              profile.id,
              snapshot.revision,
              selfProfileSchema,
            );
            if (value?.published)
              projection = await selfDirectoryProjection(
                core,
                profile.owner_id,
                snapshot.id,
                value,
                clock(),
              );
          }
        } else {
          const published = await core
            .statement(
              "SELECT revision_id,content_json FROM v2_public_profiles WHERE profile_id=?",
              [profile.id],
            )
            .first<{ revision_id: string; content_json: string }>();
          if (published) {
            const refs = (
              await core
                .statement(
                  "SELECT asset_id,public_blob_id FROM v2_public_assets WHERE profile_id=? AND revision_id=?",
                  [profile.id, published.revision_id],
                )
                .all<{ asset_id: string; public_blob_id: string }>()
            ).results;
            const value = v2PublicLawyerSchema.parse(JSON.parse(published.content_json));
            projection = await verifiedDirectoryProjection(
              profile.owner_id,
              published.revision_id,
              value,
              Object.fromEntries(refs.map((r) => [r.asset_id, r.public_blob_id])),
              clock(),
            );
          }
        }
        if (projection && (await put(projection))) indexed++;
        // Also scrub restored/stale projections whose authority has disappeared.
        await core
          .statement(
            `DELETE FROM v2_directory_entries AS d WHERE d.profile_id=? AND NOT ${directoryEligibleSql()}`,
            [profile.id],
          )
          .run();
      }
      return {
        processed: page.length,
        indexed,
        next: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    },
  };
}
