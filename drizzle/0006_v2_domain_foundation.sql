CREATE TABLE `v2_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`encrypted_payload` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_action_enum" CHECK("v2_actions"."kind" IN ('evidence_preserve','fact_check','organize_materials','official_guide_check','ask_lawyer') AND "v2_actions"."status" IN ('todo','done','skipped') AND "v2_actions"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_action_entity_unique` ON `v2_actions` (`workspace_id`,`entity_id`);--> statement-breakpoint
CREATE TABLE `v2_allocation_acknowledgments` (
	`month` text NOT NULL,
	`version` integer NOT NULL,
	`environment` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`drain_receipt_id` text NOT NULL,
	`acknowledged_at` text NOT NULL,
	PRIMARY KEY(`month`, `version`, `environment`),
	CONSTRAINT "v2_allocation_ack_environment" CHECK("v2_allocation_acknowledgments"."environment" IN ('preview','production') AND "v2_allocation_acknowledgments"."version">=1)
);
--> statement-breakpoint
CREATE TABLE `v2_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`question_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`encrypted_payload` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `v2_question_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_answer_status" CHECK("v2_answers"."status" IN ('answered','unknown','skipped') AND "v2_answers"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_answer_question_unique` ON `v2_answers` (`batch_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `v2_application_assets` (
	`application_id` text NOT NULL,
	`asset_id` text NOT NULL,
	PRIMARY KEY(`application_id`, `asset_id`),
	FOREIGN KEY (`application_id`) REFERENCES `v2_applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `v2_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `v2_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`encrypted_payload` text NOT NULL,
	`submitted_at` text,
	`decided_at` text,
	`withdrawn_at` text,
	`reviewer_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_application_status" CHECK("v2_applications"."status" IN ('draft','submitted','approved','rejected','withdrawn') AND "v2_applications"."revision" >= 1 AND ("v2_applications"."status" NOT IN ('submitted','approved','rejected') OR "v2_applications"."submitted_at" IS NOT NULL) AND ("v2_applications"."status" NOT IN ('approved','rejected') OR "v2_applications"."decided_at" IS NOT NULL) AND ("v2_applications"."reviewer_id" IS NULL OR "v2_applications"."reviewer_id" != "v2_applications"."owner_id"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_application_owner_revision_unique` ON `v2_applications` (`owner_id`,`revision`);--> statement-breakpoint
CREATE TABLE `v2_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`purpose` text NOT NULL,
	`state` text NOT NULL,
	`original_blob_id` text,
	`sanitized_blob_id` text,
	`current_job_id` text,
	`failure_code` text,
	`encrypted_payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `v2_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`original_blob_id`) REFERENCES `v2_blobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sanitized_blob_id`) REFERENCES `v2_blobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_asset_enum" CHECK("v2_assets"."purpose" IN ('profile_photo','portfolio','identity','lawyer_license','office') AND "v2_assets"."state" IN ('reserved','uploaded','sanitizing','ready','failed','rejected','deleting') AND "v2_assets"."revision" >= 1),
	CONSTRAINT "v2_asset_sanitization" CHECK("v2_assets"."state" != 'ready' OR "v2_assets"."purpose" IN ('identity','lawyer_license','office') OR "v2_assets"."sanitized_blob_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `v2_billing_principals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_billing_principals_owner_id_unique` ON `v2_billing_principals` (`owner_id`);--> statement-breakpoint
CREATE TABLE `v2_blobs` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`kind` text NOT NULL,
	`visibility` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`object_key` text NOT NULL,
	`logical_bytes` integer NOT NULL,
	`cipher_bytes` integer DEFAULT 0 NOT NULL,
	`cipher_hash` text,
	`key_version` text,
	`encrypted_payload` text NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text,
	`source_blob_id` text,
	`source_asset_revision` integer,
	`approved_revision_id` text,
	FOREIGN KEY (`principal_id`) REFERENCES `v2_billing_principals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reservation_id`) REFERENCES `v2_storage_reservations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_blob_enum" CHECK("v2_blobs"."kind" IN ('original','derivative','report_pdf','original_zip','verification','portfolio_original','portfolio_sanitized','profile_photo_original','profile_photo_sanitized','public_copy') AND "v2_blobs"."visibility" IN ('private','staging','public') AND "v2_blobs"."state" IN ('pending','stored','deleting','deleted')),
	CONSTRAINT "v2_blob_bytes" CHECK("v2_blobs"."logical_bytes" > 0 AND "v2_blobs"."cipher_bytes" >= 0 AND ("v2_blobs"."state" != 'deleted' OR "v2_blobs"."deleted_at" IS NOT NULL)),
	CONSTRAINT "v2_blob_encryption" CHECK("v2_blobs"."visibility" = 'public' OR "v2_blobs"."state" != 'stored' OR "v2_blobs"."key_version" IS NOT NULL),
	CONSTRAINT "v2_public_copy_provenance" CHECK("v2_blobs"."visibility"!='public' OR ("v2_blobs"."kind"='public_copy' AND "v2_blobs"."source_blob_id" IS NOT NULL AND "v2_blobs"."source_asset_revision">=1 AND "v2_blobs"."approved_revision_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_blobs_object_key_unique` ON `v2_blobs` (`object_key`);--> statement-breakpoint
CREATE TABLE `v2_budget_allocations` (
	`month` text NOT NULL,
	`version` integer NOT NULL,
	`preview_krw` integer NOT NULL,
	`production_krw` integer NOT NULL,
	`shared_fixed_krw` integer NOT NULL,
	`maintenance_reserve_krw` integer NOT NULL,
	`pricing_provenance` text NOT NULL,
	`fx_provenance` text NOT NULL,
	`funding_provenance` text NOT NULL,
	`reviewed_at` text NOT NULL,
	`valid_until` text NOT NULL,
	`funding_state` text NOT NULL,
	`funding_valid_until` text NOT NULL,
	`manifest_hash` text NOT NULL,
	PRIMARY KEY(`month`, `version`),
	CONSTRAINT "v2_allocation_amount" CHECK("v2_budget_allocations"."version">=1 AND "v2_budget_allocations"."preview_krw">=0 AND "v2_budget_allocations"."production_krw">=0 AND "v2_budget_allocations"."shared_fixed_krw">=0 AND "v2_budget_allocations"."maintenance_reserve_krw">=0 AND "v2_budget_allocations"."preview_krw"+"v2_budget_allocations"."production_krw"+"v2_budget_allocations"."shared_fixed_krw"+"v2_budget_allocations"."maintenance_reserve_krw"<=1000000 AND "v2_budget_allocations"."funding_state" IN ('funded','trial_credit','unavailable') AND "v2_budget_allocations"."valid_until">"v2_budget_allocations"."reviewed_at" AND length("v2_budget_allocations"."manifest_hash")=64)
);
--> statement-breakpoint
CREATE TABLE `v2_case_original_usage` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`stored_count` integer DEFAULT 0 NOT NULL,
	`reserved_count` integer DEFAULT 0 NOT NULL,
	`stored_bytes` integer DEFAULT 0 NOT NULL,
	`reserved_bytes` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_case_usage_nonnegative" CHECK("v2_case_original_usage"."stored_count" >= 0 AND "v2_case_original_usage"."reserved_count" >= 0 AND "v2_case_original_usage"."stored_bytes" >= 0 AND "v2_case_original_usage"."reserved_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE `v2_citation_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_id` text NOT NULL,
	`snapshot_revision` integer NOT NULL,
	`citation_json` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `v2_official_sources`(`source_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_citation_json" CHECK(json_valid("v2_citation_bindings"."citation_json") AND "v2_citation_bindings"."snapshot_revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE `v2_cleanup_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`journal_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`confirmed_at` text NOT NULL,
	FOREIGN KEY (`journal_id`) REFERENCES `v2_deletion_journals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_cleanup_receipt_target_unique` ON `v2_cleanup_receipts` (`journal_id`,`kind`,`target_id`);--> statement-breakpoint
CREATE TABLE `v2_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`file_id` text,
	`kind` text NOT NULL,
	`version` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`encrypted_payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `v2_files`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_consent_kind" CHECK("v2_consents"."kind" IN ('auto_processing','original_export','profile_publication'))
);
--> statement-breakpoint
CREATE TABLE `v2_cost_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`invocation_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`month` text NOT NULL,
	`quote_id` text NOT NULL,
	`service` text NOT NULL,
	`state` text DEFAULT 'reserved' NOT NULL,
	`reserved_krw` integer NOT NULL,
	`charged_krw` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`principal_id`) REFERENCES `v2_billing_principals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`month`) REFERENCES `v2_monthly_budget`(`month`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quote_id`) REFERENCES `v2_cost_quotes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_cost_attempt_state" CHECK("v2_cost_attempts"."state" IN ('reserved','settled','ambiguous','released') AND "v2_cost_attempts"."attempt" BETWEEN 1 AND 10 AND "v2_cost_attempts"."reserved_krw" >= 0 AND (("v2_cost_attempts"."state" = 'settled' AND "v2_cost_attempts"."charged_krw" IS NOT NULL AND "v2_cost_attempts"."charged_krw" >= 0) OR ("v2_cost_attempts"."state" != 'settled' AND "v2_cost_attempts"."charged_krw" IS NULL))),
	CONSTRAINT "v2_cost_service" CHECK("v2_cost_attempts"."service" IN ('model','asr','container','storage','requests','fixed_operation'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_invocation_attempt_unique` ON `v2_cost_attempts` (`invocation_id`,`attempt`);--> statement-breakpoint
CREATE TABLE `v2_cost_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`reviewed_at` text NOT NULL,
	`valid_until` text NOT NULL,
	`currency` text DEFAULT 'KRW' NOT NULL,
	`provider_pricing_version` text NOT NULL,
	`exchange_rate` real NOT NULL,
	`safety_margin` real NOT NULL,
	`estimated_krw` integer NOT NULL,
	CONSTRAINT "v2_quote_amount" CHECK("v2_cost_quotes"."currency" = 'KRW' AND "v2_cost_quotes"."version" >= 1 AND "v2_cost_quotes"."exchange_rate" > 0 AND "v2_cost_quotes"."exchange_rate" <= 100000 AND "v2_cost_quotes"."safety_margin" BETWEEN 0 AND 10 AND "v2_cost_quotes"."estimated_krw" >= 0 AND "v2_cost_quotes"."valid_until" > "v2_cost_quotes"."reviewed_at")
);
--> statement-breakpoint
CREATE TABLE `v2_cost_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`previous_state` text NOT NULL,
	`next_state` text NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `v2_cost_attempts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_cost_receipt_transition" CHECK(("v2_cost_receipts"."previous_state"='reserved' AND "v2_cost_receipts"."next_state" IN ('settled','ambiguous','released')) OR ("v2_cost_receipts"."previous_state"='ambiguous' AND "v2_cost_receipts"."next_state"='settled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_cost_receipt_transition_unique` ON `v2_cost_receipts` (`attempt_id`,`previous_state`);--> statement-breakpoint
CREATE TABLE `v2_daily_usage` (
	`owner_id` text NOT NULL,
	`day` text NOT NULL,
	`cases_used` integer DEFAULT 0 NOT NULL,
	`cases_reserved` integer DEFAULT 0 NOT NULL,
	`responses_used` integer DEFAULT 0 NOT NULL,
	`responses_reserved` integer DEFAULT 0 NOT NULL,
	`media_used` real DEFAULT 0 NOT NULL,
	`media_reserved` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `day`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_daily_nonnegative" CHECK("v2_daily_usage"."cases_used" >= 0 AND "v2_daily_usage"."cases_reserved" >= 0 AND "v2_daily_usage"."responses_used" >= 0 AND "v2_daily_usage"."responses_reserved" >= 0 AND "v2_daily_usage"."media_used" >= 0 AND "v2_daily_usage"."media_reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE `v2_deletion_journals` (
	`id` text PRIMARY KEY NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`fencing` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` text,
	`cursor` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`next_attempt_at` text NOT NULL,
	CONSTRAINT "v2_deletion_state" CHECK("v2_deletion_journals"."state" IN ('pending','running','failed','completed') AND "v2_deletion_journals"."cursor" >= 0 AND "v2_deletion_journals"."attempts" >= 0 AND "v2_deletion_journals"."fencing" >= 0 AND ("v2_deletion_journals"."state" != 'completed' OR "v2_deletion_journals"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_deletion_target_unique` ON `v2_deletion_journals` (`target_kind`,`target_id`);--> statement-breakpoint
CREATE TABLE `v2_deletion_targets` (
	`journal_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	PRIMARY KEY(`journal_id`, `ordinal`),
	FOREIGN KEY (`journal_id`) REFERENCES `v2_deletion_journals`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_delete_target_enum" CHECK("v2_deletion_targets"."kind" IN ('blob','job','legacy_workflow','reservation') AND "v2_deletion_targets"."state" IN ('pending','completed') AND "v2_deletion_targets"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_delete_target_unique` ON `v2_deletion_targets` (`journal_id`,`kind`,`target_id`);--> statement-breakpoint
CREATE TABLE `v2_directory_items` (
	`snapshot_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`profile_id` text NOT NULL,
	`revision_id` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `ordinal`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `v2_directory_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `v2_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `v2_profile_revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_directory_profile_unique` ON `v2_directory_items` (`snapshot_id`,`profile_id`);--> statement-breakpoint
CREATE TABLE `v2_directory_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`query_json` text DEFAULT '{}' NOT NULL,
	`rotation_day` text NOT NULL,
	`rotation_algorithm` text DEFAULT 'profile_id_daily_v1' NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "v2_directory_snapshot_bounds" CHECK(json_valid("v2_directory_snapshots"."query_json") AND "v2_directory_snapshots"."item_count" BETWEEN 0 AND 9007199254740991 AND typeof("v2_directory_snapshots"."item_count")='integer' AND "v2_directory_snapshots"."rotation_algorithm"='profile_id_daily_v1' AND length("v2_directory_snapshots"."rotation_day")=10 AND "v2_directory_snapshots"."expires_at">"v2_directory_snapshots"."created_at")
);
--> statement-breakpoint
CREATE TABLE `v2_fact_references` (
	`fact_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`source_id` text NOT NULL,
	`source_revision` integer,
	PRIMARY KEY(`fact_id`, `ordinal`),
	FOREIGN KEY (`fact_id`) REFERENCES `v2_facts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_fact_reference_kind" CHECK("v2_fact_references"."kind" IN ('intake_narrative','intake_answer','user_message','user_material','official_source') AND "v2_fact_references"."ordinal" >= 0 AND ("v2_fact_references"."source_revision" IS NULL OR "v2_fact_references"."source_revision" >= 1))
);
--> statement-breakpoint
CREATE TABLE `v2_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`summary_revision` integer NOT NULL,
	`snapshot_id` text,
	`encrypted_payload` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `v2_private_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_fact_revision" CHECK("v2_facts"."revision" >= 1 AND "v2_facts"."summary_revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_fact_version_unique` ON `v2_facts` (`workspace_id`,`summary_revision`,`entity_id`);--> statement-breakpoint
CREATE INDEX `v2_facts_workspace_idx` ON `v2_facts` (`workspace_id`,`summary_revision`);--> statement-breakpoint
CREATE TABLE `v2_file_derivatives` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`file_id` text NOT NULL,
	`file_revision` integer NOT NULL,
	`kind` text NOT NULL,
	`blob_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`encrypted_payload` text NOT NULL,
	`snapshot_id` text,
	FOREIGN KEY (`file_id`) REFERENCES `v2_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blob_id`) REFERENCES `v2_blobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snapshot_id`) REFERENCES `v2_private_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_derivative_kind" CHECK("v2_file_derivatives"."kind" IN ('extracted_text','transcript','sampled_frame','observation') AND "v2_file_derivatives"."file_revision" >= 1 AND "v2_file_derivatives"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_derivative_entity_unique` ON `v2_file_derivatives` (`file_id`,`file_revision`,`entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `v2_derivative_ordinal_unique` ON `v2_file_derivatives` (`file_id`,`file_revision`,`ordinal`);--> statement-breakpoint
CREATE TABLE `v2_file_edit_receipts` (
	`stage_id` text NOT NULL,
	`kind` text NOT NULL,
	`ordinal` integer NOT NULL,
	`source_id` text NOT NULL,
	`source_payload` text NOT NULL,
	`target_id` text NOT NULL,
	`target_payload` text NOT NULL,
	`source_blob_id` text,
	`source_blob_payload` text,
	PRIMARY KEY(`stage_id`, `kind`, `ordinal`),
	FOREIGN KEY (`stage_id`) REFERENCES `v2_file_edit_stages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_file_edit_receipt_kind" CHECK("v2_file_edit_receipts"."kind" IN ('coverage','observation','derivative') AND "v2_file_edit_receipts"."ordinal">=0)
);
--> statement-breakpoint
CREATE TABLE `v2_file_edit_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`file_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`target_revision` integer NOT NULL,
	`source_coverage_id` text NOT NULL,
	`target_coverage_id` text NOT NULL,
	`workspace_revision` integer NOT NULL,
	`observation_count` integer NOT NULL,
	`derivative_count` integer NOT NULL,
	`encrypted_payload` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `v2_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_coverage_id`) REFERENCES `v2_private_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_coverage_id`) REFERENCES `v2_private_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_file_edit_bounds" CHECK("v2_file_edit_stages"."source_revision">=1 AND "v2_file_edit_stages"."target_revision"="v2_file_edit_stages"."source_revision"+1 AND "v2_file_edit_stages"."workspace_revision">=1 AND "v2_file_edit_stages"."observation_count" BETWEEN 0 AND 10000 AND "v2_file_edit_stages"."derivative_count" BETWEEN 0 AND 20000 AND "v2_file_edit_stages"."expires_at">"v2_file_edit_stages"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_file_edit_coverage_unique` ON `v2_file_edit_stages` (`target_coverage_id`);--> statement-breakpoint
CREATE TABLE `v2_file_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`file_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`file_revision` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`encrypted_payload` text NOT NULL,
	`snapshot_id` text,
	FOREIGN KEY (`file_id`) REFERENCES `v2_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `v2_private_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_observation_entity_unique` ON `v2_file_observations` (`file_id`,`file_revision`,`entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `v2_observation_ordinal_unique` ON `v2_file_observations` (`file_id`,`file_revision`,`ordinal`);--> statement-breakpoint
CREATE TABLE `v2_files` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`operation_id` text NOT NULL,
	`original_blob_id` text,
	`state` text NOT NULL,
	`declared_bytes` integer NOT NULL,
	`probe_kind` text,
	`manifest_snapshot_id` text,
	`coverage_snapshot_id` text,
	`current_job_id` text,
	`failure_code` text,
	`encrypted_payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operation_id`) REFERENCES `v2_operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`original_blob_id`) REFERENCES `v2_blobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`manifest_snapshot_id`) REFERENCES `v2_private_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`coverage_snapshot_id`) REFERENCES `v2_private_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_file_state" CHECK("v2_files"."state" IN ('reserved','uploading','uploaded','queued','processing','ready','failed','deleting') AND "v2_files"."revision" >= 1 AND "v2_files"."declared_bytes" BETWEEN 1 AND 1000000000),
	CONSTRAINT "v2_file_failure" CHECK(("v2_files"."state" = 'failed' AND "v2_files"."failure_code" IS NOT NULL) OR ("v2_files"."state" != 'failed' AND "v2_files"."failure_code" IS NULL)),
	CONSTRAINT "v2_file_ready" CHECK("v2_files"."state" != 'ready' OR ("v2_files"."probe_kind" IN ('document','image','audio','video') AND "v2_files"."manifest_snapshot_id" IS NOT NULL AND "v2_files"."coverage_snapshot_id" IS NOT NULL AND "v2_files"."current_job_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `v2_files_workspace_idx` ON `v2_files` (`workspace_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `v2_idempotency` (
	`owner_id` text NOT NULL,
	`route` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`operation_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `route`, `key`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operation_id`) REFERENCES `v2_operations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_idempotency_hash" CHECK(length("v2_idempotency"."request_hash") = 64 AND "v2_idempotency"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TABLE `v2_intakes` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`summary_id` text,
	`confirmed_summary_revision` integer,
	`current_job_id` text,
	`encrypted_payload` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_intake_lifecycle" CHECK("v2_intakes"."revision" >= 1 AND "v2_intakes"."status" IN ('collecting','generating_questions','reviewing_summary','confirmed') AND
  (("v2_intakes"."status" = 'confirmed' AND "v2_intakes"."summary_id" IS NOT NULL AND "v2_intakes"."confirmed_summary_revision" IS NOT NULL AND "v2_intakes"."current_job_id" IS NULL) OR
   ("v2_intakes"."status" = 'reviewing_summary' AND "v2_intakes"."summary_id" IS NOT NULL AND "v2_intakes"."confirmed_summary_revision" IS NULL AND "v2_intakes"."current_job_id" IS NULL) OR
   ("v2_intakes"."status" = 'collecting' AND "v2_intakes"."summary_id" IS NULL AND "v2_intakes"."confirmed_summary_revision" IS NULL AND "v2_intakes"."current_job_id" IS NULL) OR
   ("v2_intakes"."status" = 'generating_questions' AND "v2_intakes"."summary_id" IS NULL AND "v2_intakes"."confirmed_summary_revision" IS NULL AND "v2_intakes"."current_job_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE `v2_job_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`fencing` integer NOT NULL,
	`phase` text NOT NULL,
	`encrypted_payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `v2_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_job_checkpoint_revision_unique` ON `v2_job_checkpoints` (`job_id`,`revision`);--> statement-breakpoint
CREATE TABLE `v2_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`runtime_instance_id` text NOT NULL,
	`workspace_id` text,
	`profile_id` text,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`target_revision` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`phase` text DEFAULT 'admission' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`fencing` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` text,
	`failure_code` text,
	`retryable` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `v2_operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `v2_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_job_target" CHECK(("v2_jobs"."target_kind" = 'workspace' AND "v2_jobs"."workspace_id" = "v2_jobs"."target_id" AND "v2_jobs"."profile_id" IS NULL AND "v2_jobs"."kind" IN ('intake_questions','intake_summary','chat_response')) OR ("v2_jobs"."target_kind" = 'file' AND "v2_jobs"."workspace_id" IS NOT NULL AND "v2_jobs"."profile_id" IS NULL AND "v2_jobs"."kind" = 'file_processing') OR ("v2_jobs"."target_kind" = 'report' AND "v2_jobs"."workspace_id" IS NOT NULL AND "v2_jobs"."profile_id" IS NULL AND "v2_jobs"."kind" = 'report_build') OR ("v2_jobs"."target_kind" = 'profile_asset' AND "v2_jobs"."profile_id" IS NOT NULL AND "v2_jobs"."workspace_id" IS NULL AND "v2_jobs"."kind" = 'portfolio_sanitize')),
	CONSTRAINT "v2_job_state" CHECK("v2_jobs"."status" IN ('queued','running','validating','completed','failed','cancelled','superseded') AND "v2_jobs"."phase" IN ('admission','extracting','transcribing','observing','retrieving','generating','validating','assembling','finished') AND "v2_jobs"."target_revision" >= 1 AND "v2_jobs"."progress" BETWEEN 0 AND 100 AND "v2_jobs"."attempts" BETWEEN 0 AND 10 AND "v2_jobs"."fencing" >= 0 AND "v2_jobs"."retryable" IN (0,1)),
	CONSTRAINT "v2_job_terminal" CHECK(("v2_jobs"."status" != 'completed' OR ("v2_jobs"."progress" = 100 AND "v2_jobs"."phase" = 'finished')) AND (("v2_jobs"."status" = 'failed' AND "v2_jobs"."failure_code" IS NOT NULL) OR ("v2_jobs"."status" != 'failed' AND "v2_jobs"."failure_code" IS NULL)) AND ("v2_jobs"."retryable" = 0 OR "v2_jobs"."status" = 'failed') AND (("v2_jobs"."lease_token" IS NULL AND "v2_jobs"."lease_until" IS NULL) OR ("v2_jobs"."lease_token" IS NOT NULL AND "v2_jobs"."lease_until" IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_jobs_runtime_instance_id_unique` ON `v2_jobs` (`runtime_instance_id`);--> statement-breakpoint
CREATE INDEX `v2_job_queue_idx` ON `v2_jobs` (`status`,`lease_until`);--> statement-breakpoint
CREATE UNIQUE INDEX `v2_active_workspace_job_unique` ON `v2_jobs` (`workspace_id`) WHERE "v2_jobs"."target_kind" = 'workspace' AND "v2_jobs"."status" IN ('queued','running','validating');--> statement-breakpoint
CREATE TABLE `v2_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`workspace_revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`role` text NOT NULL,
	`safety` text,
	`encrypted_payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operation_id`) REFERENCES `v2_operations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_message_role" CHECK(("v2_messages"."role" = 'user' AND "v2_messages"."safety" IS NULL) OR ("v2_messages"."role" = 'assistant' AND "v2_messages"."safety" = 'validated'))
);
--> statement-breakpoint
CREATE INDEX `v2_messages_page_idx` ON `v2_messages` (`workspace_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `v2_message_operation_role_unique` ON `v2_messages` (`operation_id`,`role`);--> statement-breakpoint
CREATE TABLE `v2_moderation_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`target_revision` integer NOT NULL,
	`reviewer_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`decision` text NOT NULL,
	`encrypted_payload` text NOT NULL,
	`oauth_authenticated_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_moderation_decision" CHECK("v2_moderation_decisions"."target_kind" IN ('application','profile') AND "v2_moderation_decisions"."decision" IN ('approve','reject') AND "v2_moderation_decisions"."target_revision" >= 1 AND ("v2_moderation_decisions"."reviewer_id" IS NULL OR "v2_moderation_decisions"."reviewer_id" != "v2_moderation_decisions"."owner_id"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_moderation_target_unique` ON `v2_moderation_decisions` (`target_kind`,`target_id`,`target_revision`);--> statement-breakpoint
CREATE TABLE `v2_moderation_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`reporter_id` text,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`resolution` text,
	`encrypted_payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `v2_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "v2_moderation_report_enum" CHECK("v2_moderation_reports"."kind" IN ('identity','misleading_information','personal_data','unsafe_asset','advertising','other') AND "v2_moderation_reports"."state" IN ('open','reviewing','resolved','dismissed') AND (("v2_moderation_reports"."state" IN ('resolved','dismissed') AND "v2_moderation_reports"."resolution" IS NOT NULL) OR ("v2_moderation_reports"."state" IN ('open','reviewing') AND "v2_moderation_reports"."resolution" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE `v2_monthly_budget` (
	`month` text PRIMARY KEY NOT NULL,
	`allocation_version` integer NOT NULL,
	`environment` text NOT NULL,
	`limit_krw` integer NOT NULL,
	`settled_krw` integer DEFAULT 0 NOT NULL,
	`reserved_krw` integer DEFAULT 0 NOT NULL,
	`ambiguous_krw` integer DEFAULT 0 NOT NULL,
	`fixed_maintenance_krw` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "v2_budget_amount" CHECK("v2_monthly_budget"."limit_krw" BETWEEN 0 AND 1000000 AND "v2_monthly_budget"."environment" IN ('preview','production') AND "v2_monthly_budget"."allocation_version" >= 1 AND "v2_monthly_budget"."settled_krw" >= 0 AND "v2_monthly_budget"."reserved_krw" >= 0 AND "v2_monthly_budget"."ambiguous_krw" >= 0 AND "v2_monthly_budget"."fixed_maintenance_krw" >= 0)
);
--> statement-breakpoint
CREATE TABLE `v2_mutation_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`target_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`verified` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_claim_integrity" CHECK("v2_mutation_claims"."verified"=1)
);
--> statement-breakpoint
CREATE TABLE `v2_official_sources` (
	`source_id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`official_id` text NOT NULL,
	`version` text NOT NULL,
	`section` text NOT NULL,
	`content_hash` text NOT NULL,
	`extractor_version` text NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`source_date` text,
	`fetched_at` text NOT NULL,
	`verified_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`rights_provenance` text NOT NULL,
	`institution_id` text,
	`endpoint_id` text,
	`court` text,
	`case_number` text,
	CONSTRAINT "v2_official_source_type" CHECK("v2_official_sources"."source_type" IN ('statute','precedent','official_guide') AND length("v2_official_sources"."content_hash") = 64 AND "v2_official_sources"."content_hash" NOT GLOB '*[^0-9a-f]*' AND "v2_official_sources"."expires_at" > "v2_official_sources"."verified_at" AND ("v2_official_sources"."source_type" != 'official_guide' OR ("v2_official_sources"."institution_id" IS NOT NULL AND "v2_official_sources"."endpoint_id" IS NOT NULL)) AND ("v2_official_sources"."source_type" != 'precedent' OR ("v2_official_sources"."court" IS NOT NULL AND "v2_official_sources"."case_number" IS NOT NULL AND "v2_official_sources"."source_date" IS NOT NULL)) AND ("v2_official_sources"."source_type" != 'statute' OR "v2_official_sources"."source_date" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_official_version_unique` ON `v2_official_sources` (`source_type`,`official_id`,`version`,`section`,`content_hash`,`extractor_version`);--> statement-breakpoint
CREATE INDEX `v2_official_expiry_idx` ON `v2_official_sources` (`expires_at`);--> statement-breakpoint
CREATE TABLE `v2_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`workspace_id` text,
	`kind` text NOT NULL,
	`state` text DEFAULT 'admitted' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_operation_kind" CHECK("v2_operations"."kind" IN ('new_case','question_batch','summary','chat','file_interpretation','file_extract','report','profile_asset','profile_revision','legacy_upgrade')),
	CONSTRAINT "v2_operation_state" CHECK("v2_operations"."state" IN ('admitted','completed','failed','cancelled','ambiguous') AND "v2_operations"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE `v2_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`job_id` text,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `v2_operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `v2_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_outbox_enum" CHECK("v2_outbox"."kind" IN ('job_dispatch','profile_publish','profile_withdraw','blob_cleanup') AND "v2_outbox"."state" IN ('pending','dispatched','failed') AND "v2_outbox"."attempts" >= 0 AND "v2_outbox"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_outbox_dispatch_unique` ON `v2_outbox` (`kind`,`target_id`,`revision`);--> statement-breakpoint
CREATE TABLE `v2_parties` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`summary_revision` integer NOT NULL,
	`snapshot_id` text,
	`encrypted_payload` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `v2_private_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_party_version_unique` ON `v2_parties` (`workspace_id`,`summary_revision`,`entity_id`);--> statement-breakpoint
CREATE TABLE `v2_private_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`part_index` integer NOT NULL,
	`byte_length` integer NOT NULL,
	`encrypted_payload` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `v2_private_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_part_bounds" CHECK("v2_private_parts"."part_index" BETWEEN 0 AND 99999 AND "v2_private_parts"."byte_length" BETWEEN 1 AND 262144 AND length("v2_private_parts"."encrypted_payload") BETWEEN 24 AND 349583)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_snapshot_part_unique` ON `v2_private_parts` (`snapshot_id`,`part_index`);--> statement-breakpoint
CREATE TABLE `v2_private_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`workspace_id` text,
	`purpose` text NOT NULL,
	`target_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`part_count` integer NOT NULL,
	`byte_length` integer NOT NULL,
	`encrypted_payload` text NOT NULL,
	`created_at` text NOT NULL,
	`state` text DEFAULT 'published' NOT NULL,
	`written_parts` integer DEFAULT 0 NOT NULL,
	`written_bytes` integer DEFAULT 0 NOT NULL,
	`workspace_revision` integer,
	`lease_job_id` text,
	`lease_fencing` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_snapshot_purpose" CHECK("v2_private_snapshots"."purpose" IN ('summary','report','file_coverage','file_manifest','legacy_snapshot','profile_revision')),
	CONSTRAINT "v2_snapshot_bounds" CHECK("v2_private_snapshots"."revision" >= 1 AND "v2_private_snapshots"."part_count" BETWEEN 1 AND 100000 AND "v2_private_snapshots"."byte_length" BETWEEN 1 AND 104857600 AND "v2_private_snapshots"."state" IN ('staging','sealed','published','abandoned') AND "v2_private_snapshots"."written_parts" BETWEEN 0 AND "v2_private_snapshots"."part_count" AND "v2_private_snapshots"."written_bytes" BETWEEN 0 AND "v2_private_snapshots"."byte_length")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_snapshot_version_unique` ON `v2_private_snapshots` (`purpose`,`target_id`,`revision`);--> statement-breakpoint
CREATE TABLE `v2_profile_revision_assets` (
	`revision_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`asset_revision` integer NOT NULL,
	`ordinal` integer NOT NULL,
	PRIMARY KEY(`revision_id`, `asset_id`),
	FOREIGN KEY (`revision_id`) REFERENCES `v2_profile_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `v2_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_profile_asset_order_unique` ON `v2_profile_revision_assets` (`revision_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `v2_profile_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`application_id` text,
	`encrypted_payload` text NOT NULL,
	`submitted_at` text,
	`decided_at` text,
	`withdrawn_at` text,
	`reviewer_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `v2_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `v2_applications`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_profile_revision_status" CHECK("v2_profile_revisions"."status" IN ('draft','submitted','approved','rejected','withdrawn') AND "v2_profile_revisions"."revision" >= 1 AND ("v2_profile_revisions"."status" NOT IN ('submitted','approved','rejected') OR ("v2_profile_revisions"."submitted_at" IS NOT NULL AND "v2_profile_revisions"."application_id" IS NOT NULL)) AND ("v2_profile_revisions"."status" NOT IN ('approved','rejected') OR "v2_profile_revisions"."decided_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_profile_revision_unique` ON `v2_profile_revisions` (`profile_id`,`revision`);--> statement-breakpoint
CREATE TABLE `v2_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`approved_revision_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_profiles_owner_id_unique` ON `v2_profiles` (`owner_id`);--> statement-breakpoint
CREATE TABLE `v2_public_assets` (
	`profile_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`sanitized_blob_id` text NOT NULL,
	`public_blob_id` text NOT NULL,
	PRIMARY KEY(`profile_id`, `asset_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `v2_public_profiles`(`profile_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `v2_profile_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `v2_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sanitized_blob_id`) REFERENCES `v2_blobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`public_blob_id`) REFERENCES `v2_blobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `v2_public_profiles` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`approved_revision` integer NOT NULL,
	`content_json` text NOT NULL,
	`published_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `v2_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `v2_profile_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_public_profile_content" CHECK(json_valid("v2_public_profiles"."content_json") AND "v2_public_profiles"."approved_revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_public_profiles_revision_id_unique` ON `v2_public_profiles` (`revision_id`);--> statement-breakpoint
CREATE TABLE `v2_question_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`intake_revision` integer NOT NULL,
	`encrypted_payload` text NOT NULL,
	`question_count` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_batch_bounds" CHECK("v2_question_batches"."ordinal" BETWEEN 1 AND 3 AND "v2_question_batches"."revision" >= 1 AND "v2_question_batches"."intake_revision" >= 1 AND "v2_question_batches"."question_count" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_batch_ordinal_unique` ON `v2_question_batches` (`workspace_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `v2_quota_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`response_kind` text,
	`units` real NOT NULL,
	`state` text DEFAULT 'reserved' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operation_id`) REFERENCES `v2_operations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_quota_kind" CHECK(("v2_quota_reservations"."kind" = 'new_case' AND "v2_quota_reservations"."units" = 1 AND "v2_quota_reservations"."response_kind" IS NULL) OR ("v2_quota_reservations"."kind" = 'visible_response' AND "v2_quota_reservations"."units" = 1 AND "v2_quota_reservations"."response_kind" IN ('question_batch','summary','chat','file_interpretation')) OR ("v2_quota_reservations"."kind" = 'media' AND "v2_quota_reservations"."units" > 0 AND "v2_quota_reservations"."units" <= 3600 AND "v2_quota_reservations"."response_kind" IS NULL)),
	CONSTRAINT "v2_quota_state" CHECK("v2_quota_reservations"."state" IN ('reserved','consumed','released'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_quota_operation_kind_unique` ON `v2_quota_reservations` (`operation_id`,`kind`);--> statement-breakpoint
CREATE TABLE `v2_report_selection_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`report_id` text NOT NULL,
	`file_id` text NOT NULL,
	`file_revision` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`encrypted_payload` text NOT NULL,
	`source_file_envelope` text NOT NULL,
	`source_manifest_id` text NOT NULL,
	`source_manifest_envelope` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `v2_private_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `v2_files`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_report_stage_bounds" CHECK("v2_report_selection_stages"."ordinal" BETWEEN 0 AND 99 AND "v2_report_selection_stages"."file_revision">=1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_report_stage_file_unique` ON `v2_report_selection_stages` (`snapshot_id`,`file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `v2_report_stage_order_unique` ON `v2_report_selection_stages` (`snapshot_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `v2_report_selections` (
	`id` text PRIMARY KEY NOT NULL,
	`encrypted_payload` text NOT NULL,
	`report_id` text NOT NULL,
	`file_id` text NOT NULL,
	`file_revision` integer NOT NULL,
	`original_selected` integer DEFAULT 0 NOT NULL,
	`ordinal` integer NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `v2_reports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `v2_files`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_report_selection_bounds" CHECK("v2_report_selections"."original_selected" IN (0,1) AND "v2_report_selections"."file_revision" >= 1 AND "v2_report_selections"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_report_selection_file_unique` ON `v2_report_selections` (`report_id`,`file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `v2_report_selection_order_unique` ON `v2_report_selections` (`report_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `v2_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`workspace_revision` integer NOT NULL,
	`summary_revision` integer NOT NULL,
	`snapshot_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`state` text NOT NULL,
	`pdf_blob_id` text,
	`zip_blob_id` text,
	`current_job_id` text,
	`failure_code` text,
	`encrypted_payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `v2_private_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_id`) REFERENCES `v2_operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pdf_blob_id`) REFERENCES `v2_blobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zip_blob_id`) REFERENCES `v2_blobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_report_state" CHECK("v2_reports"."state" IN ('queued','building','ready','failed','obsolete') AND "v2_reports"."workspace_revision" >= 1 AND "v2_reports"."summary_revision" >= 1 AND "v2_reports"."revision" >= 1),
	CONSTRAINT "v2_report_ready" CHECK("v2_reports"."state" NOT IN ('ready','obsolete') OR ("v2_reports"."pdf_blob_id" IS NOT NULL AND "v2_reports"."current_job_id" IS NULL AND "v2_reports"."failure_code" IS NULL)),
	CONSTRAINT "v2_report_failure" CHECK(("v2_reports"."state" = 'failed' AND "v2_reports"."failure_code" IS NOT NULL AND "v2_reports"."current_job_id" IS NULL) OR ("v2_reports"."state" != 'failed' AND "v2_reports"."failure_code" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `v2_role_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_token` text NOT NULL,
	`actor_token` text NOT NULL,
	`role` text NOT NULL,
	`action` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "v2_role_audit_action" CHECK("v2_role_audit"."action" IN ('grant','revoke'))
);
--> statement-breakpoint
CREATE TABLE `v2_role_bindings` (
	`owner_id` text NOT NULL,
	`role` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`granted_at` text NOT NULL,
	`granted_by` text,
	PRIMARY KEY(`owner_id`, `role`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "v2_role_enum" CHECK("v2_role_bindings"."role" IN ('user','lawyer_applicant','verified_lawyer','moderator')),
	CONSTRAINT "v2_role_revision" CHECK("v2_role_bindings"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_lawyer_role_exclusive` ON `v2_role_bindings` (`owner_id`) WHERE "v2_role_bindings"."role" IN ('lawyer_applicant','verified_lawyer');--> statement-breakpoint
CREATE TABLE `v2_storage_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`workspace_id` text,
	`target_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`kind` text NOT NULL,
	`byte_length` integer NOT NULL,
	`state` text DEFAULT 'reserved' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`principal_id`) REFERENCES `v2_billing_principals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "v2_storage_reservation_kind" CHECK("v2_storage_reservations"."kind" IN ('case_original','derived_report','lawyer_asset') AND "v2_storage_reservations"."byte_length" BETWEEN 1 AND 10000000000),
	CONSTRAINT "v2_storage_reservation_state" CHECK("v2_storage_reservations"."state" IN ('reserved','stored','released'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_storage_target_unique` ON `v2_storage_reservations` (`target_id`,`kind`);--> statement-breakpoint
CREATE TABLE `v2_storage_usage` (
	`principal_id` text PRIMARY KEY NOT NULL,
	`stored_bytes` integer DEFAULT 0 NOT NULL,
	`reserved_bytes` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`principal_id`) REFERENCES `v2_billing_principals`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_storage_nonnegative" CHECK("v2_storage_usage"."stored_bytes" >= 0 AND "v2_storage_usage"."reserved_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE `v2_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`intake_revision` integer NOT NULL,
	`snapshot_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `v2_private_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_summary_revision" CHECK("v2_summaries"."revision" >= 1 AND "v2_summaries"."intake_revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_summary_revision_unique` ON `v2_summaries` (`workspace_id`,`revision`);--> statement-breakpoint
CREATE TABLE `v2_summary_edit_cursors` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`encrypted_payload` text NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `v2_summary_edit_stages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_summary_cursor_revision" CHECK("v2_summary_edit_cursors"."revision" BETWEEN 1 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `v2_summary_edit_receipts` (
	`stage_id` text NOT NULL,
	`kind` text NOT NULL,
	`ordinal` integer NOT NULL,
	`source_id` text NOT NULL,
	`source_payload` text NOT NULL,
	`target_id` text NOT NULL,
	`target_payload` text NOT NULL,
	PRIMARY KEY(`stage_id`, `kind`, `ordinal`),
	FOREIGN KEY (`stage_id`) REFERENCES `v2_summary_edit_stages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_summary_receipt_bounds" CHECK("v2_summary_edit_receipts"."kind" IN ('source_part','target_part','fact','party') AND "v2_summary_edit_receipts"."ordinal" BETWEEN 0 AND 99999)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_summary_receipt_source_unique` ON `v2_summary_edit_receipts` (`stage_id`,`kind`,`source_id`);--> statement-breakpoint
CREATE TABLE `v2_summary_edit_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`source_summary_id` text NOT NULL,
	`source_snapshot_id` text NOT NULL,
	`target_snapshot_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`target_revision` integer NOT NULL,
	`workspace_revision` integer NOT NULL,
	`intake_revision` integer NOT NULL,
	`encrypted_payload` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_summary_id`) REFERENCES `v2_summaries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `v2_private_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_snapshot_id`) REFERENCES `v2_private_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_summary_edit_bounds" CHECK("v2_summary_edit_stages"."source_revision">=1 AND "v2_summary_edit_stages"."target_revision"="v2_summary_edit_stages"."source_revision"+1 AND "v2_summary_edit_stages"."workspace_revision">=1 AND "v2_summary_edit_stages"."intake_revision">=1 AND "v2_summary_edit_stages"."expires_at">"v2_summary_edit_stages"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_summary_edit_stages_target_snapshot_id_unique` ON `v2_summary_edit_stages` (`target_snapshot_id`);--> statement-breakpoint
CREATE TABLE `v2_timeline` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`encrypted_payload` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `v2_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_timeline_entity_unique` ON `v2_timeline` (`workspace_id`,`entity_id`);--> statement-breakpoint
CREATE TABLE `v2_tombstones` (
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`deleted_at` text NOT NULL,
	PRIMARY KEY(`target_kind`, `target_id`),
	CONSTRAINT "v2_tombstone_kind" CHECK("v2_tombstones"."target_kind" IN ('workspace','account','profile','file','asset','report'))
);
--> statement-breakpoint
CREATE TABLE `v2_upgrade_stages` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`legacy_case_id` text NOT NULL,
	`workspace_target_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`source_digest` text NOT NULL,
	`encrypted_payload` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `v2_private_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`legacy_case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_upgrade_source" CHECK("v2_upgrade_stages"."source_revision">=1 AND length("v2_upgrade_stages"."source_digest")=64 AND "v2_upgrade_stages"."expires_at">"v2_upgrade_stages"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_pending_upgrade_case_unique` ON `v2_upgrade_stages` (`legacy_case_id`);--> statement-breakpoint
CREATE TABLE `v2_upload_parts` (
	`upload_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`blob_id` text NOT NULL,
	`byte_length` integer NOT NULL,
	`cipher_hash` text NOT NULL,
	`encrypted_payload` text NOT NULL,
	PRIMARY KEY(`upload_id`, `ordinal`),
	FOREIGN KEY (`upload_id`) REFERENCES `v2_upload_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blob_id`) REFERENCES `v2_blobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_upload_part_bounds" CHECK("v2_upload_parts"."ordinal" BETWEEN 0 AND 119 AND "v2_upload_parts"."byte_length" BETWEEN 1 AND 8388608 AND length("v2_upload_parts"."cipher_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE `v2_upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`reserved_bytes` integer NOT NULL,
	`chunk_bytes` integer DEFAULT 8388608 NOT NULL,
	`state` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`encrypted_payload` text,
	FOREIGN KEY (`file_id`) REFERENCES `v2_files`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_upload_state" CHECK("v2_upload_sessions"."state" IN ('open','finalized','expired','cancelled') AND "v2_upload_sessions"."chunk_bytes" = 8388608 AND "v2_upload_sessions"."reserved_bytes" BETWEEN 1 AND 1000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_upload_sessions_file_id_unique` ON `v2_upload_sessions` (`file_id`);--> statement-breakpoint
CREATE TABLE `v2_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`intake_revision` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'intake' NOT NULL,
	`archived_from` text,
	`confirmed_summary_revision` integer,
	`current_job_id` text,
	`legacy_case_id` text,
	`legacy_snapshot_id` text,
	`encrypted_payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`legacy_case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_workspace_revision" CHECK("v2_workspaces"."revision" BETWEEN 1 AND 9007199254740991 AND "v2_workspaces"."intake_revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "v2_workspace_lifecycle" CHECK("v2_workspaces"."status" IN ('intake','active','archived') AND
    (("v2_workspaces"."status" = 'archived' AND "v2_workspaces"."archived_from" IN ('intake','active') AND "v2_workspaces"."current_job_id" IS NULL) OR ("v2_workspaces"."status" != 'archived' AND "v2_workspaces"."archived_from" IS NULL)) AND
    (coalesce("v2_workspaces"."archived_from","v2_workspaces"."status") != 'active' OR "v2_workspaces"."confirmed_summary_revision" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `v2_workspace_owner_idx` ON `v2_workspaces` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `v2_workspace_legacy_unique` ON `v2_workspaces` (`legacy_case_id`);
--> statement-breakpoint
-- These database guards cover v1 auth/case cascade deletions as well as v2 repositories.
-- Journals contain only opaque object/workflow/reservation IDs and survive primary deletion.
CREATE TRIGGER v2_capture_account_delete BEFORE DELETE ON user BEGIN
 INSERT INTO v2_tombstones VALUES('account',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;

 INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at)
 VALUES(lower(hex(randomblob(16))),'account',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(target_kind,target_id) DO NOTHING;
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id)
 SELECT (SELECT id FROM v2_deletion_journals WHERE target_kind='account' AND target_id=OLD.id),coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='account' AND target_id=OLD.id)),0)+row_number() OVER(ORDER BY kind,target_id)-1,kind,target_id FROM (
 SELECT DISTINCT 'job' AS kind,runtime_instance_id AS target_id FROM v2_jobs WHERE operation_id IN (SELECT id FROM v2_operations WHERE owner_id=OLD.id)
 UNION SELECT 'job',target_id FROM v2_outbox WHERE kind='job_dispatch' AND operation_id IN (SELECT operation_id FROM v2_jobs WHERE operation_id IN (SELECT id FROM v2_operations WHERE owner_id=OLD.id))
 UNION SELECT 'blob',id FROM v2_blobs WHERE principal_id IN (SELECT id FROM v2_billing_principals WHERE owner_id=OLD.id)
 UNION SELECT 'reservation',id FROM v2_storage_reservations WHERE principal_id IN (SELECT id FROM v2_billing_principals WHERE owner_id=OLD.id)) AS resources
 WHERE NOT EXISTS(SELECT 1 FROM v2_deletion_targets d WHERE d.journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='account' AND target_id=OLD.id) AND d.kind=resources.kind AND d.target_id=resources.target_id)
 ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
 UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE (principal_id IN (SELECT id FROM v2_billing_principals WHERE owner_id=OLD.id)) AND state!='deleted';
 UPDATE v2_jobs SET status='cancelled',failure_code=NULL,retryable=0,lease_token=NULL,lease_until=NULL,fencing=fencing+1 WHERE (operation_id IN (SELECT id FROM v2_operations WHERE owner_id=OLD.id)) AND status IN ('queued','running','validating','failed');
 UPDATE v2_operations SET state='cancelled' WHERE id IN (SELECT operation_id FROM v2_jobs WHERE operation_id IN (SELECT id FROM v2_operations WHERE owner_id=OLD.id)) AND state IN ('admitted','failed','ambiguous');

 UPDATE v2_monthly_budget SET reserved_krw=reserved_krw-coalesce((SELECT sum(reserved_krw) FROM v2_cost_attempts a WHERE a.month=v2_monthly_budget.month AND a.state='reserved' AND a.operation_id IN (SELECT id FROM v2_operations WHERE owner_id=OLD.id)),0),
 ambiguous_krw=ambiguous_krw+coalesce((SELECT sum(reserved_krw) FROM v2_cost_attempts a WHERE a.month=v2_monthly_budget.month AND a.state='reserved' AND a.operation_id IN (SELECT id FROM v2_operations WHERE owner_id=OLD.id)),0);
 INSERT INTO v2_cost_receipts(id,attempt_id,previous_state,next_state) SELECT lower(hex(randomblob(16))),id,'reserved','ambiguous' FROM v2_cost_attempts WHERE state='reserved' AND operation_id IN (SELECT id FROM v2_operations WHERE owner_id=OLD.id);
 UPDATE v2_cost_attempts SET state='ambiguous' WHERE state='reserved' AND operation_id IN (SELECT id FROM v2_operations WHERE owner_id=OLD.id);
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id)
 SELECT (SELECT id FROM v2_deletion_journals WHERE target_kind='account' AND target_id=OLD.id),coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='account' AND target_id=OLD.id)),0)+row_number() OVER(ORDER BY workflow)-1,'legacy_workflow',workflow FROM (
 SELECT DISTINCT a.id||'-'||n.attempt AS workflow FROM analyses a JOIN cases c ON c.id=a.case_id JOIN (SELECT 1 attempt UNION SELECT 2 UNION SELECT 3) n ON n.attempt<=a.attempt WHERE c.user_id=OLD.id
 UNION SELECT d.instance_id FROM dispatch_outbox d JOIN analyses a ON a.id=d.analysis_id JOIN cases c ON c.id=a.case_id WHERE c.user_id=OLD.id) WHERE 1 ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER v2_capture_workspace_delete BEFORE DELETE ON v2_workspaces BEGIN
 INSERT INTO v2_tombstones VALUES('workspace',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;

 INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at)
 VALUES(lower(hex(randomblob(16))),'workspace',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(target_kind,target_id) DO NOTHING;
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id)
 SELECT (SELECT id FROM v2_deletion_journals WHERE target_kind='workspace' AND target_id=OLD.id),coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='workspace' AND target_id=OLD.id)),0)+row_number() OVER(ORDER BY kind,target_id)-1,kind,target_id FROM (
 SELECT DISTINCT 'job' AS kind,runtime_instance_id AS target_id FROM v2_jobs WHERE workspace_id=OLD.id
 UNION SELECT 'job',target_id FROM v2_outbox WHERE kind='job_dispatch' AND operation_id IN (SELECT operation_id FROM v2_jobs WHERE workspace_id=OLD.id)
 UNION SELECT 'blob',id FROM v2_blobs WHERE reservation_id IN (SELECT id FROM v2_storage_reservations WHERE workspace_id=OLD.id)
 UNION SELECT 'reservation',id FROM v2_storage_reservations WHERE workspace_id=OLD.id) AS resources
 WHERE NOT EXISTS(SELECT 1 FROM v2_deletion_targets d WHERE d.journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='workspace' AND target_id=OLD.id) AND d.kind=resources.kind AND d.target_id=resources.target_id)
 ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
 UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE (reservation_id IN (SELECT id FROM v2_storage_reservations WHERE workspace_id=OLD.id)) AND state!='deleted';
 UPDATE v2_jobs SET status='cancelled',failure_code=NULL,retryable=0,lease_token=NULL,lease_until=NULL,fencing=fencing+1 WHERE (workspace_id=OLD.id) AND status IN ('queued','running','validating','failed');
 UPDATE v2_operations SET state='cancelled' WHERE id IN (SELECT operation_id FROM v2_jobs WHERE workspace_id=OLD.id) AND state IN ('admitted','failed','ambiguous');

 UPDATE v2_monthly_budget SET reserved_krw=reserved_krw-coalesce((SELECT sum(reserved_krw) FROM v2_cost_attempts a WHERE a.month=v2_monthly_budget.month AND a.state='reserved' AND a.operation_id IN (SELECT id FROM v2_operations WHERE workspace_id=OLD.id)),0),
 ambiguous_krw=ambiguous_krw+coalesce((SELECT sum(reserved_krw) FROM v2_cost_attempts a WHERE a.month=v2_monthly_budget.month AND a.state='reserved' AND a.operation_id IN (SELECT id FROM v2_operations WHERE workspace_id=OLD.id)),0);
 INSERT INTO v2_cost_receipts(id,attempt_id,previous_state,next_state) SELECT lower(hex(randomblob(16))),id,'reserved','ambiguous' FROM v2_cost_attempts WHERE state='reserved' AND operation_id IN (SELECT id FROM v2_operations WHERE workspace_id=OLD.id);
 UPDATE v2_cost_attempts SET state='ambiguous' WHERE state='reserved' AND operation_id IN (SELECT id FROM v2_operations WHERE workspace_id=OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER v2_capture_file_delete BEFORE DELETE ON v2_files BEGIN
 INSERT INTO v2_tombstones VALUES('file',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;
 DELETE FROM v2_reports WHERE id IN (SELECT report_id FROM v2_report_selections WHERE file_id=OLD.id);

 INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at)
 VALUES(lower(hex(randomblob(16))),'file',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(target_kind,target_id) DO NOTHING;
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id)
 SELECT (SELECT id FROM v2_deletion_journals WHERE target_kind='file' AND target_id=OLD.id),coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='file' AND target_id=OLD.id)),0)+row_number() OVER(ORDER BY kind,target_id)-1,kind,target_id FROM (
 SELECT DISTINCT 'job' AS kind,runtime_instance_id AS target_id FROM v2_jobs WHERE target_kind='file' AND target_id=OLD.id
 UNION SELECT 'job',target_id FROM v2_outbox WHERE kind='job_dispatch' AND operation_id IN (SELECT operation_id FROM v2_jobs WHERE target_kind='file' AND target_id=OLD.id)
 UNION SELECT 'blob',id FROM v2_blobs WHERE reservation_id IN (SELECT id FROM v2_storage_reservations WHERE entity_id=OLD.id) OR id IN (SELECT blob_id FROM v2_file_derivatives WHERE file_id=OLD.id)
 UNION SELECT 'reservation',id FROM v2_storage_reservations WHERE entity_id=OLD.id) AS resources
 WHERE NOT EXISTS(SELECT 1 FROM v2_deletion_targets d WHERE d.journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='file' AND target_id=OLD.id) AND d.kind=resources.kind AND d.target_id=resources.target_id)
 ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
 UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE (reservation_id IN (SELECT id FROM v2_storage_reservations WHERE entity_id=OLD.id) OR id IN (SELECT blob_id FROM v2_file_derivatives WHERE file_id=OLD.id)) AND state!='deleted';
 UPDATE v2_jobs SET status='cancelled',failure_code=NULL,retryable=0,lease_token=NULL,lease_until=NULL,fencing=fencing+1 WHERE (target_kind='file' AND target_id=OLD.id) AND status IN ('queued','running','validating','failed');
 UPDATE v2_operations SET state='cancelled' WHERE id IN (SELECT operation_id FROM v2_jobs WHERE target_kind='file' AND target_id=OLD.id) AND state IN ('admitted','failed','ambiguous');

 DELETE FROM v2_private_snapshots WHERE target_id=OLD.id AND purpose IN ('file_manifest','file_coverage');
END;
--> statement-breakpoint
CREATE TRIGGER v2_capture_report_delete BEFORE DELETE ON v2_reports BEGIN
 INSERT INTO v2_tombstones VALUES('report',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;

 INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at)
 VALUES(lower(hex(randomblob(16))),'report',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(target_kind,target_id) DO NOTHING;
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id)
 SELECT (SELECT id FROM v2_deletion_journals WHERE target_kind='report' AND target_id=OLD.id),coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='report' AND target_id=OLD.id)),0)+row_number() OVER(ORDER BY kind,target_id)-1,kind,target_id FROM (
 SELECT DISTINCT 'job' AS kind,runtime_instance_id AS target_id FROM v2_jobs WHERE target_kind='report' AND target_id=OLD.id
 UNION SELECT 'job',target_id FROM v2_outbox WHERE kind='job_dispatch' AND operation_id IN (SELECT operation_id FROM v2_jobs WHERE target_kind='report' AND target_id=OLD.id)
 UNION SELECT 'blob',id FROM v2_blobs WHERE id=OLD.pdf_blob_id OR id=OLD.zip_blob_id OR reservation_id IN (SELECT id FROM v2_storage_reservations WHERE operation_id=OLD.operation_id)
 UNION SELECT 'reservation',id FROM v2_storage_reservations WHERE operation_id=OLD.operation_id) AS resources
 WHERE NOT EXISTS(SELECT 1 FROM v2_deletion_targets d WHERE d.journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='report' AND target_id=OLD.id) AND d.kind=resources.kind AND d.target_id=resources.target_id)
 ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
 UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE (id=OLD.pdf_blob_id OR id=OLD.zip_blob_id OR reservation_id IN (SELECT id FROM v2_storage_reservations WHERE operation_id=OLD.operation_id)) AND state!='deleted';
 UPDATE v2_jobs SET status='cancelled',failure_code=NULL,retryable=0,lease_token=NULL,lease_until=NULL,fencing=fencing+1 WHERE (target_kind='report' AND target_id=OLD.id) AND status IN ('queued','running','validating','failed');
 UPDATE v2_operations SET state='cancelled' WHERE id IN (SELECT operation_id FROM v2_jobs WHERE target_kind='report' AND target_id=OLD.id) AND state IN ('admitted','failed','ambiguous');

 DELETE FROM v2_private_snapshots WHERE target_id=OLD.id AND purpose='report';
END;
--> statement-breakpoint
CREATE TRIGGER v2_capture_profile_delete BEFORE DELETE ON v2_profiles BEGIN
 INSERT INTO v2_tombstones VALUES('profile',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;

 INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at)
 VALUES(lower(hex(randomblob(16))),'profile',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(target_kind,target_id) DO NOTHING;
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id)
 SELECT (SELECT id FROM v2_deletion_journals WHERE target_kind='profile' AND target_id=OLD.id),coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='profile' AND target_id=OLD.id)),0)+row_number() OVER(ORDER BY kind,target_id)-1,kind,target_id FROM (
 SELECT DISTINCT 'job' AS kind,runtime_instance_id AS target_id FROM v2_jobs WHERE profile_id=OLD.id
 UNION SELECT 'job',target_id FROM v2_outbox WHERE kind='job_dispatch' AND operation_id IN (SELECT operation_id FROM v2_jobs WHERE profile_id=OLD.id)
 UNION SELECT 'blob',id FROM v2_blobs WHERE reservation_id IN (SELECT r.id FROM v2_storage_reservations r JOIN v2_assets a ON a.id=r.entity_id WHERE a.profile_id=OLD.id)
 UNION SELECT 'reservation',id FROM v2_storage_reservations WHERE entity_id IN (SELECT id FROM v2_assets WHERE profile_id=OLD.id)) AS resources
 WHERE NOT EXISTS(SELECT 1 FROM v2_deletion_targets d WHERE d.journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='profile' AND target_id=OLD.id) AND d.kind=resources.kind AND d.target_id=resources.target_id)
 ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
 UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE (reservation_id IN (SELECT r.id FROM v2_storage_reservations r JOIN v2_assets a ON a.id=r.entity_id WHERE a.profile_id=OLD.id)) AND state!='deleted';
 UPDATE v2_jobs SET status='cancelled',failure_code=NULL,retryable=0,lease_token=NULL,lease_until=NULL,fencing=fencing+1 WHERE (profile_id=OLD.id) AND status IN ('queued','running','validating','failed');
 UPDATE v2_operations SET state='cancelled' WHERE id IN (SELECT operation_id FROM v2_jobs WHERE profile_id=OLD.id) AND state IN ('admitted','failed','ambiguous');

 DELETE FROM v2_private_snapshots WHERE target_id=OLD.id AND purpose='profile_revision';
END;
--> statement-breakpoint
CREATE TRIGGER v2_capture_asset_delete BEFORE DELETE ON v2_assets BEGIN
 INSERT INTO v2_tombstones VALUES('asset',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;

 INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at)
 VALUES(lower(hex(randomblob(16))),'asset',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(target_kind,target_id) DO NOTHING;
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id)
 SELECT (SELECT id FROM v2_deletion_journals WHERE target_kind='asset' AND target_id=OLD.id),coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='asset' AND target_id=OLD.id)),0)+row_number() OVER(ORDER BY kind,target_id)-1,kind,target_id FROM (
 SELECT DISTINCT 'job' AS kind,runtime_instance_id AS target_id FROM v2_jobs WHERE target_kind='profile_asset' AND target_id=OLD.id
 UNION SELECT 'job',target_id FROM v2_outbox WHERE kind='job_dispatch' AND operation_id IN (SELECT operation_id FROM v2_jobs WHERE target_kind='profile_asset' AND target_id=OLD.id)
 UNION SELECT 'blob',id FROM v2_blobs WHERE reservation_id IN (SELECT id FROM v2_storage_reservations WHERE entity_id=OLD.id)
 UNION SELECT 'reservation',id FROM v2_storage_reservations WHERE entity_id=OLD.id) AS resources
 WHERE NOT EXISTS(SELECT 1 FROM v2_deletion_targets d WHERE d.journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='asset' AND target_id=OLD.id) AND d.kind=resources.kind AND d.target_id=resources.target_id)
 ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
 UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE (reservation_id IN (SELECT id FROM v2_storage_reservations WHERE entity_id=OLD.id)) AND state!='deleted';
 UPDATE v2_jobs SET status='cancelled',failure_code=NULL,retryable=0,lease_token=NULL,lease_until=NULL,fencing=fencing+1 WHERE (target_kind='profile_asset' AND target_id=OLD.id) AND status IN ('queued','running','validating','failed');
 UPDATE v2_operations SET state='cancelled' WHERE id IN (SELECT operation_id FROM v2_jobs WHERE target_kind='profile_asset' AND target_id=OLD.id) AND state IN ('admitted','failed','ambiguous');

 DELETE FROM v2_public_profiles WHERE profile_id IN (SELECT profile_id FROM v2_public_assets WHERE asset_id=OLD.id);
 UPDATE v2_profiles SET approved_revision_id=NULL WHERE id=OLD.profile_id AND NOT EXISTS(SELECT 1 FROM v2_public_profiles WHERE profile_id=OLD.profile_id);
 UPDATE v2_applications SET status='withdrawn',withdrawn_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (SELECT application_id FROM v2_application_assets WHERE asset_id=OLD.id) AND status IN ('submitted','approved','rejected');
 DELETE FROM v2_role_bindings WHERE owner_id=OLD.owner_id AND role='verified_lawyer' AND OLD.purpose IN ('identity','lawyer_license','office');
 DELETE FROM v2_application_assets WHERE asset_id=OLD.id;
 DELETE FROM v2_profile_revision_assets WHERE asset_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER v2_verified_role_withdraw BEFORE DELETE ON v2_role_bindings WHEN OLD.role='verified_lawyer' BEGIN
 UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE id IN (SELECT pa.public_blob_id FROM v2_public_assets pa JOIN v2_profiles p ON p.id=pa.profile_id WHERE p.owner_id=OLD.owner_id) AND state!='deleted';
 INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at) SELECT lower(hex(randomblob(16))),'publication',p.approved_revision_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM v2_profiles p WHERE p.owner_id=OLD.owner_id AND p.approved_revision_id IS NOT NULL ON CONFLICT(target_kind,target_id) DO NOTHING;
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id) SELECT j.id,row_number() OVER(ORDER BY pa.public_blob_id)-1,'blob',pa.public_blob_id FROM v2_public_assets pa JOIN v2_profiles p ON p.id=pa.profile_id JOIN v2_deletion_journals j ON j.target_kind='publication' AND j.target_id=p.approved_revision_id WHERE p.owner_id=OLD.owner_id ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
 DELETE FROM v2_public_profiles WHERE profile_id IN (SELECT id FROM v2_profiles WHERE owner_id=OLD.owner_id);
 UPDATE v2_profiles SET approved_revision_id=NULL WHERE owner_id=OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER v2_applications_immutable_content BEFORE UPDATE ON v2_applications WHEN OLD.status!='draft' AND (NEW.encrypted_payload!=OLD.encrypted_payload OR NEW.revision!=OLD.revision OR NEW.id!=OLD.id OR NEW.status='draft') BEGIN SELECT RAISE(ABORT,'V2_IMMUTABLE_REVISION'); END;
--> statement-breakpoint
CREATE TRIGGER v2_profile_revisions_immutable_content BEFORE UPDATE ON v2_profile_revisions WHEN OLD.status!='draft' AND (NEW.encrypted_payload!=OLD.encrypted_payload OR NEW.revision!=OLD.revision OR NEW.id!=OLD.id OR NEW.status='draft') BEGIN SELECT RAISE(ABORT,'V2_IMMUTABLE_REVISION'); END;
--> statement-breakpoint
CREATE TRIGGER v2_snapshot_immutable_parts BEFORE UPDATE ON v2_private_parts WHEN EXISTS(SELECT 1 FROM v2_private_snapshots WHERE id=OLD.snapshot_id AND state IN ('sealed','published')) BEGIN SELECT RAISE(ABORT,'V2_IMMUTABLE_SNAPSHOT'); END;
--> statement-breakpoint
CREATE TRIGGER v2_snapshot_immutable_header BEFORE UPDATE ON v2_private_snapshots WHEN OLD.state IN ('sealed','published') AND (NEW.encrypted_payload!=OLD.encrypted_payload OR NEW.target_id!=OLD.target_id OR NEW.purpose!=OLD.purpose OR NEW.owner_id!=OLD.owner_id OR NEW.revision!=OLD.revision OR NEW.part_count!=OLD.part_count OR NEW.byte_length!=OLD.byte_length) BEGIN SELECT RAISE(ABORT,'V2_IMMUTABLE_SNAPSHOT'); END;


--> statement-breakpoint
CREATE TRIGGER v2_release_operation_delete BEFORE DELETE ON v2_operations BEGIN
 UPDATE v2_daily_usage SET cases_reserved=cases_reserved-coalesce((SELECT sum(units) FROM v2_quota_reservations r WHERE r.operation_id=OLD.id AND r.owner_id=v2_daily_usage.owner_id AND r.day=v2_daily_usage.day AND r.kind='new_case' AND r.state='reserved'),0),responses_reserved=responses_reserved-coalesce((SELECT sum(units) FROM v2_quota_reservations r WHERE r.operation_id=OLD.id AND r.owner_id=v2_daily_usage.owner_id AND r.day=v2_daily_usage.day AND r.kind='visible_response' AND r.state='reserved'),0),media_reserved=media_reserved-coalesce((SELECT sum(units) FROM v2_quota_reservations r WHERE r.operation_id=OLD.id AND r.owner_id=v2_daily_usage.owner_id AND r.day=v2_daily_usage.day AND r.kind='media' AND r.state='reserved'),0);
 UPDATE v2_quota_reservations SET state='released' WHERE operation_id=OLD.id AND state='reserved';
END;
--> statement-breakpoint
CREATE TRIGGER v2_release_cancelled_operation AFTER UPDATE OF state ON v2_operations WHEN NEW.state='cancelled' AND OLD.state!='cancelled' BEGIN
 UPDATE v2_daily_usage SET cases_reserved=cases_reserved-coalesce((SELECT sum(units) FROM v2_quota_reservations r WHERE r.operation_id=NEW.id AND r.owner_id=v2_daily_usage.owner_id AND r.day=v2_daily_usage.day AND r.kind='new_case' AND r.state='reserved'),0),responses_reserved=responses_reserved-coalesce((SELECT sum(units) FROM v2_quota_reservations r WHERE r.operation_id=NEW.id AND r.owner_id=v2_daily_usage.owner_id AND r.day=v2_daily_usage.day AND r.kind='visible_response' AND r.state='reserved'),0),media_reserved=media_reserved-coalesce((SELECT sum(units) FROM v2_quota_reservations r WHERE r.operation_id=NEW.id AND r.owner_id=v2_daily_usage.owner_id AND r.day=v2_daily_usage.day AND r.kind='media' AND r.state='reserved'),0);
 UPDATE v2_quota_reservations SET state='released' WHERE operation_id=NEW.id AND state='reserved';
END;

--> statement-breakpoint
CREATE TRIGGER v2_legacy_stage_delete BEFORE DELETE ON cases BEGIN
 DELETE FROM v2_private_snapshots WHERE id IN (SELECT snapshot_id FROM v2_upgrade_stages WHERE legacy_case_id=OLD.id) AND state IN ('staging','sealed');
END;

--> statement-breakpoint
CREATE TRIGGER v2_public_asset_delete BEFORE DELETE ON v2_public_assets BEGIN
 INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at) VALUES(lower(hex(randomblob(16))),'publication',OLD.revision_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(target_kind,target_id) DO NOTHING;
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id) SELECT j.id,coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=j.id),0),'blob',OLD.public_blob_id FROM v2_deletion_journals j WHERE j.target_kind='publication' AND j.target_id=OLD.revision_id ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
 UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE id=OLD.public_blob_id AND state!='deleted';
END;
--> statement-breakpoint
CREATE TRIGGER v2_cancel_cost_preserve AFTER UPDATE OF state ON v2_operations WHEN NEW.state='cancelled' AND OLD.state!='cancelled' BEGIN
 UPDATE v2_monthly_budget SET reserved_krw=reserved_krw-coalesce((SELECT sum(reserved_krw) FROM v2_cost_attempts a WHERE a.month=v2_monthly_budget.month AND a.state='reserved' AND a.operation_id=NEW.id),0),ambiguous_krw=ambiguous_krw+coalesce((SELECT sum(reserved_krw) FROM v2_cost_attempts a WHERE a.month=v2_monthly_budget.month AND a.state='reserved' AND a.operation_id=NEW.id),0);
 INSERT INTO v2_cost_receipts(id,attempt_id,previous_state,next_state) SELECT lower(hex(randomblob(16))),id,'reserved','ambiguous' FROM v2_cost_attempts WHERE state='reserved' AND operation_id=NEW.id;
 UPDATE v2_cost_attempts SET state='ambiguous' WHERE state='reserved' AND operation_id=NEW.id;
END;

--> statement-breakpoint
CREATE TRIGGER v2_sealed_part_insert BEFORE INSERT ON v2_private_parts WHEN EXISTS(SELECT 1 FROM v2_private_snapshots WHERE id=NEW.snapshot_id AND state='sealed') BEGIN SELECT RAISE(ABORT,'V2_IMMUTABLE_SNAPSHOT'); END;

--> statement-breakpoint
-- All D1 INTEGER metadata is nonnegative and exactly JS-safe.
CREATE TRIGGER v2_actions_safe_integer_insert BEFORE INSERT ON "v2_actions" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_actions_safe_integer_update BEFORE UPDATE ON "v2_actions" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_allocation_acknowledgments_safe_integer_insert BEFORE INSERT ON "v2_allocation_acknowledgments" WHEN (NEW."version" IS NOT NULL AND (typeof(NEW."version")!='integer' OR NEW."version"<0 OR NEW."version">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_allocation_acknowledgments_safe_integer_update BEFORE UPDATE ON "v2_allocation_acknowledgments" WHEN (NEW."version" IS NOT NULL AND (typeof(NEW."version")!='integer' OR NEW."version"<0 OR NEW."version">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_answers_safe_integer_insert BEFORE INSERT ON "v2_answers" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_answers_safe_integer_update BEFORE UPDATE ON "v2_answers" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_applications_safe_integer_insert BEFORE INSERT ON "v2_applications" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_applications_safe_integer_update BEFORE UPDATE ON "v2_applications" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_assets_safe_integer_insert BEFORE INSERT ON "v2_assets" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_assets_safe_integer_update BEFORE UPDATE ON "v2_assets" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_blobs_safe_integer_insert BEFORE INSERT ON "v2_blobs" WHEN (NEW."logical_bytes" IS NOT NULL AND (typeof(NEW."logical_bytes")!='integer' OR NEW."logical_bytes"<0 OR NEW."logical_bytes">9007199254740991)) OR (NEW."cipher_bytes" IS NOT NULL AND (typeof(NEW."cipher_bytes")!='integer' OR NEW."cipher_bytes"<0 OR NEW."cipher_bytes">9007199254740991)) OR (NEW."source_asset_revision" IS NOT NULL AND (typeof(NEW."source_asset_revision")!='integer' OR NEW."source_asset_revision"<0 OR NEW."source_asset_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_blobs_safe_integer_update BEFORE UPDATE ON "v2_blobs" WHEN (NEW."logical_bytes" IS NOT NULL AND (typeof(NEW."logical_bytes")!='integer' OR NEW."logical_bytes"<0 OR NEW."logical_bytes">9007199254740991)) OR (NEW."cipher_bytes" IS NOT NULL AND (typeof(NEW."cipher_bytes")!='integer' OR NEW."cipher_bytes"<0 OR NEW."cipher_bytes">9007199254740991)) OR (NEW."source_asset_revision" IS NOT NULL AND (typeof(NEW."source_asset_revision")!='integer' OR NEW."source_asset_revision"<0 OR NEW."source_asset_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_budget_allocations_safe_integer_insert BEFORE INSERT ON "v2_budget_allocations" WHEN (NEW."version" IS NOT NULL AND (typeof(NEW."version")!='integer' OR NEW."version"<0 OR NEW."version">9007199254740991)) OR (NEW."preview_krw" IS NOT NULL AND (typeof(NEW."preview_krw")!='integer' OR NEW."preview_krw"<0 OR NEW."preview_krw">9007199254740991)) OR (NEW."production_krw" IS NOT NULL AND (typeof(NEW."production_krw")!='integer' OR NEW."production_krw"<0 OR NEW."production_krw">9007199254740991)) OR (NEW."shared_fixed_krw" IS NOT NULL AND (typeof(NEW."shared_fixed_krw")!='integer' OR NEW."shared_fixed_krw"<0 OR NEW."shared_fixed_krw">9007199254740991)) OR (NEW."maintenance_reserve_krw" IS NOT NULL AND (typeof(NEW."maintenance_reserve_krw")!='integer' OR NEW."maintenance_reserve_krw"<0 OR NEW."maintenance_reserve_krw">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_budget_allocations_safe_integer_update BEFORE UPDATE ON "v2_budget_allocations" WHEN (NEW."version" IS NOT NULL AND (typeof(NEW."version")!='integer' OR NEW."version"<0 OR NEW."version">9007199254740991)) OR (NEW."preview_krw" IS NOT NULL AND (typeof(NEW."preview_krw")!='integer' OR NEW."preview_krw"<0 OR NEW."preview_krw">9007199254740991)) OR (NEW."production_krw" IS NOT NULL AND (typeof(NEW."production_krw")!='integer' OR NEW."production_krw"<0 OR NEW."production_krw">9007199254740991)) OR (NEW."shared_fixed_krw" IS NOT NULL AND (typeof(NEW."shared_fixed_krw")!='integer' OR NEW."shared_fixed_krw"<0 OR NEW."shared_fixed_krw">9007199254740991)) OR (NEW."maintenance_reserve_krw" IS NOT NULL AND (typeof(NEW."maintenance_reserve_krw")!='integer' OR NEW."maintenance_reserve_krw"<0 OR NEW."maintenance_reserve_krw">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_case_original_usage_safe_integer_insert BEFORE INSERT ON "v2_case_original_usage" WHEN (NEW."stored_count" IS NOT NULL AND (typeof(NEW."stored_count")!='integer' OR NEW."stored_count"<0 OR NEW."stored_count">9007199254740991)) OR (NEW."reserved_count" IS NOT NULL AND (typeof(NEW."reserved_count")!='integer' OR NEW."reserved_count"<0 OR NEW."reserved_count">9007199254740991)) OR (NEW."stored_bytes" IS NOT NULL AND (typeof(NEW."stored_bytes")!='integer' OR NEW."stored_bytes"<0 OR NEW."stored_bytes">9007199254740991)) OR (NEW."reserved_bytes" IS NOT NULL AND (typeof(NEW."reserved_bytes")!='integer' OR NEW."reserved_bytes"<0 OR NEW."reserved_bytes">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_case_original_usage_safe_integer_update BEFORE UPDATE ON "v2_case_original_usage" WHEN (NEW."stored_count" IS NOT NULL AND (typeof(NEW."stored_count")!='integer' OR NEW."stored_count"<0 OR NEW."stored_count">9007199254740991)) OR (NEW."reserved_count" IS NOT NULL AND (typeof(NEW."reserved_count")!='integer' OR NEW."reserved_count"<0 OR NEW."reserved_count">9007199254740991)) OR (NEW."stored_bytes" IS NOT NULL AND (typeof(NEW."stored_bytes")!='integer' OR NEW."stored_bytes"<0 OR NEW."stored_bytes">9007199254740991)) OR (NEW."reserved_bytes" IS NOT NULL AND (typeof(NEW."reserved_bytes")!='integer' OR NEW."reserved_bytes"<0 OR NEW."reserved_bytes">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_citation_bindings_safe_integer_insert BEFORE INSERT ON "v2_citation_bindings" WHEN (NEW."snapshot_revision" IS NOT NULL AND (typeof(NEW."snapshot_revision")!='integer' OR NEW."snapshot_revision"<0 OR NEW."snapshot_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_citation_bindings_safe_integer_update BEFORE UPDATE ON "v2_citation_bindings" WHEN (NEW."snapshot_revision" IS NOT NULL AND (typeof(NEW."snapshot_revision")!='integer' OR NEW."snapshot_revision"<0 OR NEW."snapshot_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_consents_safe_integer_insert BEFORE INSERT ON "v2_consents" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_consents_safe_integer_update BEFORE UPDATE ON "v2_consents" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_cost_attempts_safe_integer_insert BEFORE INSERT ON "v2_cost_attempts" WHEN (NEW."attempt" IS NOT NULL AND (typeof(NEW."attempt")!='integer' OR NEW."attempt"<0 OR NEW."attempt">9007199254740991)) OR (NEW."reserved_krw" IS NOT NULL AND (typeof(NEW."reserved_krw")!='integer' OR NEW."reserved_krw"<0 OR NEW."reserved_krw">9007199254740991)) OR (NEW."charged_krw" IS NOT NULL AND (typeof(NEW."charged_krw")!='integer' OR NEW."charged_krw"<0 OR NEW."charged_krw">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_cost_attempts_safe_integer_update BEFORE UPDATE ON "v2_cost_attempts" WHEN (NEW."attempt" IS NOT NULL AND (typeof(NEW."attempt")!='integer' OR NEW."attempt"<0 OR NEW."attempt">9007199254740991)) OR (NEW."reserved_krw" IS NOT NULL AND (typeof(NEW."reserved_krw")!='integer' OR NEW."reserved_krw"<0 OR NEW."reserved_krw">9007199254740991)) OR (NEW."charged_krw" IS NOT NULL AND (typeof(NEW."charged_krw")!='integer' OR NEW."charged_krw"<0 OR NEW."charged_krw">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_cost_quotes_safe_integer_insert BEFORE INSERT ON "v2_cost_quotes" WHEN (NEW."version" IS NOT NULL AND (typeof(NEW."version")!='integer' OR NEW."version"<0 OR NEW."version">9007199254740991)) OR (NEW."estimated_krw" IS NOT NULL AND (typeof(NEW."estimated_krw")!='integer' OR NEW."estimated_krw"<0 OR NEW."estimated_krw">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_cost_quotes_safe_integer_update BEFORE UPDATE ON "v2_cost_quotes" WHEN (NEW."version" IS NOT NULL AND (typeof(NEW."version")!='integer' OR NEW."version"<0 OR NEW."version">9007199254740991)) OR (NEW."estimated_krw" IS NOT NULL AND (typeof(NEW."estimated_krw")!='integer' OR NEW."estimated_krw"<0 OR NEW."estimated_krw">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_daily_usage_safe_integer_insert BEFORE INSERT ON "v2_daily_usage" WHEN (NEW."cases_used" IS NOT NULL AND (typeof(NEW."cases_used")!='integer' OR NEW."cases_used"<0 OR NEW."cases_used">9007199254740991)) OR (NEW."cases_reserved" IS NOT NULL AND (typeof(NEW."cases_reserved")!='integer' OR NEW."cases_reserved"<0 OR NEW."cases_reserved">9007199254740991)) OR (NEW."responses_used" IS NOT NULL AND (typeof(NEW."responses_used")!='integer' OR NEW."responses_used"<0 OR NEW."responses_used">9007199254740991)) OR (NEW."responses_reserved" IS NOT NULL AND (typeof(NEW."responses_reserved")!='integer' OR NEW."responses_reserved"<0 OR NEW."responses_reserved">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_daily_usage_safe_integer_update BEFORE UPDATE ON "v2_daily_usage" WHEN (NEW."cases_used" IS NOT NULL AND (typeof(NEW."cases_used")!='integer' OR NEW."cases_used"<0 OR NEW."cases_used">9007199254740991)) OR (NEW."cases_reserved" IS NOT NULL AND (typeof(NEW."cases_reserved")!='integer' OR NEW."cases_reserved"<0 OR NEW."cases_reserved">9007199254740991)) OR (NEW."responses_used" IS NOT NULL AND (typeof(NEW."responses_used")!='integer' OR NEW."responses_used"<0 OR NEW."responses_used">9007199254740991)) OR (NEW."responses_reserved" IS NOT NULL AND (typeof(NEW."responses_reserved")!='integer' OR NEW."responses_reserved"<0 OR NEW."responses_reserved">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_deletion_journals_safe_integer_insert BEFORE INSERT ON "v2_deletion_journals" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."fencing" IS NOT NULL AND (typeof(NEW."fencing")!='integer' OR NEW."fencing"<0 OR NEW."fencing">9007199254740991)) OR (NEW."cursor" IS NOT NULL AND (typeof(NEW."cursor")!='integer' OR NEW."cursor"<0 OR NEW."cursor">9007199254740991)) OR (NEW."attempts" IS NOT NULL AND (typeof(NEW."attempts")!='integer' OR NEW."attempts"<0 OR NEW."attempts">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_deletion_journals_safe_integer_update BEFORE UPDATE ON "v2_deletion_journals" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."fencing" IS NOT NULL AND (typeof(NEW."fencing")!='integer' OR NEW."fencing"<0 OR NEW."fencing">9007199254740991)) OR (NEW."cursor" IS NOT NULL AND (typeof(NEW."cursor")!='integer' OR NEW."cursor"<0 OR NEW."cursor">9007199254740991)) OR (NEW."attempts" IS NOT NULL AND (typeof(NEW."attempts")!='integer' OR NEW."attempts"<0 OR NEW."attempts">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_deletion_targets_safe_integer_insert BEFORE INSERT ON "v2_deletion_targets" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_deletion_targets_safe_integer_update BEFORE UPDATE ON "v2_deletion_targets" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_items_safe_integer_insert BEFORE INSERT ON "v2_directory_items" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_items_safe_integer_update BEFORE UPDATE ON "v2_directory_items" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_snapshots_safe_integer_insert BEFORE INSERT ON "v2_directory_snapshots" WHEN (NEW."item_count" IS NOT NULL AND (typeof(NEW."item_count")!='integer' OR NEW."item_count"<0 OR NEW."item_count">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_snapshots_safe_integer_update BEFORE UPDATE ON "v2_directory_snapshots" WHEN (NEW."item_count" IS NOT NULL AND (typeof(NEW."item_count")!='integer' OR NEW."item_count"<0 OR NEW."item_count">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_fact_references_safe_integer_insert BEFORE INSERT ON "v2_fact_references" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) OR (NEW."source_revision" IS NOT NULL AND (typeof(NEW."source_revision")!='integer' OR NEW."source_revision"<0 OR NEW."source_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_fact_references_safe_integer_update BEFORE UPDATE ON "v2_fact_references" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) OR (NEW."source_revision" IS NOT NULL AND (typeof(NEW."source_revision")!='integer' OR NEW."source_revision"<0 OR NEW."source_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_facts_safe_integer_insert BEFORE INSERT ON "v2_facts" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."summary_revision" IS NOT NULL AND (typeof(NEW."summary_revision")!='integer' OR NEW."summary_revision"<0 OR NEW."summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_facts_safe_integer_update BEFORE UPDATE ON "v2_facts" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."summary_revision" IS NOT NULL AND (typeof(NEW."summary_revision")!='integer' OR NEW."summary_revision"<0 OR NEW."summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_file_derivatives_safe_integer_insert BEFORE INSERT ON "v2_file_derivatives" WHEN (NEW."file_revision" IS NOT NULL AND (typeof(NEW."file_revision")!='integer' OR NEW."file_revision"<0 OR NEW."file_revision">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_file_derivatives_safe_integer_update BEFORE UPDATE ON "v2_file_derivatives" WHEN (NEW."file_revision" IS NOT NULL AND (typeof(NEW."file_revision")!='integer' OR NEW."file_revision"<0 OR NEW."file_revision">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_file_edit_receipts_safe_integer_insert BEFORE INSERT ON "v2_file_edit_receipts" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_file_edit_receipts_safe_integer_update BEFORE UPDATE ON "v2_file_edit_receipts" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_file_edit_stages_safe_integer_insert BEFORE INSERT ON "v2_file_edit_stages" WHEN (NEW."source_revision" IS NOT NULL AND (typeof(NEW."source_revision")!='integer' OR NEW."source_revision"<0 OR NEW."source_revision">9007199254740991)) OR (NEW."target_revision" IS NOT NULL AND (typeof(NEW."target_revision")!='integer' OR NEW."target_revision"<0 OR NEW."target_revision">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) OR (NEW."observation_count" IS NOT NULL AND (typeof(NEW."observation_count")!='integer' OR NEW."observation_count"<0 OR NEW."observation_count">9007199254740991)) OR (NEW."derivative_count" IS NOT NULL AND (typeof(NEW."derivative_count")!='integer' OR NEW."derivative_count"<0 OR NEW."derivative_count">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_file_edit_stages_safe_integer_update BEFORE UPDATE ON "v2_file_edit_stages" WHEN (NEW."source_revision" IS NOT NULL AND (typeof(NEW."source_revision")!='integer' OR NEW."source_revision"<0 OR NEW."source_revision">9007199254740991)) OR (NEW."target_revision" IS NOT NULL AND (typeof(NEW."target_revision")!='integer' OR NEW."target_revision"<0 OR NEW."target_revision">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) OR (NEW."observation_count" IS NOT NULL AND (typeof(NEW."observation_count")!='integer' OR NEW."observation_count"<0 OR NEW."observation_count">9007199254740991)) OR (NEW."derivative_count" IS NOT NULL AND (typeof(NEW."derivative_count")!='integer' OR NEW."derivative_count"<0 OR NEW."derivative_count">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_file_observations_safe_integer_insert BEFORE INSERT ON "v2_file_observations" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."file_revision" IS NOT NULL AND (typeof(NEW."file_revision")!='integer' OR NEW."file_revision"<0 OR NEW."file_revision">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_file_observations_safe_integer_update BEFORE UPDATE ON "v2_file_observations" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."file_revision" IS NOT NULL AND (typeof(NEW."file_revision")!='integer' OR NEW."file_revision"<0 OR NEW."file_revision">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_files_safe_integer_insert BEFORE INSERT ON "v2_files" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."declared_bytes" IS NOT NULL AND (typeof(NEW."declared_bytes")!='integer' OR NEW."declared_bytes"<0 OR NEW."declared_bytes">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_files_safe_integer_update BEFORE UPDATE ON "v2_files" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."declared_bytes" IS NOT NULL AND (typeof(NEW."declared_bytes")!='integer' OR NEW."declared_bytes"<0 OR NEW."declared_bytes">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_intakes_safe_integer_insert BEFORE INSERT ON "v2_intakes" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."confirmed_summary_revision" IS NOT NULL AND (typeof(NEW."confirmed_summary_revision")!='integer' OR NEW."confirmed_summary_revision"<0 OR NEW."confirmed_summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_intakes_safe_integer_update BEFORE UPDATE ON "v2_intakes" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."confirmed_summary_revision" IS NOT NULL AND (typeof(NEW."confirmed_summary_revision")!='integer' OR NEW."confirmed_summary_revision"<0 OR NEW."confirmed_summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_job_checkpoints_safe_integer_insert BEFORE INSERT ON "v2_job_checkpoints" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."fencing" IS NOT NULL AND (typeof(NEW."fencing")!='integer' OR NEW."fencing"<0 OR NEW."fencing">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_job_checkpoints_safe_integer_update BEFORE UPDATE ON "v2_job_checkpoints" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."fencing" IS NOT NULL AND (typeof(NEW."fencing")!='integer' OR NEW."fencing"<0 OR NEW."fencing">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_jobs_safe_integer_insert BEFORE INSERT ON "v2_jobs" WHEN (NEW."target_revision" IS NOT NULL AND (typeof(NEW."target_revision")!='integer' OR NEW."target_revision"<0 OR NEW."target_revision">9007199254740991)) OR (NEW."progress" IS NOT NULL AND (typeof(NEW."progress")!='integer' OR NEW."progress"<0 OR NEW."progress">9007199254740991)) OR (NEW."attempts" IS NOT NULL AND (typeof(NEW."attempts")!='integer' OR NEW."attempts"<0 OR NEW."attempts">9007199254740991)) OR (NEW."fencing" IS NOT NULL AND (typeof(NEW."fencing")!='integer' OR NEW."fencing"<0 OR NEW."fencing">9007199254740991)) OR (NEW."retryable" IS NOT NULL AND (typeof(NEW."retryable")!='integer' OR NEW."retryable"<0 OR NEW."retryable">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_jobs_safe_integer_update BEFORE UPDATE ON "v2_jobs" WHEN (NEW."target_revision" IS NOT NULL AND (typeof(NEW."target_revision")!='integer' OR NEW."target_revision"<0 OR NEW."target_revision">9007199254740991)) OR (NEW."progress" IS NOT NULL AND (typeof(NEW."progress")!='integer' OR NEW."progress"<0 OR NEW."progress">9007199254740991)) OR (NEW."attempts" IS NOT NULL AND (typeof(NEW."attempts")!='integer' OR NEW."attempts"<0 OR NEW."attempts">9007199254740991)) OR (NEW."fencing" IS NOT NULL AND (typeof(NEW."fencing")!='integer' OR NEW."fencing"<0 OR NEW."fencing">9007199254740991)) OR (NEW."retryable" IS NOT NULL AND (typeof(NEW."retryable")!='integer' OR NEW."retryable"<0 OR NEW."retryable">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_messages_safe_integer_insert BEFORE INSERT ON "v2_messages" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_messages_safe_integer_update BEFORE UPDATE ON "v2_messages" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_moderation_decisions_safe_integer_insert BEFORE INSERT ON "v2_moderation_decisions" WHEN (NEW."target_revision" IS NOT NULL AND (typeof(NEW."target_revision")!='integer' OR NEW."target_revision"<0 OR NEW."target_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_moderation_decisions_safe_integer_update BEFORE UPDATE ON "v2_moderation_decisions" WHEN (NEW."target_revision" IS NOT NULL AND (typeof(NEW."target_revision")!='integer' OR NEW."target_revision"<0 OR NEW."target_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_moderation_reports_safe_integer_insert BEFORE INSERT ON "v2_moderation_reports" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_moderation_reports_safe_integer_update BEFORE UPDATE ON "v2_moderation_reports" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_monthly_budget_safe_integer_insert BEFORE INSERT ON "v2_monthly_budget" WHEN (NEW."allocation_version" IS NOT NULL AND (typeof(NEW."allocation_version")!='integer' OR NEW."allocation_version"<0 OR NEW."allocation_version">9007199254740991)) OR (NEW."limit_krw" IS NOT NULL AND (typeof(NEW."limit_krw")!='integer' OR NEW."limit_krw"<0 OR NEW."limit_krw">9007199254740991)) OR (NEW."settled_krw" IS NOT NULL AND (typeof(NEW."settled_krw")!='integer' OR NEW."settled_krw"<0 OR NEW."settled_krw">9007199254740991)) OR (NEW."reserved_krw" IS NOT NULL AND (typeof(NEW."reserved_krw")!='integer' OR NEW."reserved_krw"<0 OR NEW."reserved_krw">9007199254740991)) OR (NEW."ambiguous_krw" IS NOT NULL AND (typeof(NEW."ambiguous_krw")!='integer' OR NEW."ambiguous_krw"<0 OR NEW."ambiguous_krw">9007199254740991)) OR (NEW."fixed_maintenance_krw" IS NOT NULL AND (typeof(NEW."fixed_maintenance_krw")!='integer' OR NEW."fixed_maintenance_krw"<0 OR NEW."fixed_maintenance_krw">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_monthly_budget_safe_integer_update BEFORE UPDATE ON "v2_monthly_budget" WHEN (NEW."allocation_version" IS NOT NULL AND (typeof(NEW."allocation_version")!='integer' OR NEW."allocation_version"<0 OR NEW."allocation_version">9007199254740991)) OR (NEW."limit_krw" IS NOT NULL AND (typeof(NEW."limit_krw")!='integer' OR NEW."limit_krw"<0 OR NEW."limit_krw">9007199254740991)) OR (NEW."settled_krw" IS NOT NULL AND (typeof(NEW."settled_krw")!='integer' OR NEW."settled_krw"<0 OR NEW."settled_krw">9007199254740991)) OR (NEW."reserved_krw" IS NOT NULL AND (typeof(NEW."reserved_krw")!='integer' OR NEW."reserved_krw"<0 OR NEW."reserved_krw">9007199254740991)) OR (NEW."ambiguous_krw" IS NOT NULL AND (typeof(NEW."ambiguous_krw")!='integer' OR NEW."ambiguous_krw"<0 OR NEW."ambiguous_krw">9007199254740991)) OR (NEW."fixed_maintenance_krw" IS NOT NULL AND (typeof(NEW."fixed_maintenance_krw")!='integer' OR NEW."fixed_maintenance_krw"<0 OR NEW."fixed_maintenance_krw">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_mutation_claims_safe_integer_insert BEFORE INSERT ON "v2_mutation_claims" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."verified" IS NOT NULL AND (typeof(NEW."verified")!='integer' OR NEW."verified"<0 OR NEW."verified">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_mutation_claims_safe_integer_update BEFORE UPDATE ON "v2_mutation_claims" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."verified" IS NOT NULL AND (typeof(NEW."verified")!='integer' OR NEW."verified"<0 OR NEW."verified">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_operations_safe_integer_insert BEFORE INSERT ON "v2_operations" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_operations_safe_integer_update BEFORE UPDATE ON "v2_operations" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_outbox_safe_integer_insert BEFORE INSERT ON "v2_outbox" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."attempts" IS NOT NULL AND (typeof(NEW."attempts")!='integer' OR NEW."attempts"<0 OR NEW."attempts">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_outbox_safe_integer_update BEFORE UPDATE ON "v2_outbox" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."attempts" IS NOT NULL AND (typeof(NEW."attempts")!='integer' OR NEW."attempts"<0 OR NEW."attempts">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_parties_safe_integer_insert BEFORE INSERT ON "v2_parties" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."summary_revision" IS NOT NULL AND (typeof(NEW."summary_revision")!='integer' OR NEW."summary_revision"<0 OR NEW."summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_parties_safe_integer_update BEFORE UPDATE ON "v2_parties" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."summary_revision" IS NOT NULL AND (typeof(NEW."summary_revision")!='integer' OR NEW."summary_revision"<0 OR NEW."summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_private_parts_safe_integer_insert BEFORE INSERT ON "v2_private_parts" WHEN (NEW."part_index" IS NOT NULL AND (typeof(NEW."part_index")!='integer' OR NEW."part_index"<0 OR NEW."part_index">9007199254740991)) OR (NEW."byte_length" IS NOT NULL AND (typeof(NEW."byte_length")!='integer' OR NEW."byte_length"<0 OR NEW."byte_length">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_private_parts_safe_integer_update BEFORE UPDATE ON "v2_private_parts" WHEN (NEW."part_index" IS NOT NULL AND (typeof(NEW."part_index")!='integer' OR NEW."part_index"<0 OR NEW."part_index">9007199254740991)) OR (NEW."byte_length" IS NOT NULL AND (typeof(NEW."byte_length")!='integer' OR NEW."byte_length"<0 OR NEW."byte_length">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_private_snapshots_safe_integer_insert BEFORE INSERT ON "v2_private_snapshots" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."part_count" IS NOT NULL AND (typeof(NEW."part_count")!='integer' OR NEW."part_count"<0 OR NEW."part_count">9007199254740991)) OR (NEW."byte_length" IS NOT NULL AND (typeof(NEW."byte_length")!='integer' OR NEW."byte_length"<0 OR NEW."byte_length">9007199254740991)) OR (NEW."written_parts" IS NOT NULL AND (typeof(NEW."written_parts")!='integer' OR NEW."written_parts"<0 OR NEW."written_parts">9007199254740991)) OR (NEW."written_bytes" IS NOT NULL AND (typeof(NEW."written_bytes")!='integer' OR NEW."written_bytes"<0 OR NEW."written_bytes">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) OR (NEW."lease_fencing" IS NOT NULL AND (typeof(NEW."lease_fencing")!='integer' OR NEW."lease_fencing"<0 OR NEW."lease_fencing">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_private_snapshots_safe_integer_update BEFORE UPDATE ON "v2_private_snapshots" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."part_count" IS NOT NULL AND (typeof(NEW."part_count")!='integer' OR NEW."part_count"<0 OR NEW."part_count">9007199254740991)) OR (NEW."byte_length" IS NOT NULL AND (typeof(NEW."byte_length")!='integer' OR NEW."byte_length"<0 OR NEW."byte_length">9007199254740991)) OR (NEW."written_parts" IS NOT NULL AND (typeof(NEW."written_parts")!='integer' OR NEW."written_parts"<0 OR NEW."written_parts">9007199254740991)) OR (NEW."written_bytes" IS NOT NULL AND (typeof(NEW."written_bytes")!='integer' OR NEW."written_bytes"<0 OR NEW."written_bytes">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) OR (NEW."lease_fencing" IS NOT NULL AND (typeof(NEW."lease_fencing")!='integer' OR NEW."lease_fencing"<0 OR NEW."lease_fencing">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_profile_revision_assets_safe_integer_insert BEFORE INSERT ON "v2_profile_revision_assets" WHEN (NEW."asset_revision" IS NOT NULL AND (typeof(NEW."asset_revision")!='integer' OR NEW."asset_revision"<0 OR NEW."asset_revision">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_profile_revision_assets_safe_integer_update BEFORE UPDATE ON "v2_profile_revision_assets" WHEN (NEW."asset_revision" IS NOT NULL AND (typeof(NEW."asset_revision")!='integer' OR NEW."asset_revision"<0 OR NEW."asset_revision">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_profile_revisions_safe_integer_insert BEFORE INSERT ON "v2_profile_revisions" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_profile_revisions_safe_integer_update BEFORE UPDATE ON "v2_profile_revisions" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_profiles_safe_integer_insert BEFORE INSERT ON "v2_profiles" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_profiles_safe_integer_update BEFORE UPDATE ON "v2_profiles" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_public_profiles_safe_integer_insert BEFORE INSERT ON "v2_public_profiles" WHEN (NEW."approved_revision" IS NOT NULL AND (typeof(NEW."approved_revision")!='integer' OR NEW."approved_revision"<0 OR NEW."approved_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_public_profiles_safe_integer_update BEFORE UPDATE ON "v2_public_profiles" WHEN (NEW."approved_revision" IS NOT NULL AND (typeof(NEW."approved_revision")!='integer' OR NEW."approved_revision"<0 OR NEW."approved_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_question_batches_safe_integer_insert BEFORE INSERT ON "v2_question_batches" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) OR (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."intake_revision" IS NOT NULL AND (typeof(NEW."intake_revision")!='integer' OR NEW."intake_revision"<0 OR NEW."intake_revision">9007199254740991)) OR (NEW."question_count" IS NOT NULL AND (typeof(NEW."question_count")!='integer' OR NEW."question_count"<0 OR NEW."question_count">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_question_batches_safe_integer_update BEFORE UPDATE ON "v2_question_batches" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) OR (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."intake_revision" IS NOT NULL AND (typeof(NEW."intake_revision")!='integer' OR NEW."intake_revision"<0 OR NEW."intake_revision">9007199254740991)) OR (NEW."question_count" IS NOT NULL AND (typeof(NEW."question_count")!='integer' OR NEW."question_count"<0 OR NEW."question_count">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_report_selection_stages_safe_integer_insert BEFORE INSERT ON "v2_report_selection_stages" WHEN (NEW."file_revision" IS NOT NULL AND (typeof(NEW."file_revision")!='integer' OR NEW."file_revision"<0 OR NEW."file_revision">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_report_selection_stages_safe_integer_update BEFORE UPDATE ON "v2_report_selection_stages" WHEN (NEW."file_revision" IS NOT NULL AND (typeof(NEW."file_revision")!='integer' OR NEW."file_revision"<0 OR NEW."file_revision">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_report_selections_safe_integer_insert BEFORE INSERT ON "v2_report_selections" WHEN (NEW."file_revision" IS NOT NULL AND (typeof(NEW."file_revision")!='integer' OR NEW."file_revision"<0 OR NEW."file_revision">9007199254740991)) OR (NEW."original_selected" IS NOT NULL AND (typeof(NEW."original_selected")!='integer' OR NEW."original_selected"<0 OR NEW."original_selected">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_report_selections_safe_integer_update BEFORE UPDATE ON "v2_report_selections" WHEN (NEW."file_revision" IS NOT NULL AND (typeof(NEW."file_revision")!='integer' OR NEW."file_revision"<0 OR NEW."file_revision">9007199254740991)) OR (NEW."original_selected" IS NOT NULL AND (typeof(NEW."original_selected")!='integer' OR NEW."original_selected"<0 OR NEW."original_selected">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_reports_safe_integer_insert BEFORE INSERT ON "v2_reports" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) OR (NEW."summary_revision" IS NOT NULL AND (typeof(NEW."summary_revision")!='integer' OR NEW."summary_revision"<0 OR NEW."summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_reports_safe_integer_update BEFORE UPDATE ON "v2_reports" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) OR (NEW."summary_revision" IS NOT NULL AND (typeof(NEW."summary_revision")!='integer' OR NEW."summary_revision"<0 OR NEW."summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_role_bindings_safe_integer_insert BEFORE INSERT ON "v2_role_bindings" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_role_bindings_safe_integer_update BEFORE UPDATE ON "v2_role_bindings" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_reservations_safe_integer_insert BEFORE INSERT ON "v2_storage_reservations" WHEN (NEW."byte_length" IS NOT NULL AND (typeof(NEW."byte_length")!='integer' OR NEW."byte_length"<0 OR NEW."byte_length">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_reservations_safe_integer_update BEFORE UPDATE ON "v2_storage_reservations" WHEN (NEW."byte_length" IS NOT NULL AND (typeof(NEW."byte_length")!='integer' OR NEW."byte_length"<0 OR NEW."byte_length">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_usage_safe_integer_insert BEFORE INSERT ON "v2_storage_usage" WHEN (NEW."stored_bytes" IS NOT NULL AND (typeof(NEW."stored_bytes")!='integer' OR NEW."stored_bytes"<0 OR NEW."stored_bytes">9007199254740991)) OR (NEW."reserved_bytes" IS NOT NULL AND (typeof(NEW."reserved_bytes")!='integer' OR NEW."reserved_bytes"<0 OR NEW."reserved_bytes">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_usage_safe_integer_update BEFORE UPDATE ON "v2_storage_usage" WHEN (NEW."stored_bytes" IS NOT NULL AND (typeof(NEW."stored_bytes")!='integer' OR NEW."stored_bytes"<0 OR NEW."stored_bytes">9007199254740991)) OR (NEW."reserved_bytes" IS NOT NULL AND (typeof(NEW."reserved_bytes")!='integer' OR NEW."reserved_bytes"<0 OR NEW."reserved_bytes">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_summaries_safe_integer_insert BEFORE INSERT ON "v2_summaries" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."intake_revision" IS NOT NULL AND (typeof(NEW."intake_revision")!='integer' OR NEW."intake_revision"<0 OR NEW."intake_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_summaries_safe_integer_update BEFORE UPDATE ON "v2_summaries" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."intake_revision" IS NOT NULL AND (typeof(NEW."intake_revision")!='integer' OR NEW."intake_revision"<0 OR NEW."intake_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_summary_edit_cursors_safe_integer_insert BEFORE INSERT ON "v2_summary_edit_cursors" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_summary_edit_cursors_safe_integer_update BEFORE UPDATE ON "v2_summary_edit_cursors" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_summary_edit_receipts_safe_integer_insert BEFORE INSERT ON "v2_summary_edit_receipts" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_summary_edit_receipts_safe_integer_update BEFORE UPDATE ON "v2_summary_edit_receipts" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_summary_edit_stages_safe_integer_insert BEFORE INSERT ON "v2_summary_edit_stages" WHEN (NEW."source_revision" IS NOT NULL AND (typeof(NEW."source_revision")!='integer' OR NEW."source_revision"<0 OR NEW."source_revision">9007199254740991)) OR (NEW."target_revision" IS NOT NULL AND (typeof(NEW."target_revision")!='integer' OR NEW."target_revision"<0 OR NEW."target_revision">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) OR (NEW."intake_revision" IS NOT NULL AND (typeof(NEW."intake_revision")!='integer' OR NEW."intake_revision"<0 OR NEW."intake_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_summary_edit_stages_safe_integer_update BEFORE UPDATE ON "v2_summary_edit_stages" WHEN (NEW."source_revision" IS NOT NULL AND (typeof(NEW."source_revision")!='integer' OR NEW."source_revision"<0 OR NEW."source_revision">9007199254740991)) OR (NEW."target_revision" IS NOT NULL AND (typeof(NEW."target_revision")!='integer' OR NEW."target_revision"<0 OR NEW."target_revision">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) OR (NEW."intake_revision" IS NOT NULL AND (typeof(NEW."intake_revision")!='integer' OR NEW."intake_revision"<0 OR NEW."intake_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_timeline_safe_integer_insert BEFORE INSERT ON "v2_timeline" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_timeline_safe_integer_update BEFORE UPDATE ON "v2_timeline" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_upgrade_stages_safe_integer_insert BEFORE INSERT ON "v2_upgrade_stages" WHEN (NEW."source_revision" IS NOT NULL AND (typeof(NEW."source_revision")!='integer' OR NEW."source_revision"<0 OR NEW."source_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_upgrade_stages_safe_integer_update BEFORE UPDATE ON "v2_upgrade_stages" WHEN (NEW."source_revision" IS NOT NULL AND (typeof(NEW."source_revision")!='integer' OR NEW."source_revision"<0 OR NEW."source_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_upload_parts_safe_integer_insert BEFORE INSERT ON "v2_upload_parts" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) OR (NEW."byte_length" IS NOT NULL AND (typeof(NEW."byte_length")!='integer' OR NEW."byte_length"<0 OR NEW."byte_length">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_upload_parts_safe_integer_update BEFORE UPDATE ON "v2_upload_parts" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) OR (NEW."byte_length" IS NOT NULL AND (typeof(NEW."byte_length")!='integer' OR NEW."byte_length"<0 OR NEW."byte_length">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_upload_sessions_safe_integer_insert BEFORE INSERT ON "v2_upload_sessions" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."reserved_bytes" IS NOT NULL AND (typeof(NEW."reserved_bytes")!='integer' OR NEW."reserved_bytes"<0 OR NEW."reserved_bytes">9007199254740991)) OR (NEW."chunk_bytes" IS NOT NULL AND (typeof(NEW."chunk_bytes")!='integer' OR NEW."chunk_bytes"<0 OR NEW."chunk_bytes">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_upload_sessions_safe_integer_update BEFORE UPDATE ON "v2_upload_sessions" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."reserved_bytes" IS NOT NULL AND (typeof(NEW."reserved_bytes")!='integer' OR NEW."reserved_bytes"<0 OR NEW."reserved_bytes">9007199254740991)) OR (NEW."chunk_bytes" IS NOT NULL AND (typeof(NEW."chunk_bytes")!='integer' OR NEW."chunk_bytes"<0 OR NEW."chunk_bytes">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_workspaces_safe_integer_insert BEFORE INSERT ON "v2_workspaces" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."intake_revision" IS NOT NULL AND (typeof(NEW."intake_revision")!='integer' OR NEW."intake_revision"<0 OR NEW."intake_revision">9007199254740991)) OR (NEW."confirmed_summary_revision" IS NOT NULL AND (typeof(NEW."confirmed_summary_revision")!='integer' OR NEW."confirmed_summary_revision"<0 OR NEW."confirmed_summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_workspaces_safe_integer_update BEFORE UPDATE ON "v2_workspaces" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."intake_revision" IS NOT NULL AND (typeof(NEW."intake_revision")!='integer' OR NEW."intake_revision"<0 OR NEW."intake_revision">9007199254740991)) OR (NEW."confirmed_summary_revision" IS NOT NULL AND (typeof(NEW."confirmed_summary_revision")!='integer' OR NEW."confirmed_summary_revision"<0 OR NEW."confirmed_summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;

--> statement-breakpoint
UPDATE app_metadata SET value='0006_v2_domain_foundation',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
