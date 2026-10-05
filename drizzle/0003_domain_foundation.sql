CREATE TABLE `analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`workflow_instance_id` text NOT NULL,
	`input_revision` integer NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`encrypted_context` text,
	`clarification_expires_at` text,
	`status` text NOT NULL,
	`encrypted_answers` text,
	`encrypted_result` text,
	`model_id` text,
	`prompt_version` text,
	`schema_version` text,
	`policy_version` text,
	`failure_code` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "analyses_status_check" CHECK("analyses"."status" IN ('queued','screening','waiting_for_answers','retrieving','generating','validating','completed','failed','superseded')),
	CONSTRAINT "analyses_revision_check" CHECK(typeof("analyses"."input_revision") = 'integer' AND "analyses"."input_revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "analyses_attempt_check" CHECK(typeof("analyses"."attempt") = 'integer' AND "analyses"."attempt" BETWEEN 1 AND 3),
	CONSTRAINT "analyses_failure_code_check" CHECK("analyses"."failure_code" IS NULL OR "analyses"."failure_code" IN ('CLARIFICATION_EXPIRED','DISPATCH_FAILED','MODEL_UNAVAILABLE','MODEL_SCHEMA_INVALID','LEGAL_SOURCE_UNAVAILABLE','CITATION_INVALID','POLICY_REJECTED','ANALYSIS_TIMEOUT','CRYPTO_DECRYPT_FAILED','INTERNAL_ERROR')),
	CONSTRAINT "analyses_completed_result_check" CHECK("analyses"."status" != 'completed' OR "analyses"."encrypted_result" IS NOT NULL),
	CONSTRAINT "analyses_failed_code_check" CHECK("analyses"."status" != 'failed' OR "analyses"."failure_code" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `analyses_case_created_idx` ON `analyses` (`case_id`,"created_at" desc,"id" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `analyses_workflow_unique` ON `analyses` (`workflow_instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analyses_active_case_unique` ON `analyses` (`case_id`) WHERE "analyses"."status" IN ('queued','screening','waiting_for_answers','retrieving','generating','validating');--> statement-breakpoint
CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text DEFAULT 'personal_loan' NOT NULL,
	`jurisdiction` text DEFAULT 'KR' NOT NULL,
	`title` text DEFAULT '금전 대여 사건' NOT NULL,
	`status` text NOT NULL,
	`encrypted_input` text NOT NULL,
	`input_revision` integer DEFAULT 1 NOT NULL,
	`current_analysis_id` text,
	`questions_asked` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cases_category_check" CHECK("cases"."category" = 'personal_loan'),
	CONSTRAINT "cases_jurisdiction_check" CHECK("cases"."jurisdiction" = 'KR'),
	CONSTRAINT "cases_title_check" CHECK(length("cases"."title") BETWEEN 1 AND 80),
	CONSTRAINT "cases_status_check" CHECK("cases"."status" IN ('screening','needs_clarification','queued','analyzing','completed','out_of_scope','urgent_redirect','failed')),
	CONSTRAINT "cases_revision_check" CHECK(typeof("cases"."input_revision") = 'integer' AND "cases"."input_revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "cases_questions_check" CHECK(typeof("cases"."questions_asked") = 'integer' AND "cases"."questions_asked" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE INDEX `cases_owner_created_idx` ON `cases` (`user_id`,"created_at" desc,"id" desc);--> statement-breakpoint
CREATE TABLE `citations` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_id` text NOT NULL,
	`source_type` text DEFAULT 'statute' NOT NULL,
	`source_id` text NOT NULL,
	`law_name` text NOT NULL,
	`article` text NOT NULL,
	`effective_date` text NOT NULL,
	`verified_at` text NOT NULL,
	`source_url` text NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "citations_source_type_check" CHECK("citations"."source_type" = 'statute'),
	CONSTRAINT "citations_hash_check" CHECK(length("citations"."content_hash") = 64 AND "citations"."content_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE INDEX `citations_analysis_idx` ON `citations` (`analysis_id`);--> statement-breakpoint
CREATE TABLE `daily_usage` (
	`user_id` text NOT NULL,
	`usage_date_kst` text NOT NULL,
	`analysis_count` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `usage_date_kst`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "daily_usage_count_check" CHECK(typeof("daily_usage"."analysis_count") = 'integer' AND "daily_usage"."analysis_count" BETWEEN 0 AND 10)
);
--> statement-breakpoint
CREATE TABLE `deletion_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`deleted_at` text NOT NULL,
	`workflow_instance_ids` text NOT NULL,
	`primary_state` text NOT NULL,
	`cleanup_state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "deletion_target_check" CHECK("deletion_jobs"."target_type" IN ('case','account')),
	CONSTRAINT "deletion_primary_check" CHECK("deletion_jobs"."primary_state" IN ('pending','deleted')),
	CONSTRAINT "deletion_cleanup_check" CHECK("deletion_jobs"."cleanup_state" IN ('pending','completed','failed')),
	CONSTRAINT "deletion_attempt_check" CHECK(typeof("deletion_jobs"."attempts") = 'integer' AND "deletion_jobs"."attempts" >= 0),
	CONSTRAINT "deletion_workflows_check" CHECK(json_valid("deletion_jobs"."workflow_instance_ids") AND json_type("deletion_jobs"."workflow_instance_ids") = 'array')
);
--> statement-breakpoint
CREATE INDEX `deletion_cleanup_idx` ON `deletion_jobs` (`cleanup_state`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `deletion_expiry_idx` ON `deletion_jobs` (`expires_at`);--> statement-breakpoint
CREATE TABLE `dispatch_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`instance_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "dispatch_state_check" CHECK("dispatch_outbox"."state" IN ('pending','dispatched','failed')),
	CONSTRAINT "dispatch_attempt_check" CHECK(typeof("dispatch_outbox"."attempt") = 'integer' AND "dispatch_outbox"."attempt" BETWEEN 1 AND 3 AND typeof("dispatch_outbox"."attempts") = 'integer' AND "dispatch_outbox"."attempts" >= 0),
	CONSTRAINT "dispatch_revision_check" CHECK(typeof("dispatch_outbox"."revision") = 'integer' AND "dispatch_outbox"."revision" BETWEEN 1 AND 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dispatch_analysis_attempt_unique` ON `dispatch_outbox` (`analysis_id`,`attempt`);--> statement-breakpoint
CREATE INDEX `dispatch_pending_idx` ON `dispatch_outbox` (`state`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `idempotency_records` (
	`user_id` text NOT NULL,
	`method` text NOT NULL,
	`route` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_status` integer NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `method`, `route`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "idempotency_response_check" CHECK(typeof("idempotency_records"."response_status") = 'integer' AND "idempotency_records"."response_status" BETWEEN 200 AND 299 AND json_valid("idempotency_records"."response_json")),
	CONSTRAINT "idempotency_hash_check" CHECK(length("idempotency_records"."request_hash") = 64 AND "idempotency_records"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE INDEX `idempotency_expiry_idx` ON `idempotency_records` (`expires_at`);--> statement-breakpoint
CREATE TABLE `legal_source_cache` (
	`source_id` text NOT NULL,
	`effective_date` text NOT NULL,
	`article` text NOT NULL,
	`content_hash` text NOT NULL,
	`law_name` text NOT NULL,
	`source_url` text NOT NULL,
	`body` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`source_id`, `effective_date`, `article`, `content_hash`),
	CONSTRAINT "legal_cache_hash_check" CHECK(length("legal_source_cache"."content_hash") = 64 AND "legal_source_cache"."content_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE INDEX `legal_cache_expiry_idx` ON `legal_source_cache` (`expires_at`);--> statement-breakpoint
UPDATE `app_metadata` SET `value` = '0003_domain_foundation', `updated_at` = CURRENT_TIMESTAMP WHERE `key` = 'schema_version';
