import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { v2BillingPrincipals, v2RuntimeProofs } from "./v2-schema";

// Technical authorization survives missing accounting configuration. Historical
// priced attempts remain in their original tables; neither route rewrites them.
export const v2ExecutionAdmissions = sqliteTable(
  "v2_execution_admissions",
  {
    attemptId: text("attempt_id").primaryKey(),
    planId: text("plan_id").notNull(),
    principalId: text("principal_id")
      .notNull()
      .references(() => v2BillingPrincipals.id),
    environment: text("environment").notNull(),
    kind: text("kind").notNull(),
    operationId: text("operation_id").notNull(),
    operationRevision: integer("operation_revision").notNull(),
    requestHash: text("request_hash").notNull(),
    invocationId: text("invocation_id").notNull(),
    attempt: integer("attempt").notNull(),
    service: text("service").notNull(),
    jobId: text("job_id"),
    runtimeInstanceId: text("runtime_instance_id"),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    targetRevision: integer("target_revision").notNull(),
    reservationId: text("reservation_id"),
    blobId: text("blob_id"),
    scope: text("scope"),
    anchorJson: text("anchor_json"),
    digest: text("digest").notNull(),
    payloadJson: text("payload_json").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    verifiedAt: text("verified_at").notNull(),
    deadlineAt: text("deadline_at").notNull(),
    createdAt: text("created_at").notNull(),
    state: text("state").notNull().default("prepared"),
    leaseToken: text("lease_token"),
    fencing: integer("fencing"),
    dispatchToken: text("dispatch_token"),
    dispatchedAt: text("dispatched_at"),
    transport: text("transport"),
    transportObservedAt: text("transport_observed_at"),
    transportDigest: text("transport_digest"),
  },
  (t) => [
    uniqueIndex("v2_execution_plan_unique").on(t.planId),
    uniqueIndex("v2_execution_invocation_attempt_unique").on(t.invocationId, t.attempt),
    index("v2_execution_job_state").on(t.jobId, t.state),
    index("v2_execution_blob_state").on(t.blobId, t.state),
    check("v2_execution_environment", sql`${t.environment} IN ('preview','production')`),
    check(
      "v2_execution_kind",
      sql`(${t.kind}='job' AND ${t.jobId} IS NOT NULL AND ${t.runtimeInstanceId} IS NOT NULL AND ${t.reservationId} IS NULL AND ${t.blobId} IS NULL AND ${t.scope} IS NULL AND ${t.anchorJson} IS NULL) OR (${t.kind}='storage' AND ${t.jobId} IS NULL AND ${t.runtimeInstanceId} IS NULL AND ${t.reservationId} IS NOT NULL AND ${t.blobId} IS NOT NULL AND ${t.scope} IN ('case_original','lawyer_original','approved_public_copy') AND json_valid(${t.anchorJson}))`,
    ),
    check(
      "v2_execution_plan_binding",
      sql`json_valid(${t.payloadJson}) AND json_extract(${t.payloadJson},'$.attemptId')=${t.attemptId} AND json_extract(${t.payloadJson},'$.planId')=${t.planId} AND json_extract(${t.payloadJson},'$.plan.operationId')=${t.operationId} AND json_extract(${t.payloadJson},'$.plan.operationRevision')=${t.operationRevision} AND json_extract(${t.payloadJson},'$.plan.requestHash')=${t.requestHash} AND json_extract(${t.payloadJson},'$.plan.invocationId')=${t.invocationId} AND json_extract(${t.payloadJson},'$.attempt')=${t.attempt} AND json_extract(${t.payloadJson},'$.targetKind')=${t.targetKind} AND json_extract(${t.payloadJson},'$.targetId')=${t.targetId} AND json_extract(${t.payloadJson},'$.targetRevision')=${t.targetRevision} AND json_extract(${t.payloadJson},'$.plan.deadlineAt')=${t.deadlineAt} AND ${t.attempt} BETWEEN 1 AND json_extract(${t.payloadJson},'$.plan.maximumAttempts') AND json_extract(${t.payloadJson},'$.plan.maximumAttempts') BETWEEN 1 AND 10`,
    ),
    check(
      "v2_execution_payload_fields",
      sql`json_type(${t.payloadJson},'$.attemptId') IS 'text' AND json_type(${t.payloadJson},'$.planId') IS 'text' AND json_type(${t.payloadJson},'$.plan') IS 'object' AND json_type(${t.payloadJson},'$.plan.operationId') IS 'text' AND json_type(${t.payloadJson},'$.plan.operationRevision') IS 'integer' AND json_type(${t.payloadJson},'$.plan.requestHash') IS 'text' AND json_type(${t.payloadJson},'$.plan.invocationId') IS 'text' AND json_type(${t.payloadJson},'$.attempt') IS 'integer' AND json_type(${t.payloadJson},'$.targetKind') IS 'text' AND json_type(${t.payloadJson},'$.targetId') IS 'text' AND json_type(${t.payloadJson},'$.targetRevision') IS 'integer' AND json_type(${t.payloadJson},'$.plan.deadlineAt') IS 'text' AND json_type(${t.payloadJson},'$.plan.maximumAttempts') IS 'integer' AND json_type(${t.payloadJson},'$.plan.quantities') IS 'array' AND json_array_length(${t.payloadJson},'$.plan.quantities') BETWEEN 1 AND 32 AND length(CAST(${t.payloadJson} AS BLOB))<=65536`,
    ),
    check(
      "v2_execution_bounds",
      sql`typeof(${t.operationRevision})='integer' AND ${t.operationRevision} BETWEEN 1 AND 9007199254740991 AND typeof(${t.targetRevision})='integer' AND ${t.targetRevision} BETWEEN 1 AND 9007199254740991 AND typeof(${t.attempt})='integer' AND ${t.attempt} BETWEEN 1 AND 10 AND ${t.targetKind} IN ('workspace','file','report','profile_asset') AND ${t.service} IN ('model','asr','container','storage','requests','fixed_operation') AND (${t.fencing} IS NULL OR (typeof(${t.fencing})='integer' AND ${t.fencing} BETWEEN 1 AND 9007199254740991)) AND (${t.anchorJson} IS NULL OR length(CAST(${t.anchorJson} AS BLOB))<=1048576)`,
    ),
    check(
      "v2_execution_target_binding",
      sql`json_extract(${t.payloadJson},'$.service') IS ${t.service} AND (${t.kind}!='job' OR json_extract(${t.payloadJson},'$.jobId') IS ${t.jobId}) AND (${t.kind}!='storage' OR (json_extract(${t.payloadJson},'$.reservationId') IS ${t.reservationId} AND json_extract(${t.payloadJson},'$.blobId') IS ${t.blobId} AND json_extract(${t.payloadJson},'$.intent.kind') IS ${t.scope}))`,
    ),
    check(
      "v2_execution_hashes",
      sql`length(${t.digest})=64 AND ${t.digest} NOT GLOB '*[^0-9a-f]*' AND length(${t.evidenceHash})=64 AND ${t.evidenceHash} NOT GLOB '*[^0-9a-f]*' AND length(${t.requestHash})=64 AND ${t.requestHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "v2_execution_time",
      sql`${t.verifiedAt}<=${t.createdAt} AND ${t.deadlineAt}>${t.createdAt}`,
    ),
    check("v2_execution_state", sql`${t.state} IN ('prepared','dispatched','unknown','final')`),
    check(
      "v2_execution_transport",
      sql`${t.transport} IS NULL OR ${t.transport} IN ('response','provider_error','unknown','not_sent')`,
    ),
    check(
      "v2_execution_dispatch",
      sql`(${t.state}='prepared' AND ${t.dispatchToken} IS NULL AND ${t.dispatchedAt} IS NULL AND ${t.transport} IS NULL) OR (${t.state}='final' AND ${t.transport}='not_sent' AND ${t.dispatchToken} IS NULL AND ${t.dispatchedAt} IS NULL) OR (${t.state} IN ('dispatched','unknown','final') AND ${t.dispatchToken} IS NOT NULL AND ${t.dispatchedAt} IS NOT NULL AND (${t.kind}='storage' OR (${t.leaseToken} IS NOT NULL AND ${t.fencing}>=1)))`,
    ),
    check(
      "v2_execution_observation",
      sql`(${t.transport} IS NULL AND ${t.transportObservedAt} IS NULL AND ${t.transportDigest} IS NULL) OR (${t.transport} IS NOT NULL AND ${t.transportObservedAt} IS NOT NULL AND length(${t.transportDigest})=64)`,
    ),
  ],
);

export const v2ExecutionCostObservations = sqliteTable(
  "v2_execution_cost_observations",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => v2ExecutionAdmissions.attemptId),
    digest: text("digest").notNull(),
    payloadJson: text("payload_json").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    verifiedAt: text("verified_at").notNull(),
    observedAt: text("observed_at").notNull(),
    pricingProofId: text("pricing_proof_id").references(() => v2RuntimeProofs.id),
    fundingProofId: text("funding_proof_id").references(() => v2RuntimeProofs.id),
    pricingStatus: text("pricing_status").notNull(),
    fundingStatus: text("funding_status").notNull(),
    chargedUsd: text("charged_usd"),
    chargedKrw: integer("charged_krw"),
  },
  (t) => [
    uniqueIndex("v2_execution_observation_digest").on(t.attemptId, t.digest),
    check(
      "v2_execution_observation_payload",
      sql`json_valid(${t.payloadJson}) AND json_extract(${t.payloadJson},'$.attemptId')=${t.attemptId} AND json_extract(${t.payloadJson},'$.observedAt')=${t.observedAt}`,
    ),
    check(
      "v2_execution_observation_fields",
      sql`json_type(${t.payloadJson},'$.id') IS 'text' AND json_extract(${t.payloadJson},'$.id') IS ${t.id} AND json_type(${t.payloadJson},'$.attemptId') IS 'text' AND json_type(${t.payloadJson},'$.observedAt') IS 'text' AND json_type(${t.payloadJson},'$.transport') IS 'text' AND json_extract(${t.payloadJson},'$.transport') IN ('response','unknown','not_sent','provider_error') AND json_type(${t.payloadJson},'$.quantities') IS 'array' AND json_array_length(${t.payloadJson},'$.quantities')<=32 AND (json_type(${t.payloadJson},'$.chargedUsd') IS 'null' OR json_type(${t.payloadJson},'$.chargedUsd') IS 'text') AND json_extract(${t.payloadJson},'$.chargedUsd') IS ${t.chargedUsd} AND length(CAST(${t.payloadJson} AS BLOB))<=65536 AND length(${t.digest})=64 AND ${t.digest} NOT GLOB '*[^0-9a-f]*' AND length(${t.evidenceHash})=64 AND ${t.evidenceHash} NOT GLOB '*[^0-9a-f]*' AND ${t.observedAt}<=${t.verifiedAt}`,
    ),
    check(
      "v2_execution_observation_references",
      sql`((${t.pricingStatus}='missing')=(${t.pricingProofId} IS NULL)) AND ((${t.fundingStatus}='missing')=(${t.fundingProofId} IS NULL))`,
    ),
    check(
      "v2_execution_price_status",
      sql`${t.pricingStatus} IN ('missing','stale','incomplete','current')`,
    ),
    check(
      "v2_execution_funding_status",
      sql`${t.fundingStatus} IN ('missing','stale','unavailable','current')`,
    ),
    check(
      "v2_execution_observation_amount",
      sql`${t.chargedKrw} IS NULL OR (typeof(${t.chargedKrw})='integer' AND ${t.chargedKrw} BETWEEN 0 AND 9007199254740991 AND ${t.pricingStatus}='current')`,
    ),
  ],
);
