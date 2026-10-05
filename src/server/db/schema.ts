import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  type AnalysisStatus,
  analysisStatusSchema,
  type CaseStatus,
  caseStatusSchema,
  type FailureCode,
  failureCodeSchema,
} from "../../contracts";

export * from "./v2-schema";

export const appMetadata = sqliteTable("app_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    oauthAuthenticatedAt: integer("oauth_authenticated_at", { mode: "timestamp_ms" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    uniqueIndex("account_provider_account_unique").on(table.providerId, table.accountId),
  ],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userConsents = sqliteTable(
  "user_consents",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    termsVersion: text("terms_version").notNull(),
    privacyVersion: text("privacy_version").notNull(),
    aiNoticeVersion: text("ai_notice_version").notNull(),
    over14Confirmed: integer("over_14_confirmed", { mode: "boolean" }).notNull(),
    consentedAt: text("consented_at").notNull(),
  },
  (table) => [check("user_consents_over_14_check", sql`${table.over14Confirmed} = 1`)],
);

export const authSchema = { user, session, account, verification };

// Shared enums are code-owned; no user input is interpolated into these constraints.
const enumSql = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(","));
export const ACTIVE_ANALYSIS_STATUSES = [
  "queued",
  "screening",
  "waiting_for_answers",
  "retrieving",
  "generating",
  "validating",
] as const;

export const cases = sqliteTable(
  "cases",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    category: text("category").notNull().default("personal_loan"),
    jurisdiction: text("jurisdiction").notNull().default("KR"),
    title: text("title").notNull().default("금전 대여 사건"),
    status: text("status").$type<CaseStatus>().notNull(),
    encryptedInput: text("encrypted_input").notNull(),
    inputRevision: integer("input_revision").notNull().default(1),
    // Cross-table ownership/revision is enforced by the guarded repository, avoiding a circular FK.
    currentAnalysisId: text("current_analysis_id"),
    questionsAsked: integer("questions_asked").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("cases_owner_created_idx").on(table.userId, desc(table.createdAt), desc(table.id)),
    check("cases_category_check", sql`${table.category} = 'personal_loan'`),
    check("cases_jurisdiction_check", sql`${table.jurisdiction} = 'KR'`),
    check("cases_title_check", sql`length(${table.title}) BETWEEN 1 AND 80`),
    check("cases_status_check", sql`${table.status} IN (${enumSql(caseStatusSchema.options)})`),
    check(
      "cases_revision_check",
      sql`typeof(${table.inputRevision}) = 'integer' AND ${table.inputRevision} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "cases_questions_check",
      sql`typeof(${table.questionsAsked}) = 'integer' AND ${table.questionsAsked} BETWEEN 0 AND 5`,
    ),
  ],
);

export const analyses = sqliteTable(
  "analyses",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    workflowInstanceId: text("workflow_instance_id").notNull(),
    inputRevision: integer("input_revision").notNull(),
    attempt: integer("attempt").notNull().default(1),
    encryptedContext: text("encrypted_context"),
    clarificationExpiresAt: text("clarification_expires_at"),
    status: text("status").$type<AnalysisStatus>().notNull(),
    encryptedAnswers: text("encrypted_answers"),
    encryptedResult: text("encrypted_result"),
    modelId: text("model_id"),
    promptVersion: text("prompt_version"),
    schemaVersion: text("schema_version"),
    policyVersion: text("policy_version"),
    failureCode: text("failure_code").$type<FailureCode>(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("analyses_case_created_idx").on(table.caseId, desc(table.createdAt), desc(table.id)),
    uniqueIndex("analyses_workflow_unique").on(table.workflowInstanceId),
    uniqueIndex("analyses_active_case_unique")
      .on(table.caseId)
      .where(sql`${table.status} IN (${enumSql(ACTIVE_ANALYSIS_STATUSES)})`),
    check(
      "analyses_status_check",
      sql`${table.status} IN (${enumSql(analysisStatusSchema.options)})`,
    ),
    check(
      "analyses_revision_check",
      sql`typeof(${table.inputRevision}) = 'integer' AND ${table.inputRevision} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "analyses_attempt_check",
      sql`typeof(${table.attempt}) = 'integer' AND ${table.attempt} BETWEEN 1 AND 3`,
    ),
    check(
      "analyses_failure_code_check",
      sql`${table.failureCode} IS NULL OR ${table.failureCode} IN (${enumSql(failureCodeSchema.options)})`,
    ),
    check(
      "analyses_completed_result_check",
      sql`${table.status} != 'completed' OR ${table.encryptedResult} IS NOT NULL`,
    ),
    check(
      "analyses_failed_code_check",
      sql`${table.status} != 'failed' OR ${table.failureCode} IS NOT NULL`,
    ),
  ],
);

export const citations = sqliteTable(
  "citations",
  {
    id: text("id").primaryKey(),
    analysisId: text("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull().default("statute"),
    sourceId: text("source_id").notNull(),
    lawName: text("law_name").notNull(),
    article: text("article").notNull(),
    effectiveDate: text("effective_date").notNull(),
    verifiedAt: text("verified_at").notNull(),
    sourceUrl: text("source_url").notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    index("citations_analysis_idx").on(table.analysisId),
    check("citations_source_type_check", sql`${table.sourceType} = 'statute'`),
    check(
      "citations_hash_check",
      sql`length(${table.contentHash}) = 64 AND ${table.contentHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);

export const dailyUsage = sqliteTable(
  "daily_usage",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    usageDateKst: text("usage_date_kst").notNull(),
    analysisCount: integer("analysis_count").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.usageDateKst] }),
    check(
      "daily_usage_count_check",
      sql`typeof(${table.analysisCount}) = 'integer' AND ${table.analysisCount} BETWEEN 0 AND 10`,
    ),
  ],
);

export const idempotencyRecords = sqliteTable(
  "idempotency_records",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    route: text("route").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.method, table.route, table.key] }),
    index("idempotency_expiry_idx").on(table.expiresAt),
    check(
      "idempotency_response_check",
      sql`typeof(${table.responseStatus}) = 'integer' AND ${table.responseStatus} BETWEEN 200 AND 299 AND json_valid(${table.responseJson})`,
    ),
    check(
      "idempotency_hash_check",
      sql`length(${table.requestHash}) = 64 AND ${table.requestHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);

export const dispatchOutbox = sqliteTable(
  "dispatch_outbox",
  {
    id: text("id").primaryKey(),
    analysisId: text("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    instanceId: text("instance_id").notNull(),
    revision: integer("revision").notNull(),
    state: text("state", { enum: ["pending", "dispatched", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: text("next_attempt_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("dispatch_analysis_attempt_unique").on(table.analysisId, table.attempt),
    index("dispatch_pending_idx").on(table.state, table.nextAttemptAt),
    check("dispatch_state_check", sql`${table.state} IN ('pending','dispatched','failed')`),
    check(
      "dispatch_attempt_check",
      sql`typeof(${table.attempt}) = 'integer' AND ${table.attempt} BETWEEN 1 AND 3 AND typeof(${table.attempts}) = 'integer' AND ${table.attempts} >= 0`,
    ),
    check(
      "dispatch_revision_check",
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} BETWEEN 1 AND 9007199254740991`,
    ),
  ],
);

// Deliberately no user/case FK: this opaque cleanup journal survives primary deletion.
export const deletionJobs = sqliteTable(
  "deletion_jobs",
  {
    id: text("id").primaryKey(),
    targetType: text("target_type", { enum: ["case", "account"] }).notNull(),
    targetId: text("target_id").notNull(),
    deletedAt: text("deleted_at").notNull(),
    workflowInstanceIds: text("workflow_instance_ids").notNull(),
    primaryState: text("primary_state", { enum: ["pending", "deleted"] }).notNull(),
    cleanupState: text("cleanup_state", { enum: ["pending", "completed", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: text("expires_at").notNull(),
    cleanupCursor: integer("cleanup_cursor").notNull().default(0),
    nextAttemptAt: text("next_attempt_at").notNull().default("1970-01-01T00:00:00.000Z"),
  },
  (table) => [
    index("deletion_cleanup_idx").on(table.cleanupState, table.deletedAt),
    index("deletion_expiry_idx").on(table.expiresAt),
    check("deletion_target_check", sql`${table.targetType} IN ('case','account')`),
    check("deletion_primary_check", sql`${table.primaryState} IN ('pending','deleted')`),
    check("deletion_cleanup_check", sql`${table.cleanupState} IN ('pending','completed','failed')`),
    check(
      "deletion_attempt_check",
      sql`typeof(${table.attempts}) = 'integer' AND ${table.attempts} >= 0`,
    ),
    check(
      "deletion_workflows_check",
      sql`json_valid(${table.workflowInstanceIds}) AND json_type(${table.workflowInstanceIds}) = 'array'`,
    ),
  ],
);

export const legalSourceCache = sqliteTable(
  "legal_source_cache",
  {
    sourceId: text("source_id").notNull(),
    effectiveDate: text("effective_date").notNull(),
    article: text("article").notNull(),
    contentHash: text("content_hash").notNull(),
    lawName: text("law_name").notNull(),
    sourceUrl: text("source_url").notNull(),
    body: text("body").notNull(),
    fetchedAt: text("fetched_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.sourceId, table.effectiveDate, table.article, table.contentHash],
    }),
    index("legal_cache_expiry_idx").on(table.expiresAt),
    check(
      "legal_cache_hash_check",
      sql`length(${table.contentHash}) = 64 AND ${table.contentHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);

// Explicit optional boolean feedback only. No free text or analytics identifiers.
export const caseFeedback = sqliteTable(
  "case_feedback",
  {
    caseId: text("case_id")
      .primaryKey()
      .references(() => cases.id, { onDelete: "cascade" }),
    analysisId: text("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    helpful: integer("helpful", { mode: "boolean" }).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "case_feedback_helpful_check",
      sql`typeof(${table.helpful})='integer' AND ${table.helpful} IN (0,1)`,
    ),
  ],
);
