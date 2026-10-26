import { sql } from "drizzle-orm";
import { check, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Opaque execution facts survive source/account deletion. No targets or results. */
export const v2LookupExecutions = sqliteTable(
  "v2_lookup_executions",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id").notNull(),
    jobId: text("job_id").notNull(),
    tool: text("tool").notNull(),
    requestHash: text("request_hash").notNull(),
    transport: text("transport").notNull().default("unknown"),
    dispatchedAt: text("dispatched_at").notNull(),
    observedAt: text("observed_at"),
  },
  (t) => [
    uniqueIndex("v2_lookup_operation_tool_unique").on(t.operationId, t.tool),
    check(
      "v2_lookup_tool",
      sql`${t.tool} IN ('hometax_status','thecheat','datahub_property','datahub_building')`,
    ),
    check(
      "v2_lookup_transport",
      sql`${t.transport} IN ('unknown','response','provider_error','not_sent')`,
    ),
    check(
      "v2_lookup_hash",
      sql`length(${t.requestHash})=64 AND ${t.requestHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "v2_lookup_observation",
      sql`(${t.transport}='unknown' OR ${t.observedAt} IS NOT NULL) AND (${t.observedAt} IS NULL OR ${t.observedAt}>=${t.dispatchedAt})`,
    ),
  ],
);
