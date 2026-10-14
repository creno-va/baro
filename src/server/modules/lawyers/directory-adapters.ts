import { directorySearchSchema, v2PublicLawyerSchema } from "../../../contracts/v2";
import { readSnapshot, type V2Core } from "../../db/v2-core";
import { createIndexedDirectory, recheckDirectoryPage } from "../../db/v2-directory-index";
import { selfProfileSchema } from "./self-profile-contract";

export type DirectoryOptions = { secret: string; scope: string; clock?: () => string };
/** Bounded adapters preserve the old public DTOs without creating snapshots or
 * enumerating/decrypting every matching profile. */
export function directoryAdapters(core: V2Core, options: DirectoryOptions) {
  const index = createIndexedDirectory(core, options);
  const query = (raw: Record<string, string>) =>
    directorySearchSchema.parse({
      ...raw,
      ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
    });
  return {
    async verified(raw: Record<string, string>) {
      const page = await index.page(query(raw), "verified");
      const rows = page.entries.length
        ? (
            await core
              .statement(
                "SELECT profile_id,revision_id,content_json FROM v2_public_profiles WHERE profile_id IN (SELECT value FROM json_each(?))",
                [JSON.stringify(page.items.map((i) => i.id))],
              )
              .all<{ profile_id: string; revision_id: string; content_json: string }>()
          ).results
        : [];
      const items = page.entries.flatMap((entry) => {
        const row = rows.find(
          (r) => r.profile_id === entry.profile_id && r.revision_id === entry.source_id,
        );
        return row ? [v2PublicLawyerSchema.parse(JSON.parse(row.content_json))] : [];
      });
      const allowed = await recheckDirectoryPage(core, page);
      return {
        schemaVersion: "2" as const,
        snapshotId: page.viewId,
        rotation: "disclosed_rotation" as const,
        expiresAt: page.expiresAt,
        nextCursor: page.nextCursor,
        items: items.filter((p) => allowed.has(p.id)),
      };
    },
    async self(raw: Record<string, string>) {
      const page = await index.page(query(raw), "self");
      const items = [];
      for (const entry of page.entries) {
        const ownerId = await core
          .statement("SELECT owner_id FROM v2_profiles WHERE id=?", [entry.profile_id])
          .first<string>("owner_id");
        if (!ownerId) continue;
        const item = await readSnapshot(
          core,
          { ownerId, now: (options.clock ?? (() => new Date().toISOString()))() },
          entry.source_id,
          "profile_revision",
          entry.profile_id,
          entry.revision,
          selfProfileSchema,
        );
        if (item?.published) items.push(item);
      }
      const allowed = await recheckDirectoryPage(core, page);
      return { items: items.filter((p) => allowed.has(p.id)), nextCursor: page.nextCursor };
    },
  };
}
