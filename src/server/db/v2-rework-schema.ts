import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./schema";
import { v2Workspaces } from "./v2-schema";

/** Reuses the existing encrypted envelope/fragment semantics without relabelling reports. */
export const v2ReworkRecords = sqliteTable(
  "v2_rework_records",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => v2Workspaces.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    entityId: text("entity_id").notNull(),
    revision: integer("revision").notNull(),
    workspaceRevision: integer("workspace_revision").notNull(),
    state: text("state").notNull().default("staging"),
    partCount: integer("part_count").notNull(),
    byteLength: integer("byte_length").notNull(),
    encryptedPayload: text("encrypted_payload").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("v2_rework_published_version_unique")
      .on(t.workspaceId, t.kind, t.entityId, t.revision)
      .where(sql`${t.state}='published'`),
    index("v2_rework_latest_idx").on(t.workspaceId, t.kind, t.entityId, t.state, t.revision),
    check(
      "v2_rework_kind",
      sql`${t.kind} IN ('context','reconciliation','analysis','resolution','task','action_receipt','checkpoint')`,
    ),
    check(
      "v2_rework_bounds",
      sql`${t.revision}>=1 AND ${t.workspaceRevision}>=1 AND ${t.partCount} BETWEEN 1 AND 64 AND ${t.byteLength} BETWEEN 1 AND 4194304 AND ${t.state} IN ('staging','published','abandoned')`,
    ),
  ],
);
export const v2ReworkParts = sqliteTable(
  "v2_rework_parts",
  {
    id: text("id").primaryKey(),
    recordId: text("record_id")
      .notNull()
      .references(() => v2ReworkRecords.id, { onDelete: "cascade" }),
    partIndex: integer("part_index").notNull(),
    byteLength: integer("byte_length").notNull(),
    encryptedPayload: text("encrypted_payload").notNull(),
  },
  (t) => [
    uniqueIndex("v2_rework_part_unique").on(t.recordId, t.partIndex),
    check(
      "v2_rework_part_bounds",
      sql`${t.partIndex} BETWEEN 0 AND 63 AND ${t.byteLength} BETWEEN 1 AND 65536`,
    ),
  ],
);
