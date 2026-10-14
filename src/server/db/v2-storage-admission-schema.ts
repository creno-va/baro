import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Derived rows have no owner cascade. An account deletion cannot erase a
// physical obligation or a cost that has not yet been reconciled.
export const v2StorageIntegrityFaults = sqliteTable(
  "v2_storage_integrity_faults",
  {
    environment: text("environment").notNull(),
    blobId: text("blob_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.environment, t.blobId] }),
    check("v2_storage_fault_environment", sql`${t.environment} IN ('preview','production')`),
  ],
);

export const v2PhysicalStorageTotals = sqliteTable(
  "v2_physical_storage_totals",
  {
    environment: text("environment").primaryKey(),
    heldBytes: integer("held_bytes").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    check(
      "v2_physical_total_bounds",
      sql`${t.environment} IN ('preview','production') AND ${t.version}=1 AND typeof(${t.heldBytes})='integer' AND ${t.heldBytes} BETWEEN 0 AND 100000000000`,
    ),
  ],
);

// Local-database scope, intentionally NOT environment scope: the original
// carryover expression sums every earlier budget and unresolved maintenance row.
export const v2StorageCarryover = sqliteTable(
  "v2_storage_carryover",
  {
    id: integer("id").primaryKey(),
    cursorMonth: text("cursor_month").notNull(),
    budgetKrw: integer("budget_krw").notNull(),
    maintenanceKrw: integer("maintenance_krw").notNull(),
    revision: integer("revision").notNull().default(1),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    check(
      "v2_storage_carryover_bounds",
      sql`${t.id}=1 AND ${t.version}=1 AND ${t.cursorMonth} GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(${t.cursorMonth},6,2) BETWEEN '01' AND '12' AND typeof(${t.revision})='integer' AND ${t.revision} BETWEEN 1 AND 9007199254740991 AND typeof(${t.budgetKrw})='integer' AND ${t.budgetKrw} BETWEEN 0 AND 9007199254740991 AND typeof(${t.maintenanceKrw})='integer' AND ${t.maintenanceKrw} BETWEEN 0 AND 9007199254740991 AND ${t.budgetKrw}+${t.maintenanceKrw} BETWEEN 0 AND 9007199254740991`,
    ),
  ],
);

// Empty outside a binding trigger. The permit ties the canonical delta to one
// immutable binding; the same trigger consumes it before the statement returns.
export const v2PhysicalTotalMutations = sqliteTable(
  "v2_physical_total_mutations",
  {
    environment: text("environment").primaryKey(),
    blobId: text("blob_id").notNull(),
    delta: integer("delta").notNull(),
  },
  (t) => [
    check(
      "v2_physical_delta_bounds",
      sql`${t.environment} IN ('preview','production') AND typeof(${t.delta})='integer' AND ${t.delta}!=0 AND ${t.delta} BETWEEN -100000000000 AND 100000000000`,
    ),
  ],
);

export const v2StorageFundingHeads = sqliteTable(
  "v2_storage_funding_heads",
  {
    environment: text("environment").primaryKey(),
    proofId: text("proof_id").notNull(),
    verifiedAt: text("verified_at").notNull(),
  },
  (t) => [
    check("v2_storage_funding_environment", sql`${t.environment} IN ('preview','production')`),
  ],
);

// Per-binding applied delta marker makes a completed transition non-replayable.
export const v2PhysicalBindingTotals = sqliteTable(
  "v2_physical_binding_totals",
  {
    blobId: text("blob_id").primaryKey(),
    environment: text("environment").notNull(),
    heldBytes: integer("held_bytes").notNull(),
  },
  (t) => [
    check(
      "v2_physical_binding_total_bounds",
      sql`${t.environment} IN ('preview','production') AND typeof(${t.heldBytes})='integer' AND ${t.heldBytes} BETWEEN 0 AND 100000000000`,
    ),
  ],
);
