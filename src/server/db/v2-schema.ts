import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { cases, user } from "./schema";

// All strings in SQL constraints are server-owned constants. Private content is never an index key.
const id = () => text("id").primaryKey();
const owner = () =>
  text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });
const revision = () => integer("revision").notNull().default(1);
const created = () => text("created_at").notNull();
const payload = () => text("encrypted_payload").notNull();

export const v2RoleBindings = sqliteTable(
  "v2_role_bindings",
  {
    ownerId: owner(),
    role: text("role").notNull(),
    revision: revision(),
    grantedAt: text("granted_at").notNull(),
    grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.role] }),
    check(
      "v2_role_enum",
      sql`${t.role} IN ('user','lawyer_applicant','verified_lawyer','moderator')`,
    ),
    check("v2_role_revision", sql`${t.revision} >= 1`),
    uniqueIndex("v2_lawyer_role_exclusive")
      .on(t.ownerId)
      .where(sql`${t.role} IN ('lawyer_applicant','verified_lawyer')`),
  ],
);
export const v2RoleAudit = sqliteTable(
  "v2_role_audit",
  {
    id: id(),
    subjectToken: text("subject_token").notNull(),
    actorToken: text("actor_token").notNull(),
    role: text("role").notNull(),
    action: text("action").notNull(),
    createdAt: created(),
  },
  (t) => [check("v2_role_audit_action", sql`${t.action} IN ('grant','revoke')`)],
);
// Ephemeral claims exist only inside a D1 batch and gate every dependent statement.
export const v2MutationClaims = sqliteTable(
  "v2_mutation_claims",
  {
    id: id(),
    ownerId: owner(),
    targetId: text("target_id").notNull(),
    revision: revision(),
    verified: integer("verified").notNull().default(1),
  },
  (t) => [check("v2_claim_integrity", sql`${t.verified}=1`)],
);

export const v2Workspaces = sqliteTable(
  "v2_workspaces",
  {
    id: id(),
    ownerId: owner(),
    revision: revision(),
    intakeRevision: integer("intake_revision").notNull().default(1),
    status: text("status").notNull().default("intake"),
    archivedFrom: text("archived_from"),
    confirmedSummaryRevision: integer("confirmed_summary_revision"),
    currentJobId: text("current_job_id"),
    legacyCaseId: text("legacy_case_id").references(() => cases.id, { onDelete: "cascade" }),
    legacySnapshotId: text("legacy_snapshot_id"),
    encryptedPayload: payload(),
    createdAt: created(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("v2_workspace_owner_idx").on(t.ownerId, t.createdAt, t.id),
    uniqueIndex("v2_workspace_legacy_unique").on(t.legacyCaseId),
    check(
      "v2_workspace_revision",
      sql`${t.revision} BETWEEN 1 AND 9007199254740991 AND ${t.intakeRevision} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "v2_workspace_lifecycle",
      sql`${t.status} IN ('intake','active','archived') AND
    ((${t.status} = 'archived' AND ${t.archivedFrom} IN ('intake','active') AND ${t.currentJobId} IS NULL) OR (${t.status} != 'archived' AND ${t.archivedFrom} IS NULL)) AND
    (coalesce(${t.archivedFrom},${t.status}) != 'active' OR ${t.confirmedSummaryRevision} IS NOT NULL)`,
    ),
  ],
);
const workspace = () =>
  text("workspace_id")
    .notNull()
    .references(() => v2Workspaces.id, { onDelete: "cascade" });
export const v2Intakes = sqliteTable(
  "v2_intakes",
  {
    id: text("id")
      .primaryKey()
      .references(() => v2Workspaces.id, { onDelete: "cascade" }),
    revision: revision(),
    status: text("status").notNull(),
    summaryId: text("summary_id"),
    confirmedSummaryRevision: integer("confirmed_summary_revision"),
    currentJobId: text("current_job_id"),
    encryptedPayload: payload(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check(
      "v2_intake_lifecycle",
      sql`${t.revision} >= 1 AND ${t.status} IN ('collecting','generating_questions','reviewing_summary','confirmed') AND
  ((${t.status} = 'confirmed' AND ${t.summaryId} IS NOT NULL AND ${t.confirmedSummaryRevision} IS NOT NULL AND ${t.currentJobId} IS NULL) OR
   (${t.status} = 'reviewing_summary' AND ${t.summaryId} IS NOT NULL AND ${t.confirmedSummaryRevision} IS NULL AND ${t.currentJobId} IS NULL) OR
   (${t.status} = 'collecting' AND ${t.summaryId} IS NULL AND ${t.confirmedSummaryRevision} IS NULL AND ${t.currentJobId} IS NULL) OR
   (${t.status} = 'generating_questions' AND ${t.summaryId} IS NULL AND ${t.confirmedSummaryRevision} IS NULL AND ${t.currentJobId} IS NOT NULL))`,
    ),
  ],
);
export const v2QuestionBatches = sqliteTable(
  "v2_question_batches",
  {
    id: id(),
    workspaceId: workspace(),
    ordinal: integer("ordinal").notNull(),
    revision: revision(),
    intakeRevision: integer("intake_revision").notNull(),
    encryptedPayload: payload(),
    questionCount: integer("question_count").notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("v2_batch_ordinal_unique").on(t.workspaceId, t.ordinal),
    check(
      "v2_batch_bounds",
      sql`${t.ordinal} BETWEEN 1 AND 3 AND ${t.revision} >= 1 AND ${t.intakeRevision} >= 1 AND ${t.questionCount} BETWEEN 1 AND 5`,
    ),
  ],
);
export const v2Answers = sqliteTable(
  "v2_answers",
  {
    id: id(),
    batchId: text("batch_id")
      .notNull()
      .references(() => v2QuestionBatches.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    revision: revision(),
    status: text("status").notNull(),
    encryptedPayload: payload(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("v2_answer_question_unique").on(t.batchId, t.questionId),
    check(
      "v2_answer_status",
      sql`${t.status} IN ('answered','unknown','skipped') AND ${t.revision} >= 1`,
    ),
  ],
);

export const v2PrivateSnapshots = sqliteTable(
  "v2_private_snapshots",
  {
    id: id(),
    ownerId: owner(),
    workspaceId: text("workspace_id").references(() => v2Workspaces.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    targetId: text("target_id").notNull(),
    revision: revision(),
    partCount: integer("part_count").notNull(),
    byteLength: integer("byte_length").notNull(),
    encryptedPayload: payload(),
    createdAt: created(),
    state: text("state").notNull().default("published"),
    writtenParts: integer("written_parts").notNull().default(0),
    writtenBytes: integer("written_bytes").notNull().default(0),
    workspaceRevision: integer("workspace_revision"),
    leaseJobId: text("lease_job_id"),
    leaseFencing: integer("lease_fencing"),
  },
  (t) => [
    uniqueIndex("v2_snapshot_version_unique").on(t.purpose, t.targetId, t.revision),
    check(
      "v2_snapshot_purpose",
      sql`${t.purpose} IN ('summary','report','file_coverage','file_manifest','legacy_snapshot','profile_revision')`,
    ),
    check(
      "v2_snapshot_bounds",
      sql`${t.revision} >= 1 AND ${t.partCount} BETWEEN 1 AND 100000 AND ${t.byteLength} BETWEEN 1 AND 104857600 AND ${t.state} IN ('staging','sealed','published','abandoned') AND ${t.writtenParts} BETWEEN 0 AND ${t.partCount} AND ${t.writtenBytes} BETWEEN 0 AND ${t.byteLength}`,
    ),
  ],
);
export const v2UpgradeStages = sqliteTable(
  "v2_upgrade_stages",
  {
    snapshotId: text("snapshot_id")
      .primaryKey()
      .references(() => v2PrivateSnapshots.id, { onDelete: "cascade" }),
    ownerId: owner(),
    legacyCaseId: text("legacy_case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    workspaceTargetId: text("workspace_target_id").notNull(),
    sourceRevision: integer("source_revision").notNull(),
    sourceDigest: text("source_digest").notNull(),
    encryptedPayload: payload(),
    expiresAt: text("expires_at").notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("v2_pending_upgrade_case_unique").on(t.legacyCaseId),
    check(
      "v2_upgrade_source",
      sql`${t.sourceRevision}>=1 AND length(${t.sourceDigest})=64 AND ${t.expiresAt}>${t.createdAt}`,
    ),
  ],
);
export const v2PrivateParts = sqliteTable(
  "v2_private_parts",
  {
    id: id(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => v2PrivateSnapshots.id, { onDelete: "cascade" }),
    partIndex: integer("part_index").notNull(),
    byteLength: integer("byte_length").notNull(),
    encryptedPayload: payload(),
  },
  (t) => [
    uniqueIndex("v2_snapshot_part_unique").on(t.snapshotId, t.partIndex),
    check(
      "v2_part_bounds",
      sql`${t.partIndex} BETWEEN 0 AND 99999 AND ${t.byteLength} BETWEEN 1 AND 262144 AND length(${t.encryptedPayload}) BETWEEN 24 AND 349583`,
    ),
  ],
);
export const v2Summaries = sqliteTable(
  "v2_summaries",
  {
    id: id(),
    workspaceId: workspace(),
    revision: revision(),
    intakeRevision: integer("intake_revision").notNull(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => v2PrivateSnapshots.id, { onDelete: "cascade" }),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("v2_summary_revision_unique").on(t.workspaceId, t.revision),
    check("v2_summary_revision", sql`${t.revision} >= 1 AND ${t.intakeRevision} >= 1`),
  ],
);

export const v2Facts = sqliteTable(
  "v2_facts",
  {
    id: id(),
    entityId: text("entity_id").notNull(),
    workspaceId: workspace(),
    revision: revision(),
    summaryRevision: integer("summary_revision").notNull(),
    snapshotId: text("snapshot_id").references(() => v2PrivateSnapshots.id, {
      onDelete: "cascade",
    }),
    encryptedPayload: payload(),
  },
  (t) => [
    uniqueIndex("v2_fact_version_unique").on(t.workspaceId, t.summaryRevision, t.entityId),
    index("v2_facts_workspace_idx").on(t.workspaceId, t.summaryRevision),
    check("v2_fact_revision", sql`${t.revision} >= 1 AND ${t.summaryRevision} >= 1`),
  ],
);
export const v2FactReferences = sqliteTable(
  "v2_fact_references",
  {
    factId: text("fact_id")
      .notNull()
      .references(() => v2Facts.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    kind: text("kind").notNull(),
    sourceId: text("source_id").notNull(),
    sourceRevision: integer("source_revision"),
  },
  (t) => [
    primaryKey({ columns: [t.factId, t.ordinal] }),
    check(
      "v2_fact_reference_kind",
      sql`${t.kind} IN ('intake_narrative','intake_answer','user_message','user_material','official_source') AND ${t.ordinal} >= 0 AND (${t.sourceRevision} IS NULL OR ${t.sourceRevision} >= 1)`,
    ),
  ],
);
export const v2Parties = sqliteTable(
  "v2_parties",
  {
    id: id(),
    entityId: text("entity_id").notNull(),
    workspaceId: workspace(),
    revision: revision(),
    summaryRevision: integer("summary_revision").notNull(),
    snapshotId: text("snapshot_id").references(() => v2PrivateSnapshots.id, {
      onDelete: "cascade",
    }),
    encryptedPayload: payload(),
  },
  (t) => [uniqueIndex("v2_party_version_unique").on(t.workspaceId, t.summaryRevision, t.entityId)],
);
export const v2Operations = sqliteTable(
  "v2_operations",
  {
    id: id(),
    ownerId: owner(),
    workspaceId: text("workspace_id").references(() => v2Workspaces.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    state: text("state").notNull().default("admitted"),
    revision: revision(),
    createdAt: created(),
  },
  (t) => [
    check(
      "v2_operation_kind",
      sql`${t.kind} IN ('new_case','question_batch','summary','chat','file_interpretation','file_extract','report','profile_asset','profile_revision','legacy_upgrade')`,
    ),
    check(
      "v2_operation_state",
      sql`${t.state} IN ('admitted','completed','failed','cancelled','ambiguous') AND ${t.revision} >= 1`,
    ),
  ],
);
export const v2Idempotency = sqliteTable(
  "v2_idempotency",
  {
    ownerId: owner(),
    route: text("route").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    operationId: text("operation_id")
      .notNull()
      .references(() => v2Operations.id, { onDelete: "cascade" }),
    createdAt: created(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.route, t.key] }),
    check(
      "v2_idempotency_hash",
      sql`length(${t.requestHash}) = 64 AND ${t.requestHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);
export const v2Messages = sqliteTable(
  "v2_messages",
  {
    id: id(),
    workspaceId: workspace(),
    revision: revision(),
    workspaceRevision: integer("workspace_revision").notNull(),
    operationId: text("operation_id")
      .notNull()
      .references(() => v2Operations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    safety: text("safety"),
    encryptedPayload: payload(),
    createdAt: created(),
  },
  (t) => [
    index("v2_messages_page_idx").on(t.workspaceId, t.createdAt, t.id),
    uniqueIndex("v2_message_operation_role_unique").on(t.operationId, t.role),
    check(
      "v2_message_role",
      sql`(${t.role} = 'user' AND ${t.safety} IS NULL) OR (${t.role} = 'assistant' AND ${t.safety} = 'validated')`,
    ),
  ],
);
export const v2Actions = sqliteTable(
  "v2_actions",
  {
    id: id(),
    entityId: text("entity_id").notNull(),
    workspaceId: workspace(),
    revision: revision(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    encryptedPayload: payload(),
  },
  (t) => [
    uniqueIndex("v2_action_entity_unique").on(t.workspaceId, t.entityId),
    check(
      "v2_action_enum",
      sql`${t.kind} IN ('evidence_preserve','fact_check','organize_materials','official_guide_check','ask_lawyer') AND ${t.status} IN ('todo','done','skipped') AND ${t.revision} >= 1`,
    ),
  ],
);
export const v2Timeline = sqliteTable(
  "v2_timeline",
  {
    id: id(),
    entityId: text("entity_id").notNull(),
    workspaceId: workspace(),
    revision: revision(),
    encryptedPayload: payload(),
  },
  (t) => [uniqueIndex("v2_timeline_entity_unique").on(t.workspaceId, t.entityId)],
);

// Billing principal and settled/ambiguous cost records deliberately survive account deletion.
export const v2BillingPrincipals = sqliteTable("v2_billing_principals", {
  id: id(),
  ownerId: text("owner_id")
    .unique()
    .references(() => user.id, { onDelete: "set null" }),
  createdAt: created(),
});
export const v2DailyUsage = sqliteTable(
  "v2_daily_usage",
  {
    ownerId: owner(),
    day: text("day").notNull(),
    casesUsed: integer("cases_used").notNull().default(0),
    casesReserved: integer("cases_reserved").notNull().default(0),
    responsesUsed: integer("responses_used").notNull().default(0),
    responsesReserved: integer("responses_reserved").notNull().default(0),
    mediaUsed: real("media_used").notNull().default(0),
    mediaReserved: real("media_reserved").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.day] }),
    check(
      "v2_daily_nonnegative",
      sql`${t.casesUsed} >= 0 AND ${t.casesReserved} >= 0 AND ${t.responsesUsed} >= 0 AND ${t.responsesReserved} >= 0 AND ${t.mediaUsed} >= 0 AND ${t.mediaReserved} >= 0`,
    ),
  ],
);
export const v2QuotaReservations = sqliteTable(
  "v2_quota_reservations",
  {
    id: id(),
    ownerId: owner(),
    operationId: text("operation_id")
      .notNull()
      .references(() => v2Operations.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    kind: text("kind").notNull(),
    responseKind: text("response_kind"),
    units: real("units").notNull(),
    state: text("state").notNull().default("reserved"),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("v2_quota_operation_kind_unique").on(t.operationId, t.kind),
    check(
      "v2_quota_kind",
      sql`(${t.kind} = 'new_case' AND ${t.units} = 1 AND ${t.responseKind} IS NULL) OR (${t.kind} = 'visible_response' AND ${t.units} = 1 AND ${t.responseKind} IN ('question_batch','summary','chat','file_interpretation')) OR (${t.kind} = 'media' AND ${t.units} > 0 AND ${t.units} <= 3600 AND ${t.responseKind} IS NULL)`,
    ),
    check("v2_quota_state", sql`${t.state} IN ('reserved','consumed','released')`),
  ],
);
export const v2StorageUsage = sqliteTable(
  "v2_storage_usage",
  {
    principalId: text("principal_id")
      .primaryKey()
      .references(() => v2BillingPrincipals.id),
    storedBytes: integer("stored_bytes").notNull().default(0),
    reservedBytes: integer("reserved_bytes").notNull().default(0),
  },
  (t) => [check("v2_storage_nonnegative", sql`${t.storedBytes} >= 0 AND ${t.reservedBytes} >= 0`)],
);
export const v2CaseOriginalUsage = sqliteTable(
  "v2_case_original_usage",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => v2Workspaces.id, { onDelete: "cascade" }),
    storedCount: integer("stored_count").notNull().default(0),
    reservedCount: integer("reserved_count").notNull().default(0),
    storedBytes: integer("stored_bytes").notNull().default(0),
    reservedBytes: integer("reserved_bytes").notNull().default(0),
  },
  (t) => [
    check(
      "v2_case_usage_nonnegative",
      sql`${t.storedCount} >= 0 AND ${t.reservedCount} >= 0 AND ${t.storedBytes} >= 0 AND ${t.reservedBytes} >= 0`,
    ),
  ],
);
export const v2StorageReservations = sqliteTable(
  "v2_storage_reservations",
  {
    id: id(),
    principalId: text("principal_id")
      .notNull()
      .references(() => v2BillingPrincipals.id),
    operationId: text("operation_id").notNull(),
    workspaceId: text("workspace_id").references(() => v2Workspaces.id, { onDelete: "set null" }),
    targetId: text("target_id").notNull(),
    entityId: text("entity_id").notNull(),
    kind: text("kind").notNull(),
    byteLength: integer("byte_length").notNull(),
    state: text("state").notNull().default("reserved"),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("v2_storage_target_unique").on(t.targetId, t.kind),
    check(
      "v2_storage_reservation_kind",
      sql`${t.kind} IN ('case_original','derived_report','lawyer_asset') AND ${t.byteLength} BETWEEN 1 AND 10000000000`,
    ),
    check("v2_storage_reservation_state", sql`${t.state} IN ('reserved','stored','released')`),
  ],
);
export const v2CostQuotes = sqliteTable(
  "v2_cost_quotes",
  {
    id: id(),
    version: integer("version").notNull(),
    reviewedAt: text("reviewed_at").notNull(),
    validUntil: text("valid_until").notNull(),
    currency: text("currency").notNull().default("KRW"),
    providerPricingVersion: text("provider_pricing_version").notNull(),
    exchangeRate: real("exchange_rate").notNull(),
    safetyMargin: real("safety_margin").notNull(),
    estimatedKrw: integer("estimated_krw").notNull(),
  },
  (t) => [
    check(
      "v2_quote_amount",
      sql`${t.currency} = 'KRW' AND ${t.version} >= 1 AND ${t.exchangeRate} > 0 AND ${t.exchangeRate} <= 100000 AND ${t.safetyMargin} BETWEEN 0 AND 10 AND ${t.estimatedKrw} >= 0 AND ${t.validUntil} > ${t.reviewedAt}`,
    ),
  ],
);
export const v2MonthlyBudget = sqliteTable(
  "v2_monthly_budget",
  {
    month: text("month").primaryKey(),
    allocationVersion: integer("allocation_version").notNull(),
    environment: text("environment").notNull(),
    limitKrw: integer("limit_krw").notNull(),
    settledKrw: integer("settled_krw").notNull().default(0),
    reservedKrw: integer("reserved_krw").notNull().default(0),
    ambiguousKrw: integer("ambiguous_krw").notNull().default(0),
    fixedMaintenanceKrw: integer("fixed_maintenance_krw").notNull().default(0),
  },
  (t) => [
    check(
      "v2_budget_amount",
      sql`${t.limitKrw} BETWEEN 0 AND 1000000 AND ${t.environment} IN ('preview','production') AND ${t.allocationVersion} >= 1 AND ${t.settledKrw} >= 0 AND ${t.reservedKrw} >= 0 AND ${t.ambiguousKrw} >= 0 AND ${t.fixedMaintenanceKrw} >= 0`,
    ),
  ],
);
export const v2BudgetAllocations = sqliteTable(
  "v2_budget_allocations",
  {
    month: text("month").notNull(),
    version: integer("version").notNull(),
    previewKrw: integer("preview_krw").notNull(),
    productionKrw: integer("production_krw").notNull(),
    sharedFixedKrw: integer("shared_fixed_krw").notNull(),
    maintenanceReserveKrw: integer("maintenance_reserve_krw").notNull(),
    pricingProvenance: text("pricing_provenance").notNull(),
    fxProvenance: text("fx_provenance").notNull(),
    fundingProvenance: text("funding_provenance").notNull(),
    reviewedAt: text("reviewed_at").notNull(),
    validUntil: text("valid_until").notNull(),
    fundingState: text("funding_state").notNull(),
    fundingValidUntil: text("funding_valid_until").notNull(),
    manifestHash: text("manifest_hash").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.month, t.version] }),
    check(
      "v2_allocation_amount",
      sql`${t.version}>=1 AND ${t.previewKrw}>=0 AND ${t.productionKrw}>=0 AND ${t.sharedFixedKrw}>=0 AND ${t.maintenanceReserveKrw}>=0 AND ${t.previewKrw}+${t.productionKrw}+${t.sharedFixedKrw}+${t.maintenanceReserveKrw}<=1000000 AND ${t.fundingState} IN ('funded','trial_credit','unavailable') AND ${t.validUntil}>${t.reviewedAt} AND length(${t.manifestHash})=64`,
    ),
  ],
);
export const v2AllocationAcknowledgments = sqliteTable(
  "v2_allocation_acknowledgments",
  {
    month: text("month").notNull(),
    version: integer("version").notNull(),
    environment: text("environment").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    drainReceiptId: text("drain_receipt_id").notNull(),
    acknowledgedAt: text("acknowledged_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.month, t.version, t.environment] }),
    check(
      "v2_allocation_ack_environment",
      sql`${t.environment} IN ('preview','production') AND ${t.version}>=1`,
    ),
  ],
);
export const v2CostAttempts = sqliteTable(
  "v2_cost_attempts",
  {
    id: id(),
    principalId: text("principal_id")
      .notNull()
      .references(() => v2BillingPrincipals.id),
    operationId: text("operation_id").notNull(),
    invocationId: text("invocation_id").notNull(),
    attempt: integer("attempt").notNull(),
    month: text("month")
      .notNull()
      .references(() => v2MonthlyBudget.month),
    quoteId: text("quote_id")
      .notNull()
      .references(() => v2CostQuotes.id),
    service: text("service").notNull(),
    state: text("state").notNull().default("reserved"),
    reservedKrw: integer("reserved_krw").notNull(),
    chargedKrw: integer("charged_krw"),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("v2_invocation_attempt_unique").on(t.invocationId, t.attempt),
    check(
      "v2_cost_attempt_state",
      sql`${t.state} IN ('reserved','settled','ambiguous','released') AND ${t.attempt} BETWEEN 1 AND 10 AND ${t.reservedKrw} >= 0 AND ((${t.state} = 'settled' AND ${t.chargedKrw} IS NOT NULL AND ${t.chargedKrw} >= 0) OR (${t.state} != 'settled' AND ${t.chargedKrw} IS NULL))`,
    ),
    check(
      "v2_cost_service",
      sql`${t.service} IN ('model','asr','container','storage','requests','fixed_operation')`,
    ),
  ],
);
export const v2CostReceipts = sqliteTable(
  "v2_cost_receipts",
  {
    id: id(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => v2CostAttempts.id),
    previousState: text("previous_state").notNull(),
    nextState: text("next_state").notNull(),
  },
  (t) => [
    uniqueIndex("v2_cost_receipt_transition_unique").on(t.attemptId, t.previousState),
    check(
      "v2_cost_receipt_transition",
      sql`(${t.previousState}='reserved' AND ${t.nextState} IN ('settled','ambiguous','released')) OR (${t.previousState}='ambiguous' AND ${t.nextState}='settled')`,
    ),
  ],
);

export const v2Blobs = sqliteTable(
  "v2_blobs",
  {
    id: id(),
    principalId: text("principal_id")
      .notNull()
      .references(() => v2BillingPrincipals.id),
    reservationId: text("reservation_id")
      .notNull()
      .references(() => v2StorageReservations.id),
    kind: text("kind").notNull(),
    visibility: text("visibility").notNull(),
    state: text("state").notNull().default("pending"),
    objectKey: text("object_key").notNull().unique(),
    logicalBytes: integer("logical_bytes").notNull(),
    cipherBytes: integer("cipher_bytes").notNull().default(0),
    cipherHash: text("cipher_hash"),
    keyVersion: text("key_version"),
    encryptedPayload: payload(),
    createdAt: created(),
    deletedAt: text("deleted_at"),
    sourceBlobId: text("source_blob_id"),
    sourceAssetRevision: integer("source_asset_revision"),
    approvedRevisionId: text("approved_revision_id"),
  },
  (t) => [
    check(
      "v2_blob_enum",
      sql`${t.kind} IN ('original','derivative','report_pdf','original_zip','verification','portfolio_original','portfolio_sanitized','profile_photo_original','profile_photo_sanitized','public_copy') AND ${t.visibility} IN ('private','staging','public') AND ${t.state} IN ('pending','stored','deleting','deleted')`,
    ),
    check(
      "v2_blob_bytes",
      sql`${t.logicalBytes} > 0 AND ${t.cipherBytes} >= 0 AND (${t.state} != 'deleted' OR ${t.deletedAt} IS NOT NULL)`,
    ),
    check(
      "v2_blob_encryption",
      sql`${t.visibility} = 'public' OR ${t.state} != 'stored' OR ${t.keyVersion} IS NOT NULL`,
    ),
    check(
      "v2_public_copy_provenance",
      sql`${t.visibility}!='public' OR (${t.kind}='public_copy' AND ${t.sourceBlobId} IS NOT NULL AND ${t.sourceAssetRevision}>=1 AND ${t.approvedRevisionId} IS NOT NULL)`,
    ),
  ],
);
export const v2Files = sqliteTable(
  "v2_files",
  {
    id: id(),
    workspaceId: workspace(),
    revision: revision(),
    operationId: text("operation_id")
      .notNull()
      .references(() => v2Operations.id, { onDelete: "cascade" }),
    originalBlobId: text("original_blob_id").references(() => v2Blobs.id),
    state: text("state").notNull(),
    declaredBytes: integer("declared_bytes").notNull(),
    probeKind: text("probe_kind"),
    manifestSnapshotId: text("manifest_snapshot_id").references(() => v2PrivateSnapshots.id),
    coverageSnapshotId: text("coverage_snapshot_id").references(() => v2PrivateSnapshots.id),
    currentJobId: text("current_job_id"),
    failureCode: text("failure_code"),
    encryptedPayload: payload(),
    createdAt: created(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("v2_files_workspace_idx").on(t.workspaceId, t.createdAt, t.id),
    check(
      "v2_file_state",
      sql`${t.state} IN ('reserved','uploading','uploaded','queued','processing','ready','failed','deleting') AND ${t.revision} >= 1 AND ${t.declaredBytes} BETWEEN 1 AND 1000000000`,
    ),
    check(
      "v2_file_failure",
      sql`(${t.state} = 'failed' AND ${t.failureCode} IS NOT NULL) OR (${t.state} != 'failed' AND ${t.failureCode} IS NULL)`,
    ),
    check(
      "v2_file_ready",
      sql`${t.state} != 'ready' OR (${t.probeKind} IN ('document','image','audio','video') AND ${t.manifestSnapshotId} IS NOT NULL AND ${t.coverageSnapshotId} IS NOT NULL AND ${t.currentJobId} IS NULL)`,
    ),
  ],
);
export const v2UploadSessions = sqliteTable(
  "v2_upload_sessions",
  {
    id: id(),
    fileId: text("file_id")
      .notNull()
      .unique()
      .references(() => v2Files.id, { onDelete: "cascade" }),
    revision: revision(),
    reservedBytes: integer("reserved_bytes").notNull(),
    chunkBytes: integer("chunk_bytes").notNull().default(8388608),
    state: text("state").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: created(),
    encryptedPayload: text("encrypted_payload"),
  },
  (t) => [
    check(
      "v2_upload_state",
      sql`${t.state} IN ('open','finalized','expired','cancelled') AND ${t.chunkBytes} = 8388608 AND ${t.reservedBytes} BETWEEN 1 AND 1000000000`,
    ),
  ],
);
export const v2UploadParts = sqliteTable(
  "v2_upload_parts",
  {
    uploadId: text("upload_id")
      .notNull()
      .references(() => v2UploadSessions.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    blobId: text("blob_id")
      .notNull()
      .references(() => v2Blobs.id),
    byteLength: integer("byte_length").notNull(),
    cipherHash: text("cipher_hash").notNull(),
    encryptedPayload: payload(),
  },
  (t) => [
    primaryKey({ columns: [t.uploadId, t.ordinal] }),
    check(
      "v2_upload_part_bounds",
      sql`${t.ordinal} BETWEEN 0 AND 119 AND ${t.byteLength} BETWEEN 1 AND 8388608 AND length(${t.cipherHash}) = 64`,
    ),
  ],
);
export const v2FileEditStages = sqliteTable(
  "v2_file_edit_stages",
  {
    id: id(),
    ownerId: owner(),
    workspaceId: workspace(),
    fileId: text("file_id")
      .notNull()
      .references(() => v2Files.id, { onDelete: "cascade" }),
    sourceRevision: integer("source_revision").notNull(),
    targetRevision: integer("target_revision").notNull(),
    sourceCoverageId: text("source_coverage_id")
      .notNull()
      .references(() => v2PrivateSnapshots.id),
    targetCoverageId: text("target_coverage_id")
      .notNull()
      .references(() => v2PrivateSnapshots.id, { onDelete: "cascade" }),
    workspaceRevision: integer("workspace_revision").notNull(),
    observationCount: integer("observation_count").notNull(),
    derivativeCount: integer("derivative_count").notNull(),
    encryptedPayload: payload(),
    createdAt: created(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("v2_file_edit_coverage_unique").on(t.targetCoverageId),
    check(
      "v2_file_edit_bounds",
      sql`${t.sourceRevision}>=1 AND ${t.targetRevision}=${t.sourceRevision}+1 AND ${t.workspaceRevision}>=1 AND ${t.observationCount} BETWEEN 0 AND 10000 AND ${t.derivativeCount} BETWEEN 0 AND 20000 AND ${t.expiresAt}>${t.createdAt}`,
    ),
  ],
);
export const v2FileEditReceipts = sqliteTable(
  "v2_file_edit_receipts",
  {
    stageId: text("stage_id")
      .notNull()
      .references(() => v2FileEditStages.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    ordinal: integer("ordinal").notNull(),
    sourceId: text("source_id").notNull(),
    sourcePayload: text("source_payload").notNull(),
    targetId: text("target_id").notNull(),
    targetPayload: text("target_payload").notNull(),
    sourceBlobId: text("source_blob_id"),
    sourceBlobPayload: text("source_blob_payload"),
  },
  (t) => [
    primaryKey({ columns: [t.stageId, t.kind, t.ordinal] }),
    check(
      "v2_file_edit_receipt_kind",
      sql`${t.kind} IN ('coverage','observation','derivative') AND ${t.ordinal}>=0`,
    ),
  ],
);
export const v2FileDerivatives = sqliteTable(
  "v2_file_derivatives",
  {
    id: id(),
    entityId: text("entity_id").notNull(),
    fileId: text("file_id")
      .notNull()
      .references(() => v2Files.id, { onDelete: "cascade" }),
    fileRevision: integer("file_revision").notNull(),
    kind: text("kind").notNull(),
    blobId: text("blob_id")
      .notNull()
      .references(() => v2Blobs.id),
    ordinal: integer("ordinal").notNull(),
    encryptedPayload: payload(),
    snapshotId: text("snapshot_id").references(() => v2PrivateSnapshots.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    uniqueIndex("v2_derivative_entity_unique").on(t.fileId, t.fileRevision, t.entityId),
    uniqueIndex("v2_derivative_ordinal_unique").on(t.fileId, t.fileRevision, t.ordinal),
    check(
      "v2_derivative_kind",
      sql`${t.kind} IN ('extracted_text','transcript','sampled_frame','observation') AND ${t.fileRevision} >= 1 AND ${t.ordinal} >= 0`,
    ),
  ],
);
export const v2FileObservations = sqliteTable(
  "v2_file_observations",
  {
    id: id(),
    entityId: text("entity_id").notNull(),
    fileId: text("file_id")
      .notNull()
      .references(() => v2Files.id, { onDelete: "cascade" }),
    revision: revision(),
    fileRevision: integer("file_revision").notNull(),
    ordinal: integer("ordinal").notNull(),
    encryptedPayload: payload(),
    snapshotId: text("snapshot_id").references(() => v2PrivateSnapshots.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    uniqueIndex("v2_observation_entity_unique").on(t.fileId, t.fileRevision, t.entityId),
    uniqueIndex("v2_observation_ordinal_unique").on(t.fileId, t.fileRevision, t.ordinal),
  ],
);
export const v2Consents = sqliteTable(
  "v2_consents",
  {
    id: id(),
    ownerId: owner(),
    fileId: text("file_id").references(() => v2Files.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    version: text("version").notNull(),
    revision: revision(),
    encryptedPayload: payload(),
    createdAt: created(),
  },
  (t) => [
    check(
      "v2_consent_kind",
      sql`${t.kind} IN ('auto_processing','original_export','profile_publication')`,
    ),
  ],
);

export const v2Profiles = sqliteTable("v2_profiles", {
  id: id(),
  ownerId: owner().unique(),
  revision: revision(),
  approvedRevisionId: text("approved_revision_id"),
  createdAt: created(),
  updatedAt: text("updated_at").notNull(),
});
const profile = () =>
  text("profile_id")
    .notNull()
    .references(() => v2Profiles.id, { onDelete: "cascade" });
export const v2Applications = sqliteTable(
  "v2_applications",
  {
    id: id(),
    ownerId: owner(),
    revision: revision(),
    status: text("status").notNull(),
    encryptedPayload: payload(),
    submittedAt: text("submitted_at"),
    decidedAt: text("decided_at"),
    withdrawnAt: text("withdrawn_at"),
    reviewerId: text("reviewer_id"),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("v2_application_owner_revision_unique").on(t.ownerId, t.revision),
    check(
      "v2_application_status",
      sql`${t.status} IN ('draft','submitted','approved','rejected','withdrawn') AND ${t.revision} >= 1 AND (${t.status} NOT IN ('submitted','approved','rejected') OR ${t.submittedAt} IS NOT NULL) AND (${t.status} NOT IN ('approved','rejected') OR ${t.decidedAt} IS NOT NULL) AND (${t.reviewerId} IS NULL OR ${t.reviewerId} != ${t.ownerId})`,
    ),
  ],
);
export const v2Assets = sqliteTable(
  "v2_assets",
  {
    id: id(),
    ownerId: owner(),
    profileId: text("profile_id").references(() => v2Profiles.id, { onDelete: "cascade" }),
    revision: revision(),
    purpose: text("purpose").notNull(),
    state: text("state").notNull(),
    originalBlobId: text("original_blob_id").references(() => v2Blobs.id),
    sanitizedBlobId: text("sanitized_blob_id").references(() => v2Blobs.id),
    currentJobId: text("current_job_id"),
    failureCode: text("failure_code"),
    encryptedPayload: payload(),
    createdAt: created(),
  },
  (t) => [
    check(
      "v2_asset_enum",
      sql`${t.purpose} IN ('profile_photo','portfolio','identity','lawyer_license','office') AND ${t.state} IN ('reserved','uploaded','sanitizing','ready','failed','rejected','deleting') AND ${t.revision} >= 1`,
    ),
    check(
      "v2_asset_sanitization",
      sql`${t.state} != 'ready' OR ${t.purpose} IN ('identity','lawyer_license','office') OR ${t.sanitizedBlobId} IS NOT NULL`,
    ),
  ],
);
export const v2ApplicationAssets = sqliteTable(
  "v2_application_assets",
  {
    applicationId: text("application_id")
      .notNull()
      .references(() => v2Applications.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => v2Assets.id),
  },
  (t) => [primaryKey({ columns: [t.applicationId, t.assetId] })],
);
export const v2ProfileRevisions = sqliteTable(
  "v2_profile_revisions",
  {
    id: id(),
    profileId: profile(),
    revision: revision(),
    status: text("status").notNull(),
    applicationId: text("application_id").references(() => v2Applications.id),
    encryptedPayload: payload(),
    submittedAt: text("submitted_at"),
    decidedAt: text("decided_at"),
    withdrawnAt: text("withdrawn_at"),
    reviewerId: text("reviewer_id"),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("v2_profile_revision_unique").on(t.profileId, t.revision),
    check(
      "v2_profile_revision_status",
      sql`${t.status} IN ('draft','submitted','approved','rejected','withdrawn') AND ${t.revision} >= 1 AND (${t.status} NOT IN ('submitted','approved','rejected') OR (${t.submittedAt} IS NOT NULL AND ${t.applicationId} IS NOT NULL)) AND (${t.status} NOT IN ('approved','rejected') OR ${t.decidedAt} IS NOT NULL)`,
    ),
  ],
);
export const v2ProfileRevisionAssets = sqliteTable(
  "v2_profile_revision_assets",
  {
    revisionId: text("revision_id")
      .notNull()
      .references(() => v2ProfileRevisions.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => v2Assets.id),
    assetRevision: integer("asset_revision").notNull(),
    ordinal: integer("ordinal").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.assetId] }),
    uniqueIndex("v2_profile_asset_order_unique").on(t.revisionId, t.ordinal),
  ],
);
export const v2ModerationDecisions = sqliteTable(
  "v2_moderation_decisions",
  {
    id: id(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    targetRevision: integer("target_revision").notNull(),
    reviewerId: text("reviewer_id").notNull(),
    ownerId: owner(),
    decision: text("decision").notNull(),
    encryptedPayload: payload(),
    oauthAuthenticatedAt: text("oauth_authenticated_at").notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("v2_moderation_target_unique").on(t.targetKind, t.targetId, t.targetRevision),
    check(
      "v2_moderation_decision",
      sql`${t.targetKind} IN ('application','profile') AND ${t.decision} IN ('approve','reject') AND ${t.targetRevision} >= 1 AND (${t.reviewerId} IS NULL OR ${t.reviewerId} != ${t.ownerId})`,
    ),
  ],
);
export const v2PublicProfiles = sqliteTable(
  "v2_public_profiles",
  {
    profileId: text("profile_id")
      .primaryKey()
      .references(() => v2Profiles.id, { onDelete: "cascade" }),
    revisionId: text("revision_id")
      .notNull()
      .unique()
      .references(() => v2ProfileRevisions.id),
    approvedRevision: integer("approved_revision").notNull(),
    contentJson: text("content_json").notNull(),
    publishedAt: text("published_at").notNull(),
  },
  (t) => [
    check(
      "v2_public_profile_content",
      sql`json_valid(${t.contentJson}) AND ${t.approvedRevision} >= 1`,
    ),
  ],
);
export const v2PublicAssets = sqliteTable(
  "v2_public_assets",
  {
    profileId: text("profile_id")
      .notNull()
      .references(() => v2PublicProfiles.profileId, { onDelete: "cascade" }),
    revisionId: text("revision_id")
      .notNull()
      .references(() => v2ProfileRevisions.id),
    assetId: text("asset_id")
      .notNull()
      .references(() => v2Assets.id),
    sanitizedBlobId: text("sanitized_blob_id")
      .notNull()
      .references(() => v2Blobs.id),
    publicBlobId: text("public_blob_id")
      .notNull()
      .references(() => v2Blobs.id),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.assetId] })],
);
export const v2ModerationReports = sqliteTable(
  "v2_moderation_reports",
  {
    id: id(),
    profileId: profile(),
    reporterId: text("reporter_id").references(() => user.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    state: text("state").notNull(),
    revision: revision(),
    resolution: text("resolution"),
    encryptedPayload: payload(),
    createdAt: created(),
  },
  (t) => [
    check(
      "v2_moderation_report_enum",
      sql`${t.kind} IN ('identity','misleading_information','personal_data','unsafe_asset','advertising','other') AND ${t.state} IN ('open','reviewing','resolved','dismissed') AND ((${t.state} IN ('resolved','dismissed') AND ${t.resolution} IS NOT NULL) OR (${t.state} IN ('open','reviewing') AND ${t.resolution} IS NULL))`,
    ),
  ],
);
export const v2DirectorySnapshots = sqliteTable(
  "v2_directory_snapshots",
  {
    id: id(),
    createdAt: created(),
    expiresAt: text("expires_at").notNull(),
    queryJson: text("query_json").notNull().default("{}"),
    rotationDay: text("rotation_day").notNull(),
    rotationAlgorithm: text("rotation_algorithm").notNull().default("profile_id_daily_v1"),
    itemCount: integer("item_count").notNull().default(0),
  },
  (t) => [
    check(
      "v2_directory_snapshot_bounds",
      sql`json_valid(${t.queryJson}) AND ${t.itemCount} BETWEEN 0 AND 9007199254740991 AND typeof(${t.itemCount})='integer' AND ${t.rotationAlgorithm}='profile_id_daily_v1' AND length(${t.rotationDay})=10 AND ${t.expiresAt}>${t.createdAt}`,
    ),
  ],
);
export const v2DirectoryItems = sqliteTable(
  "v2_directory_items",
  {
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => v2DirectorySnapshots.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    profileId: text("profile_id")
      .notNull()
      .references(() => v2Profiles.id, { onDelete: "cascade" }),
    revisionId: text("revision_id")
      .notNull()
      .references(() => v2ProfileRevisions.id),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.ordinal] }),
    uniqueIndex("v2_directory_profile_unique").on(t.snapshotId, t.profileId),
  ],
);

export const v2Reports = sqliteTable(
  "v2_reports",
  {
    id: id(),
    workspaceId: workspace(),
    revision: revision(),
    workspaceRevision: integer("workspace_revision").notNull(),
    summaryRevision: integer("summary_revision").notNull(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => v2PrivateSnapshots.id),
    operationId: text("operation_id")
      .notNull()
      .references(() => v2Operations.id, { onDelete: "cascade" }),
    state: text("state").notNull(),
    pdfBlobId: text("pdf_blob_id").references(() => v2Blobs.id),
    zipBlobId: text("zip_blob_id").references(() => v2Blobs.id),
    currentJobId: text("current_job_id"),
    failureCode: text("failure_code"),
    encryptedPayload: payload(),
    createdAt: created(),
  },
  (t) => [
    check(
      "v2_report_state",
      sql`${t.state} IN ('queued','building','ready','failed','obsolete') AND ${t.workspaceRevision} >= 1 AND ${t.summaryRevision} >= 1 AND ${t.revision} >= 1`,
    ),
    check(
      "v2_report_ready",
      sql`${t.state} NOT IN ('ready','obsolete') OR (${t.pdfBlobId} IS NOT NULL AND ${t.currentJobId} IS NULL AND ${t.failureCode} IS NULL)`,
    ),
    check(
      "v2_report_failure",
      sql`(${t.state} = 'failed' AND ${t.failureCode} IS NOT NULL AND ${t.currentJobId} IS NULL) OR (${t.state} != 'failed' AND ${t.failureCode} IS NULL)`,
    ),
  ],
);
export const v2ReportSelections = sqliteTable(
  "v2_report_selections",
  {
    id: id(),
    encryptedPayload: payload(),
    reportId: text("report_id")
      .notNull()
      .references(() => v2Reports.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => v2Files.id),
    fileRevision: integer("file_revision").notNull(),
    originalSelected: integer("original_selected").notNull().default(0),
    ordinal: integer("ordinal").notNull(),
  },
  (t) => [
    uniqueIndex("v2_report_selection_file_unique").on(t.reportId, t.fileId),
    uniqueIndex("v2_report_selection_order_unique").on(t.reportId, t.ordinal),
    check(
      "v2_report_selection_bounds",
      sql`${t.originalSelected} IN (0,1) AND ${t.fileRevision} >= 1 AND ${t.ordinal} >= 0`,
    ),
  ],
);
export const v2ReportSelectionStages = sqliteTable(
  "v2_report_selection_stages",
  {
    id: id(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => v2PrivateSnapshots.id, { onDelete: "cascade" }),
    reportId: text("report_id").notNull(),
    fileId: text("file_id")
      .notNull()
      .references(() => v2Files.id, { onDelete: "cascade" }),
    fileRevision: integer("file_revision").notNull(),
    ordinal: integer("ordinal").notNull(),
    encryptedPayload: payload(),
    sourceFileEnvelope: text("source_file_envelope").notNull(),
    sourceManifestId: text("source_manifest_id").notNull(),
    sourceManifestEnvelope: text("source_manifest_envelope").notNull(),
  },
  (t) => [
    uniqueIndex("v2_report_stage_file_unique").on(t.snapshotId, t.fileId),
    uniqueIndex("v2_report_stage_order_unique").on(t.snapshotId, t.ordinal),
    check("v2_report_stage_bounds", sql`${t.ordinal} BETWEEN 0 AND 99 AND ${t.fileRevision}>=1`),
  ],
);

export const v2Jobs = sqliteTable(
  "v2_jobs",
  {
    id: id(),
    operationId: text("operation_id")
      .notNull()
      .references(() => v2Operations.id, { onDelete: "cascade" }),
    runtimeInstanceId: text("runtime_instance_id").notNull().unique(),
    workspaceId: text("workspace_id").references(() => v2Workspaces.id, { onDelete: "cascade" }),
    profileId: text("profile_id").references(() => v2Profiles.id, { onDelete: "cascade" }),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    targetRevision: integer("target_revision").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("queued"),
    phase: text("phase").notNull().default("admission"),
    progress: integer("progress").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    fencing: integer("fencing").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseUntil: text("lease_until"),
    failureCode: text("failure_code"),
    retryable: integer("retryable").notNull().default(0),
    createdAt: created(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("v2_job_queue_idx").on(t.status, t.leaseUntil),
    uniqueIndex("v2_active_workspace_job_unique")
      .on(t.workspaceId)
      .where(
        sql`${t.targetKind} = 'workspace' AND ${t.status} IN ('queued','running','validating')`,
      ),
    check(
      "v2_job_target",
      sql`(${t.targetKind} = 'workspace' AND ${t.workspaceId} = ${t.targetId} AND ${t.profileId} IS NULL AND ${t.kind} IN ('intake_questions','intake_summary','chat_response')) OR (${t.targetKind} = 'file' AND ${t.workspaceId} IS NOT NULL AND ${t.profileId} IS NULL AND ${t.kind} = 'file_processing') OR (${t.targetKind} = 'report' AND ${t.workspaceId} IS NOT NULL AND ${t.profileId} IS NULL AND ${t.kind} = 'report_build') OR (${t.targetKind} = 'profile_asset' AND ${t.profileId} IS NOT NULL AND ${t.workspaceId} IS NULL AND ${t.kind} = 'portfolio_sanitize')`,
    ),
    check(
      "v2_job_state",
      sql`${t.status} IN ('queued','running','validating','completed','failed','cancelled','superseded') AND ${t.phase} IN ('admission','extracting','transcribing','observing','retrieving','generating','validating','assembling','finished') AND ${t.targetRevision} >= 1 AND ${t.progress} BETWEEN 0 AND 100 AND ${t.attempts} BETWEEN 0 AND 10 AND ${t.fencing} >= 0 AND ${t.retryable} IN (0,1)`,
    ),
    check(
      "v2_job_terminal",
      sql`(${t.status} != 'completed' OR (${t.progress} = 100 AND ${t.phase} = 'finished')) AND ((${t.status} = 'failed' AND ${t.failureCode} IS NOT NULL) OR (${t.status} != 'failed' AND ${t.failureCode} IS NULL)) AND (${t.retryable} = 0 OR ${t.status} = 'failed') AND ((${t.leaseToken} IS NULL AND ${t.leaseUntil} IS NULL) OR (${t.leaseToken} IS NOT NULL AND ${t.leaseUntil} IS NOT NULL))`,
    ),
  ],
);
export const v2JobCheckpoints = sqliteTable(
  "v2_job_checkpoints",
  {
    id: id(),
    jobId: text("job_id")
      .notNull()
      .references(() => v2Jobs.id, { onDelete: "cascade" }),
    revision: revision(),
    fencing: integer("fencing").notNull(),
    phase: text("phase").notNull(),
    encryptedPayload: payload(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("v2_job_checkpoint_revision_unique").on(t.jobId, t.revision)],
);
export const v2Outbox = sqliteTable(
  "v2_outbox",
  {
    id: id(),
    operationId: text("operation_id")
      .notNull()
      .references(() => v2Operations.id, { onDelete: "cascade" }),
    jobId: text("job_id").references(() => v2Jobs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    targetId: text("target_id").notNull(),
    revision: revision(),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: text("next_attempt_at").notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("v2_outbox_dispatch_unique").on(t.kind, t.targetId, t.revision),
    check(
      "v2_outbox_enum",
      sql`${t.kind} IN ('job_dispatch','profile_publish','profile_withdraw','blob_cleanup') AND ${t.state} IN ('pending','dispatched','failed') AND ${t.attempts} >= 0 AND ${t.revision} >= 1`,
    ),
  ],
);

// Opaque journals have no FK to removed data and no encrypted case/document shadow copies.
export const v2Tombstones = sqliteTable(
  "v2_tombstones",
  {
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    deletedAt: text("deleted_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.targetKind, t.targetId] }),
    check(
      "v2_tombstone_kind",
      sql`${t.targetKind} IN ('workspace','account','profile','file','asset','report')`,
    ),
  ],
);
export const v2DeletionJournals = sqliteTable(
  "v2_deletion_journals",
  {
    id: id(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    state: text("state").notNull().default("pending"),
    revision: revision(),
    fencing: integer("fencing").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseUntil: text("lease_until"),
    cursor: integer("cursor").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    createdAt: created(),
    completedAt: text("completed_at"),
    nextAttemptAt: text("next_attempt_at").notNull(),
  },
  (t) => [
    uniqueIndex("v2_deletion_target_unique").on(t.targetKind, t.targetId),
    check(
      "v2_deletion_state",
      sql`${t.state} IN ('pending','running','failed','completed') AND ${t.cursor} >= 0 AND ${t.attempts} >= 0 AND ${t.fencing} >= 0 AND (${t.state} != 'completed' OR ${t.completedAt} IS NOT NULL)`,
    ),
  ],
);
export const v2DeletionTargets = sqliteTable(
  "v2_deletion_targets",
  {
    journalId: text("journal_id")
      .notNull()
      .references(() => v2DeletionJournals.id),
    ordinal: integer("ordinal").notNull(),
    kind: text("kind").notNull(),
    targetId: text("target_id").notNull(),
    state: text("state").notNull().default("pending"),
  },
  (t) => [
    primaryKey({ columns: [t.journalId, t.ordinal] }),
    uniqueIndex("v2_delete_target_unique").on(t.journalId, t.kind, t.targetId),
    check(
      "v2_delete_target_enum",
      sql`${t.kind} IN ('blob','job','legacy_workflow','reservation') AND ${t.state} IN ('pending','completed') AND ${t.ordinal} >= 0`,
    ),
  ],
);
export const v2CleanupReceipts = sqliteTable(
  "v2_cleanup_receipts",
  {
    id: id(),
    journalId: text("journal_id")
      .notNull()
      .references(() => v2DeletionJournals.id),
    kind: text("kind").notNull(),
    targetId: text("target_id").notNull(),
    confirmedAt: text("confirmed_at").notNull(),
  },
  (t) => [uniqueIndex("v2_cleanup_receipt_target_unique").on(t.journalId, t.kind, t.targetId)],
);
export const v2OfficialSources = sqliteTable(
  "v2_official_sources",
  {
    sourceId: text("source_id").primaryKey(),
    sourceType: text("source_type").notNull(),
    officialId: text("official_id").notNull(),
    version: text("version").notNull(),
    section: text("section").notNull(),
    contentHash: text("content_hash").notNull(),
    extractorVersion: text("extractor_version").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    sourceDate: text("source_date"),
    fetchedAt: text("fetched_at").notNull(),
    verifiedAt: text("verified_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    rightsProvenance: text("rights_provenance").notNull(),
    institutionId: text("institution_id"),
    endpointId: text("endpoint_id"),
    court: text("court"),
    caseNumber: text("case_number"),
  },
  (t) => [
    uniqueIndex("v2_official_version_unique").on(
      t.sourceType,
      t.officialId,
      t.version,
      t.section,
      t.contentHash,
      t.extractorVersion,
    ),
    index("v2_official_expiry_idx").on(t.expiresAt),
    index("v2_official_discovery_idx").on(
      t.sourceType,
      t.officialId,
      t.version,
      t.section,
      t.extractorVersion,
      t.fetchedAt,
      t.verifiedAt,
    ),
    check(
      "v2_official_source_type",
      sql`${t.sourceType} IN ('statute','precedent','official_guide') AND length(${t.contentHash}) = 64 AND ${t.contentHash} NOT GLOB '*[^0-9a-f]*' AND ${t.expiresAt} > ${t.verifiedAt} AND (${t.sourceType} != 'official_guide' OR (${t.institutionId} IS NOT NULL AND ${t.endpointId} IS NOT NULL)) AND (${t.sourceType} != 'precedent' OR (${t.court} IS NOT NULL AND ${t.caseNumber} IS NOT NULL AND ${t.sourceDate} IS NOT NULL)) AND (${t.sourceType} != 'statute' OR ${t.sourceDate} IS NOT NULL)`,
    ),
  ],
);
export const v2CitationBindings = sqliteTable(
  "v2_citation_bindings",
  {
    id: id(),
    workspaceId: workspace(),
    sourceId: text("source_id")
      .notNull()
      .references(() => v2OfficialSources.sourceId),
    snapshotRevision: integer("snapshot_revision").notNull(),
    citationJson: text("citation_json").notNull(),
  },
  (t) => [
    check("v2_citation_json", sql`json_valid(${t.citationJson}) AND ${t.snapshotRevision} >= 1`),
  ],
);

export const v2SummaryEditStages = sqliteTable(
  "v2_summary_edit_stages",
  {
    id: id(),
    ownerId: owner(),
    workspaceId: workspace(),
    sourceSummaryId: text("source_summary_id")
      .notNull()
      .references(() => v2Summaries.id, { onDelete: "cascade" }),
    sourceSnapshotId: text("source_snapshot_id")
      .notNull()
      .references(() => v2PrivateSnapshots.id),
    targetSnapshotId: text("target_snapshot_id")
      .notNull()
      .unique()
      .references(() => v2PrivateSnapshots.id, { onDelete: "cascade" }),
    sourceRevision: integer("source_revision").notNull(),
    targetRevision: integer("target_revision").notNull(),
    workspaceRevision: integer("workspace_revision").notNull(),
    intakeRevision: integer("intake_revision").notNull(),
    encryptedPayload: payload(),
    createdAt: created(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [
    check(
      "v2_summary_edit_bounds",
      sql`${t.sourceRevision}>=1 AND ${t.targetRevision}=${t.sourceRevision}+1 AND ${t.workspaceRevision}>=1 AND ${t.intakeRevision}>=1 AND ${t.expiresAt}>${t.createdAt}`,
    ),
  ],
);
export const v2SummaryEditCursors = sqliteTable(
  "v2_summary_edit_cursors",
  {
    id: text("id")
      .primaryKey()
      .references(() => v2SummaryEditStages.id, { onDelete: "cascade" }),
    revision: revision(),
    encryptedPayload: payload(),
  },
  (t) => [check("v2_summary_cursor_revision", sql`${t.revision} BETWEEN 1 AND 9007199254740991`)],
);
export const v2SummaryEditReceipts = sqliteTable(
  "v2_summary_edit_receipts",
  {
    stageId: text("stage_id")
      .notNull()
      .references(() => v2SummaryEditStages.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    ordinal: integer("ordinal").notNull(),
    sourceId: text("source_id").notNull(),
    sourcePayload: text("source_payload").notNull(),
    targetId: text("target_id").notNull(),
    targetPayload: text("target_payload").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.stageId, t.kind, t.ordinal] }),
    uniqueIndex("v2_summary_receipt_source_unique").on(t.stageId, t.kind, t.sourceId),
    check(
      "v2_summary_receipt_bounds",
      sql`${t.kind} IN ('source_part','target_part','fact','party') AND ${t.ordinal} BETWEEN 0 AND 99999`,
    ),
  ],
);

// Server-verified public financial provenance and opaque execution identities.
// These records deliberately have no cascading user/job/operation foreign key.
export const v2RuntimeProofs = sqliteTable(
  "v2_runtime_proofs",
  {
    id: id(),
    kind: text("kind").notNull(),
    environment: text("environment").notNull(),
    digest: text("digest").notNull(),
    payloadJson: text("payload_json").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    verificationMethod: text("verification_method").notNull(),
    verifiedAt: text("verified_at").notNull(),
    validUntil: text("valid_until").notNull(),
  },
  (t) => [
    check(
      "v2_runtime_proof_bounds",
      sql`${t.kind} IN ('pricing','funding','allocation','drain') AND ${t.environment} IN ('preview','production') AND length(${t.digest})=64 AND length(${t.evidenceHash})=64 AND ${t.verificationMethod} IN ('official_document','authenticated_console','authenticated_coordinator','provider_receipt') AND ${t.validUntil}>${t.verifiedAt} AND length(CAST(${t.payloadJson} AS BLOB))<=65536`,
    ),
  ],
);
export const v2RuntimePlans = sqliteTable(
  "v2_runtime_plans",
  {
    id: id(),
    operationId: text("operation_id").notNull(),
    operationRevision: integer("operation_revision").notNull(),
    requestHash: text("request_hash").notNull(),
    invocationId: text("invocation_id").notNull(),
    pricingProofId: text("pricing_proof_id")
      .notNull()
      .references(() => v2RuntimeProofs.id),
    fundingProofId: text("funding_proof_id")
      .notNull()
      .references(() => v2RuntimeProofs.id),
    jobId: text("job_id").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    targetRevision: integer("target_revision").notNull(),
    digest: text("digest").notNull(),
    payloadJson: text("payload_json").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    verifiedAt: text("verified_at").notNull(),
    maximumAttempts: integer("maximum_attempts").notNull(),
    reservedKrw: integer("reserved_krw").notNull(),
    deadlineAt: text("deadline_at").notNull(),
    createdAt: created(),
  },
  (t) => [
    check(
      "v2_runtime_plan_bounds",
      sql`typeof(${t.operationRevision})='integer' AND ${t.operationRevision} BETWEEN 1 AND 9007199254740991 AND typeof(${t.targetRevision})='integer' AND ${t.targetRevision} BETWEEN 1 AND 9007199254740991 AND typeof(${t.maximumAttempts})='integer' AND ${t.maximumAttempts} BETWEEN 1 AND 10 AND typeof(${t.reservedKrw})='integer' AND ${t.reservedKrw} BETWEEN 0 AND 1000000 AND length(${t.requestHash})=64 AND length(${t.digest})=64 AND ${t.deadlineAt}>${t.createdAt} AND ${t.targetKind} IN ('workspace','file','report','profile_asset') AND length(CAST(${t.payloadJson} AS BLOB))<=65536`,
    ),
  ],
);
export const v2PaidHolds = sqliteTable(
  "v2_paid_holds",
  {
    attemptId: text("attempt_id")
      .primaryKey()
      .references(() => v2CostAttempts.id),
    planId: text("plan_id")
      .notNull()
      .references(() => v2RuntimePlans.id),
    jobId: text("job_id").notNull(),
    state: text("state").notNull().default("prepared"),
    leaseToken: text("lease_token"),
    fencing: integer("fencing"),
    dispatchToken: text("dispatch_token"),
    dispatchedAt: text("dispatched_at"),
  },
  (t) => [
    check(
      "v2_paid_hold_state",
      sql`${t.state} IN ('prepared','dispatched','unknown','final') AND (${t.fencing} IS NULL OR (typeof(${t.fencing})='integer' AND ${t.fencing} BETWEEN 1 AND 9007199254740991)) AND (${t.state} IN ('prepared','final') OR (${t.dispatchToken} IS NOT NULL AND ${t.leaseToken} IS NOT NULL AND ${t.fencing} IS NOT NULL AND ${t.dispatchedAt} IS NOT NULL))`,
    ),
  ],
);
export const v2RuntimeUsage = sqliteTable(
  "v2_runtime_usage",
  {
    id: id(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => v2CostAttempts.id),
    digest: text("digest").notNull(),
    payloadJson: text("payload_json").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    observedAt: text("observed_at").notNull(),
    outcome: text("outcome").notNull(),
    chargedKrw: integer("charged_krw"),
  },
  (t) => [
    index("v2_runtime_usage_attempt_idx").on(t.attemptId),
    check(
      "v2_runtime_usage_bounds",
      sql`length(${t.digest})=64 AND length(${t.evidenceHash})=64 AND length(CAST(${t.payloadJson} AS BLOB))<=65536 AND ${t.outcome} IN ('settled','ambiguous','released') AND ((${t.outcome}='settled' AND typeof(${t.chargedKrw})='integer' AND ${t.chargedKrw} BETWEEN 0 AND 9007199254740991) OR (${t.outcome}!='settled' AND ${t.chargedKrw} IS NULL))`,
    ),
  ],
);
export const v2RuntimeControls = sqliteTable(
  "v2_runtime_controls",
  {
    month: text("month")
      .primaryKey()
      .references(() => v2MonthlyBudget.month),
    environment: text("environment").notNull(),
    revision: revision(),
    phase: text("phase").notNull().default("frozen"),
    allocationProofId: text("allocation_proof_id").references(() => v2RuntimeProofs.id),
    pendingVersion: integer("pending_version"),
    localDrainId: text("local_drain_id"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check(
      "v2_runtime_control_bounds",
      sql`${t.environment} IN ('preview','production') AND ${t.phase} IN ('active','frozen','drained') AND typeof(${t.revision})='integer' AND ${t.revision} BETWEEN 1 AND 9007199254740991 AND (${t.pendingVersion} IS NULL OR (typeof(${t.pendingVersion})='integer' AND ${t.pendingVersion} BETWEEN 1 AND 9007199254740991))`,
    ),
  ],
);
export const v2RuntimeDrains = sqliteTable(
  "v2_runtime_drains",
  {
    id: id(),
    month: text("month").notNull(),
    environment: text("environment").notNull(),
    version: integer("version").notNull(),
    controlRevision: integer("control_revision").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    settledKrw: integer("settled_krw").notNull(),
    fixedKrw: integer("fixed_krw").notNull(),
    carryoverKrw: integer("carryover_krw").notNull(),
    digest: text("digest").notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("v2_runtime_drain_version_unique").on(
      t.month,
      t.environment,
      t.version,
      t.controlRevision,
    ),
    check(
      "v2_runtime_drain_bounds",
      sql`${t.environment} IN ('preview','production') AND typeof(${t.version})='integer' AND ${t.version} BETWEEN 1 AND 9007199254740991 AND typeof(${t.controlRevision})='integer' AND ${t.controlRevision} BETWEEN 1 AND 9007199254740991 AND typeof(${t.settledKrw})='integer' AND ${t.settledKrw} BETWEEN 0 AND 9007199254740991 AND typeof(${t.fixedKrw})='integer' AND ${t.fixedKrw} BETWEEN 0 AND 9007199254740991 AND typeof(${t.carryoverKrw})='integer' AND ${t.carryoverKrw} BETWEEN 0 AND 9007199254740991 AND length(${t.digest})=64 AND length(${t.manifestHash})=64`,
    ),
  ],
);
export const v2MaintenanceExposure = sqliteTable(
  "v2_maintenance_exposure",
  {
    id: id(),
    month: text("month")
      .notNull()
      .references(() => v2MonthlyBudget.month),
    referenceHash: text("reference_hash").notNull(),
    amountKrw: integer("amount_krw").notNull(),
    state: text("state").notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("v2_maintenance_reference_unique").on(t.month, t.referenceHash),
    check(
      "v2_maintenance_bounds",
      sql`typeof(${t.amountKrw})='integer' AND ${t.amountKrw} BETWEEN 0 AND 9007199254740991 AND ${t.state} IN ('reserved','ambiguous','settled') AND length(${t.referenceHash})=64`,
    ),
  ],
);

// Financial CAS witnesses must survive deletion and must not reference a user.
export const v2RuntimeClaims = sqliteTable(
  "v2_runtime_claims",
  {
    id: id(),
    ownerId: text("owner_id").notNull(),
    targetId: text("target_id").notNull(),
    revision: integer("revision").notNull(),
    verified: integer("verified").notNull().default(1),
  },
  (t) => [
    check(
      "v2_runtime_claim_bounds",
      sql`typeof(${t.revision})='integer' AND ${t.revision} BETWEEN 0 AND 9007199254740991 AND ${t.verified}=1`,
    ),
  ],
);

export const v2MaintenanceEvidence = sqliteTable(
  "v2_maintenance_evidence",
  {
    id: id(),
    maintenanceId: text("maintenance_id")
      .notNull()
      .references(() => v2MaintenanceExposure.id),
    action: text("action").notNull(),
    digest: text("digest").notNull(),
    payloadJson: text("payload_json").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    verifiedAt: text("verified_at").notNull(),
  },
  (t) => [
    check(
      "v2_maintenance_evidence_bounds",
      sql`${t.action} IN ('record','settle') AND length(${t.digest})=64 AND length(${t.evidenceHash})=64 AND length(CAST(${t.payloadJson} AS BLOB))<=65536`,
    ),
  ],
);

// Billing evidence outlives source deletion. Opaque source IDs deliberately have
// no cascading FK; authorization always joins the current live storage target.
export const v2StoragePaidExecutions = sqliteTable(
  "v2_storage_paid_executions",
  {
    attemptId: text("attempt_id")
      .primaryKey()
      .references(() => v2CostAttempts.id),
    planId: text("plan_id").notNull(),
    operationId: text("operation_id").notNull(),
    operationRevision: integer("operation_revision").notNull(),
    reservationId: text("reservation_id").notNull(),
    blobId: text("blob_id").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    targetRevision: integer("target_revision").notNull(),
    scope: text("scope").notNull(),
    pricingProofId: text("pricing_proof_id")
      .notNull()
      .references(() => v2RuntimeProofs.id),
    fundingProofId: text("funding_proof_id")
      .notNull()
      .references(() => v2RuntimeProofs.id),
    digest: text("digest").notNull(),
    payloadJson: text("payload_json").notNull(),
    anchorJson: text("anchor_json").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    verifiedAt: text("verified_at").notNull(),
    deadlineAt: text("deadline_at").notNull(),
    createdAt: created(),
    state: text("state").notNull().default("prepared"),
    dispatchToken: text("dispatch_token"),
    dispatchedAt: text("dispatched_at"),
  },
  (t) => [
    uniqueIndex("v2_storage_paid_plan_unique").on(t.planId),
    index("v2_storage_paid_intent_idx").on(t.blobId, t.state),
    check(
      "v2_storage_paid_bounds",
      sql`${t.targetKind} IN ('file','profile_asset') AND ${t.scope} IN ('case_original','lawyer_original','approved_public_copy') AND typeof(${t.operationRevision})='integer' AND ${t.operationRevision} BETWEEN 1 AND 9007199254740991 AND typeof(${t.targetRevision})='integer' AND ${t.targetRevision} BETWEEN 1 AND 9007199254740991 AND length(${t.digest})=64 AND length(${t.evidenceHash})=64 AND length(CAST(${t.payloadJson} AS BLOB))<=65536 AND length(CAST(${t.anchorJson} AS BLOB))<=1048576 AND ${t.deadlineAt}>${t.createdAt}`,
    ),
    check(
      "v2_storage_paid_state",
      sql`${t.state} IN ('prepared','dispatched','unknown','final') AND ((${t.state}='prepared' AND ${t.dispatchToken} IS NULL AND ${t.dispatchedAt} IS NULL) OR ${t.state}='final' OR (${t.state} IN ('dispatched','unknown') AND ${t.dispatchToken} IS NOT NULL AND ${t.dispatchedAt} IS NOT NULL))`,
    ),
  ],
);
