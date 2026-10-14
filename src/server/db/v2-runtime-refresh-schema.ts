import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Coordinator receipts, with no owner cascade. A renewal never rewrites the
// allocation manifest, original proofs, calls, holds or running job leases.
export const v2RuntimeRefreshes = sqliteTable(
  "v2_runtime_refreshes",
  {
    id: text("id").primaryKey(),
    month: text("month").notNull(),
    environment: text("environment").notNull(),
    controlRevision: integer("control_revision").notNull(),
    allocationVersion: integer("allocation_version").notNull(),
    allocationProofId: text("allocation_proof_id").notNull(),
    pricingProofId: text("pricing_proof_id").notNull(),
    fundingProofId: text("funding_proof_id").notNull(),
    requestDigest: text("request_digest").notNull(),
    payloadJson: text("payload_json").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    createdAt: text("created_at").notNull(),
    validUntil: text("valid_until").notNull(),
  },
  (t) => [
    uniqueIndex("v2_runtime_refresh_revision").on(t.environment, t.month, t.controlRevision),
    check(
      "v2_runtime_refresh_bounds",
      sql`${t.environment} IN ('preview','production') AND ${t.controlRevision}>0 AND ${t.allocationVersion}>0 AND length(${t.requestDigest})=64 AND length(${t.evidenceHash})=64 AND length(CAST(${t.payloadJson} AS BLOB))<=1048576 AND ${t.validUntil}>${t.createdAt}`,
    ),
  ],
);
