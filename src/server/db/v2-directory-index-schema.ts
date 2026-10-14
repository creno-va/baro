import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./schema";
import { v2Profiles } from "./v2-schema";

export const v2DirectoryEpoch = sqliteTable(
  "v2_directory_epoch",
  {
    id: integer("id").primaryKey(),
    revision: integer("revision").notNull().default(1),
  },
  (t) => [
    check(
      "v2_directory_epoch_bounds",
      sql`${t.id}=1 AND typeof(${t.revision})='integer' AND ${t.revision}>0`,
    ),
  ],
);

export const v2DirectoryEntries = sqliteTable(
  "v2_directory_entries",
  {
    profileId: text("profile_id")
      .primaryKey()
      .references(() => v2Profiles.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    revision: integer("revision").notNull(),
    sortKey: text("sort_key").notNull(),
    name: text("normalized_name").notNull(),
    office: text("normalized_office").notNull(),
    region: text("region").notNull(),
    publicJson: text("public_json").notNull(),
    photoData: text("photo_data"),
    tokensJson: text("tokens_json").notNull(),
    facetsJson: text("facets_json").notNull(),
    refsJson: text("refs_json").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("v2_directory_owner").on(t.ownerId),
    index("v2_directory_source").on(t.source, t.sourceId),
    check(
      "v2_directory_entry_bounds",
      sql`${t.source} IN ('self','verified') AND ${t.revision}>0 AND length(${t.sortKey})=16 AND ${t.sortKey} NOT GLOB '*[^0-9a-f]*' AND length(CAST(${t.publicJson} AS BLOB))<=65536 AND length(CAST(${t.tokensJson} AS BLOB))<=65536 AND length(CAST(${t.facetsJson} AS BLOB))<=4096 AND length(CAST(${t.refsJson} AS BLOB))<=16384 AND (${t.photoData} IS NULL OR length(CAST(${t.photoData} AS BLOB))<=44000)`,
    ),
  ],
);
export const v2DirectoryTerms = sqliteTable(
  "v2_directory_terms",
  {
    token: text("token").notNull(),
    sortKey: text("sort_key").notNull(),
    profileId: text("profile_id")
      .notNull()
      .references(() => v2DirectoryEntries.profileId, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.token, t.sortKey, t.profileId] }),
    index("v2_directory_terms_profile").on(t.profileId),
  ],
);
export const v2DirectoryFacets = sqliteTable(
  "v2_directory_facets",
  {
    facet: text("facet").notNull(),
    sortKey: text("sort_key").notNull(),
    profileId: text("profile_id")
      .notNull()
      .references(() => v2DirectoryEntries.profileId, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.facet, t.sortKey, t.profileId] }),
    index("v2_directory_facets_profile").on(t.profileId),
  ],
);
export const v2DirectoryAssetRefs = sqliteTable(
  "v2_directory_asset_refs",
  {
    profileId: text("profile_id")
      .notNull()
      .references(() => v2DirectoryEntries.profileId, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull(),
    blobId: text("blob_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.assetId] }),
    index("v2_directory_ref_asset").on(t.assetId),
    index("v2_directory_ref_blob").on(t.blobId),
  ],
);
