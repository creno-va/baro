import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// No owner/blob cascade: physical obligations survive source/account deletion.
export const v2PhysicalStorageCapacity = sqliteTable(
  "v2_physical_storage_capacity",
  {
    environment: text("environment").primaryKey(),
    capacityBytes: integer("capacity_bytes").notNull(),
    heldBytes: integer("held_bytes").notNull().default(0),
    revision: integer("revision").notNull().default(1),
  },
  (t) => [
    check(
      "v2_physical_capacity_bounds",
      sql`${t.environment} IN ('preview','production') AND typeof(${t.capacityBytes})='integer' AND ${t.capacityBytes} BETWEEN 1 AND 100000000000 AND typeof(${t.heldBytes})='integer' AND ${t.heldBytes} BETWEEN 0 AND ${t.capacityBytes} AND typeof(${t.revision})='integer' AND ${t.revision}>0`,
    ),
  ],
);
export const v2StorageProjections = sqliteTable(
  "v2_storage_projections",
  {
    id: text("id").primaryKey(),
    month: text("month").notNull(),
    environment: text("environment").notNull(),
    capacityBytes: integer("capacity_bytes").notNull(),
    payloadJson: text("payload_json").notNull(),
    digest: text("digest").notNull(),
    pricingProofId: text("pricing_proof_id").notNull(),
    fundingProofId: text("funding_proof_id").notNull(),
    allocationProofId: text("allocation_proof_id").notNull(),
    maintenanceId: text("maintenance_id").notNull(),
    reservedKrw: integer("reserved_krw").notNull(),
    getLimit: integer("get_limit").notNull(),
    headLimit: integer("head_limit").notNull(),
    deleteLimit: integer("delete_limit").notNull(),
    gets: integer("gets").notNull().default(0),
    heads: integer("heads").notNull().default(0),
    deletes: integer("deletes").notNull().default(0),
    createdAt: text("created_at").notNull(),
    validUntil: text("valid_until").notNull(),
  },
  (t) => [
    uniqueIndex("v2_storage_projection_month").on(t.environment, t.month),
    check(
      "v2_storage_projection_bounds",
      sql`${t.environment} IN ('preview','production') AND typeof(${t.capacityBytes})='integer' AND ${t.capacityBytes} BETWEEN 1 AND 100000000000 AND typeof(${t.reservedKrw})='integer' AND ${t.reservedKrw} BETWEEN 1 AND 1000000 AND length(${t.digest})=64 AND length(CAST(${t.payloadJson} AS BLOB))<=262144 AND ${t.validUntil}>${t.createdAt}`,
    ),
    check(
      "v2_storage_projection_counters",
      sql`typeof(${t.getLimit})='integer' AND ${t.getLimit} BETWEEN 0 AND 1000000 AND typeof(${t.headLimit})='integer' AND ${t.headLimit} BETWEEN 0 AND 1000000 AND typeof(${t.deleteLimit})='integer' AND ${t.deleteLimit} BETWEEN 0 AND 1000000 AND typeof(${t.gets})='integer' AND ${t.gets} BETWEEN 0 AND ${t.getLimit} AND typeof(${t.heads})='integer' AND ${t.heads} BETWEEN 0 AND ${t.headLimit} AND typeof(${t.deletes})='integer' AND ${t.deletes} BETWEEN 0 AND ${t.deleteLimit}`,
    ),
  ],
);
export const v2PhysicalBlobBindings = sqliteTable(
  "v2_physical_blob_bindings",
  {
    blobId: text("blob_id").primaryKey(),
    environment: text("environment").notNull(),
    ownerId: text("owner_id").notNull(),
    objectKey: text("object_key").notNull(),
    maximumCipherBytes: integer("maximum_cipher_bytes").notNull(),
    state: text("state").notNull().default("held"),
    writerState: text("writer_state").notNull().default("prepared"),
    writerToken: text("writer_token"),
    expectedCipherBytes: integer("expected_cipher_bytes"),
    inventoryHash: text("inventory_hash"),
    createdAt: text("created_at").notNull(),
    releasedReceiptId: text("released_receipt_id"),
  },
  (t) => [
    check(
      "v2_physical_binding_bounds",
      sql`${t.environment} IN ('preview','production') AND typeof(${t.maximumCipherBytes})='integer' AND ${t.maximumCipherBytes} BETWEEN 1 AND 100000000000 AND ${t.state} IN ('held','released') AND ((${t.state}='held' AND ${t.releasedReceiptId} IS NULL) OR (${t.state}='released' AND ${t.releasedReceiptId} IS NOT NULL AND ${t.writerState}='stopped')) AND (${t.inventoryHash} IS NULL OR length(${t.inventoryHash})=64) AND ${t.writerState} IN ('prepared','running','stopped') AND ((${t.writerState}='prepared' AND ${t.writerToken} IS NULL AND ${t.expectedCipherBytes} IS NULL) OR (${t.writerState}='running' AND ${t.writerToken} IS NOT NULL AND typeof(${t.expectedCipherBytes})='integer' AND ${t.expectedCipherBytes} BETWEEN 1 AND ${t.maximumCipherBytes}) OR ${t.writerState}='stopped')`,
    ),
  ],
);
