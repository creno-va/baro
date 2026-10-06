import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import { type V2PublicLawyer, v2DirectoryQuerySchema } from "../../../contracts/v2";
import type { V2Core } from "../../db/v2-core";
import { createV2DirectoryRepository, DIRECTORY_SNAPSHOT_TTL_MS } from "../../db/v2-directory";
import { createV2LawyersRepository } from "../../db/v2-lawyers";

export class DirectoryError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CURSOR_EXPIRED" | "STORAGE_UNAVAILABLE") {
    super(code);
  }
}

/** Only approved public projections are read; no case, draft or identity decryption. */
export function createDirectoryService(core: V2Core, clock = () => new Date().toISOString()) {
  const directory = createV2DirectoryRepository(core);
  const lawyers = createV2LawyersRepository(core);
  return {
    async list(raw: Record<string, string>) {
      const query = v2DirectoryQuerySchema.parse({
        ...raw,
        ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
      });
      const now = clock();
      const result = query.cursor
        ? await directory.page(now, query)
        : await directory.create(now, query, {
            id: crypto.randomUUID(),
            expiresAt: new Date(Date.parse(now) + DIRECTORY_SNAPSHOT_TTL_MS).toISOString(),
          });
      if (!result) throw new DirectoryError("CURSOR_EXPIRED");
      return result;
    },
    async profile(id: string): Promise<V2PublicLawyer> {
      opaqueIdSchema.parse(id);
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
