import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { analyses, cases } from "./schema";
import { v2BillingPrincipals } from "./v2-schema";

// Private technical journal. Only opaque identities/hashes/counters are retained;
// source pointers detach on deletion while the billing principal survives.
export const legacyAiOperations = sqliteTable(
  "legacy_ai_operations",
  {
    id: text("id").primaryKey(),
    principalId: text("principal_id")
      .notNull()
      .references(() => v2BillingPrincipals.id),
    analysisId: text("analysis_id").references(() => analyses.id, { onDelete: "set null" }),
    caseId: text("case_id").references(() => cases.id, { onDelete: "set null" }),
    inputRevision: integer("input_revision").notNull(),
    sourceHash: text("source_hash").notNull(),
    day: text("day").notNull(),
    workflowAttempt: integer("workflow_attempt").notNull(),
    quotaState: text("quota_state").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("legacy_ai_analysis_unique").on(t.analysisId),
    index("legacy_ai_principal_day").on(t.principalId, t.day),
    check(
      "legacy_ai_operation_bounds",
      sql`typeof(${t.inputRevision})='integer' AND ${t.inputRevision} BETWEEN 1 AND 9007199254740991 AND typeof(${t.workflowAttempt})='integer' AND ${t.workflowAttempt} BETWEEN 1 AND 3`,
    ),
    check(
      "legacy_ai_source_hash",
      sql`length(${t.sourceHash})=64 AND ${t.sourceHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check("legacy_ai_quota_state", sql`${t.quotaState} IN ('reserved','consumed','released')`),
    check("legacy_ai_day", sql`${t.day} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
  ],
);

export const legacyAiAttempts = sqliteTable(
  "legacy_ai_attempts",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id")
      .notNull()
      .references(() => legacyAiOperations.id),
    invocationId: text("invocation_id").notNull(),
    workflowAttempt: integer("workflow_attempt").notNull(),
    phase: text("phase").notNull(),
    ordinal: integer("ordinal").notNull(),
    correction: integer("correction").notNull(),
    model: text("model").notNull(),
    wireHash: text("wire_hash").notNull(),
    inputBytes: integer("input_bytes").notNull(),
    outputCap: integer("output_cap").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    boundsJson: text("bounds_json").notNull(),
    state: text("state").notNull().default("prepared"),
    dispatchToken: text("dispatch_token"),
    dispatchedAt: text("dispatched_at"),
    transport: text("transport"),
    observedAt: text("observed_at"),
    deadlineAt: text("deadline_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("legacy_ai_phase_ordinal_unique").on(
      t.operationId,
      t.workflowAttempt,
      t.phase,
      t.ordinal,
    ),
    uniqueIndex("legacy_ai_invocation_ordinal_unique").on(t.invocationId, t.ordinal),
    index("legacy_ai_operation_state").on(t.operationId, t.state),
    check(
      "legacy_ai_attempt_bounds",
      sql`typeof(${t.workflowAttempt})='integer' AND ${t.workflowAttempt} BETWEEN 1 AND 3 AND typeof(${t.ordinal})='integer' AND ${t.ordinal} BETWEEN 1 AND 3 AND ${t.correction} IN (0,1) AND typeof(${t.inputBytes})='integer' AND ${t.inputBytes}>0 AND typeof(${t.outputCap})='integer' AND ${t.outputCap} BETWEEN 1 AND 65536`,
    ),
    check(
      "legacy_ai_phase",
      sql`${t.phase} IN ('minimize','screening','structure','questions','generation','validation')`,
    ),
    check(
      "legacy_ai_attempt_hashes",
      sql`length(${t.wireHash})=64 AND ${t.wireHash} NOT GLOB '*[^0-9a-f]*' AND length(${t.evidenceHash})=64 AND ${t.evidenceHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "legacy_ai_bounds_json",
      sql`json_valid(${t.boundsJson}) AND length(CAST(${t.boundsJson} AS BLOB))<=8192`,
    ),
    check(
      "legacy_ai_wire_binding",
      sql`${t.model}='google/gemini-3.8-flash' AND json_extract(${t.boundsJson},'$.model') IS ${t.model} AND json_extract(${t.boundsJson},'$.phase') IS ${t.phase} AND json_extract(${t.boundsJson},'$.wireInputSha256') IS ${t.wireHash} AND json_extract(${t.boundsJson},'$.inputBytes') IS ${t.inputBytes} AND json_extract(${t.boundsJson},'$.outputTokenUpperBound') IS ${t.outputCap} AND json_extract(${t.boundsJson},'$.correction') IS ${t.correction}`,
    ),
    check("legacy_ai_attempt_time", sql`${t.deadlineAt}>${t.createdAt}`),
    check(
      "legacy_ai_attempt_state",
      sql`${t.state} IN ('prepared','dispatched','unknown','final')`,
    ),
    check(
      "legacy_ai_attempt_dispatch",
      sql`(${t.state}='prepared' AND ${t.dispatchToken} IS NULL AND ${t.dispatchedAt} IS NULL AND ${t.transport} IS NULL AND ${t.observedAt} IS NULL) OR (${t.state}='final' AND ${t.dispatchToken} IS NULL AND ${t.dispatchedAt} IS NULL AND ${t.transport}='not_sent' AND ${t.observedAt} IS NOT NULL) OR (${t.state} IN ('dispatched','unknown','final') AND ${t.dispatchToken} IS NOT NULL AND ${t.dispatchedAt} IS NOT NULL AND ((${t.state}='dispatched' AND ${t.transport} IS NULL AND ${t.observedAt} IS NULL) OR (${t.state}='unknown' AND ${t.transport}='unknown' AND ${t.observedAt} IS NOT NULL) OR (${t.state}='final' AND ${t.transport} IN ('response','provider_error') AND ${t.observedAt} IS NOT NULL)))`,
    ),
  ],
);

export const legacyAiObservations = sqliteTable(
  "legacy_ai_observations",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => legacyAiAttempts.id),
    digest: text("digest").notNull(),
    payloadJson: text("payload_json").notNull(),
    observedAt: text("observed_at").notNull(),
  },
  (t) => [
    uniqueIndex("legacy_ai_observation_digest").on(t.attemptId, t.digest),
    check(
      "legacy_ai_observation_hash",
      sql`length(${t.digest})=64 AND ${t.digest} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "legacy_ai_observation_payload",
      sql`json_valid(${t.payloadJson}) AND length(CAST(${t.payloadJson} AS BLOB))<=4096 AND json_extract(${t.payloadJson},'$.observedAt') IS ${t.observedAt} AND json_extract(${t.payloadJson},'$.transport') IN ('response','provider_error','unknown','not_sent')`,
    ),
  ],
);
