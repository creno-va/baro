import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import type { V2PublicLawyer } from "../../../contracts/v2";
import type { V2Core } from "../../db/v2-core";
import { createV2LawyersRepository } from "../../db/v2-lawyers";
import { type DirectoryOptions, directoryAdapters } from "./directory-adapters";

export class DirectoryError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CURSOR_EXPIRED" | "STORAGE_UNAVAILABLE") {
    super(code);
  }
}

/** Only approved public projections are read; no case, draft or identity decryption. */
export function createDirectoryService(
  core: V2Core,
  clock = () => new Date().toISOString(),
  options?: DirectoryOptions,
) {
  const lawyers = createV2LawyersRepository(core);
  return {
    async list(raw: Record<string, string>) {
      if (!options) throw new DirectoryError("STORAGE_UNAVAILABLE");
      return directoryAdapters(core, { ...options, clock }).verified(raw);
    },
    async profile(id: string): Promise<V2PublicLawyer> {
      opaqueIdSchema.parse(id);
      const replaced = await core
        .statement(
          "SELECT s.id FROM v2_private_snapshots s JOIN v2_consents c ON c.id=s.id AND c.owner_id=s.owner_id WHERE s.target_id=? AND s.purpose='profile_revision' AND c.kind='profile_publication' AND c.version IN ('mvp-self-profile-public-v1','mvp-self-profile-private-v1') LIMIT 1",
          [id],
        )
        .first();
      if (replaced) throw new DirectoryError("NOT_FOUND");
      const profile = await lawyers.publicProfile(id);
      if (!profile) throw new DirectoryError("NOT_FOUND");
      // A retired or missing copy must disappear from detail as well as list pages.
      const rows = await core
        .statement(
          `SELECT a.asset_id FROM v2_public_assets a JOIN v2_profiles p ON p.id=a.profile_id
        JOIN v2_blobs b ON b.id=a.public_blob_id
        WHERE a.profile_id=? AND a.revision_id=p.approved_revision_id AND b.state='stored'
        AND b.visibility='public' AND NOT EXISTS(SELECT 1 FROM v2_tombstones t
        WHERE t.target_kind='asset' AND t.target_id=a.asset_id)`,
          [id],
        )
        .all<{ asset_id: string }>();
      const ids = new Set(rows.results.map((row) => row.asset_id));
      if (profile.assets.some((asset) => !ids.has(asset.id))) throw new DirectoryError("NOT_FOUND");
      const current = await lawyers.publicProfile(id);
      if (!current || JSON.stringify(current) !== JSON.stringify(profile))
        throw new DirectoryError("NOT_FOUND");
      return profile;
    },
  };
}

export const publicProfileQuerySchema = z.strictObject({});
