CREATE TABLE `v2_maintenance_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`maintenance_id` text NOT NULL,
	`action` text NOT NULL,
	`digest` text NOT NULL,
	`payload_json` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`verified_at` text NOT NULL,
	FOREIGN KEY (`maintenance_id`) REFERENCES `v2_maintenance_exposure`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_maintenance_evidence_bounds" CHECK("v2_maintenance_evidence"."action" IN ('record','settle') AND length("v2_maintenance_evidence"."digest")=64 AND length("v2_maintenance_evidence"."evidence_hash")=64 AND length(CAST("v2_maintenance_evidence"."payload_json" AS BLOB))<=65536)
);
--> statement-breakpoint
CREATE TABLE `v2_maintenance_exposure` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`reference_hash` text NOT NULL,
	`amount_krw` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`month`) REFERENCES `v2_monthly_budget`(`month`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_maintenance_bounds" CHECK(typeof("v2_maintenance_exposure"."amount_krw")='integer' AND "v2_maintenance_exposure"."amount_krw" BETWEEN 0 AND 9007199254740991 AND "v2_maintenance_exposure"."state" IN ('reserved','ambiguous','settled') AND length("v2_maintenance_exposure"."reference_hash")=64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_maintenance_reference_unique` ON `v2_maintenance_exposure` (`month`,`reference_hash`);--> statement-breakpoint
CREATE TABLE `v2_paid_holds` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`job_id` text NOT NULL,
	`state` text DEFAULT 'prepared' NOT NULL,
	`lease_token` text,
	`fencing` integer,
	`dispatch_token` text,
	`dispatched_at` text,
	FOREIGN KEY (`attempt_id`) REFERENCES `v2_cost_attempts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `v2_runtime_plans`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_paid_hold_state" CHECK("v2_paid_holds"."state" IN ('prepared','dispatched','unknown','final') AND ("v2_paid_holds"."fencing" IS NULL OR (typeof("v2_paid_holds"."fencing")='integer' AND "v2_paid_holds"."fencing" BETWEEN 1 AND 9007199254740991)) AND ("v2_paid_holds"."state" IN ('prepared','final') OR ("v2_paid_holds"."dispatch_token" IS NOT NULL AND "v2_paid_holds"."lease_token" IS NOT NULL AND "v2_paid_holds"."fencing" IS NOT NULL AND "v2_paid_holds"."dispatched_at" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE `v2_runtime_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`target_id` text NOT NULL,
	`revision` integer NOT NULL,
	`verified` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "v2_runtime_claim_bounds" CHECK(typeof("v2_runtime_claims"."revision")='integer' AND "v2_runtime_claims"."revision" BETWEEN 0 AND 9007199254740991 AND "v2_runtime_claims"."verified"=1)
);
--> statement-breakpoint
CREATE TABLE `v2_runtime_controls` (
	`month` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`phase` text DEFAULT 'frozen' NOT NULL,
	`allocation_proof_id` text,
	`pending_version` integer,
	`local_drain_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`month`) REFERENCES `v2_monthly_budget`(`month`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`allocation_proof_id`) REFERENCES `v2_runtime_proofs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_runtime_control_bounds" CHECK("v2_runtime_controls"."environment" IN ('preview','production') AND "v2_runtime_controls"."phase" IN ('active','frozen','drained') AND typeof("v2_runtime_controls"."revision")='integer' AND "v2_runtime_controls"."revision" BETWEEN 1 AND 9007199254740991 AND ("v2_runtime_controls"."pending_version" IS NULL OR (typeof("v2_runtime_controls"."pending_version")='integer' AND "v2_runtime_controls"."pending_version" BETWEEN 1 AND 9007199254740991)))
);
--> statement-breakpoint
CREATE TABLE `v2_runtime_drains` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`environment` text NOT NULL,
	`version` integer NOT NULL,
	`control_revision` integer NOT NULL,
	`manifest_hash` text NOT NULL,
	`settled_krw` integer NOT NULL,
	`fixed_krw` integer NOT NULL,
	`carryover_krw` integer NOT NULL,
	`digest` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "v2_runtime_drain_bounds" CHECK("v2_runtime_drains"."environment" IN ('preview','production') AND typeof("v2_runtime_drains"."version")='integer' AND "v2_runtime_drains"."version" BETWEEN 1 AND 9007199254740991 AND typeof("v2_runtime_drains"."control_revision")='integer' AND "v2_runtime_drains"."control_revision" BETWEEN 1 AND 9007199254740991 AND typeof("v2_runtime_drains"."settled_krw")='integer' AND "v2_runtime_drains"."settled_krw" BETWEEN 0 AND 9007199254740991 AND typeof("v2_runtime_drains"."fixed_krw")='integer' AND "v2_runtime_drains"."fixed_krw" BETWEEN 0 AND 9007199254740991 AND typeof("v2_runtime_drains"."carryover_krw")='integer' AND "v2_runtime_drains"."carryover_krw" BETWEEN 0 AND 9007199254740991 AND length("v2_runtime_drains"."digest")=64 AND length("v2_runtime_drains"."manifest_hash")=64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_runtime_drain_version_unique` ON `v2_runtime_drains` (`month`,`environment`,`version`,`control_revision`);--> statement-breakpoint
CREATE TABLE `v2_runtime_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`operation_revision` integer NOT NULL,
	`request_hash` text NOT NULL,
	`invocation_id` text NOT NULL,
	`pricing_proof_id` text NOT NULL,
	`funding_proof_id` text NOT NULL,
	`job_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`target_revision` integer NOT NULL,
	`digest` text NOT NULL,
	`payload_json` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`verified_at` text NOT NULL,
	`maximum_attempts` integer NOT NULL,
	`reserved_krw` integer NOT NULL,
	`deadline_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`pricing_proof_id`) REFERENCES `v2_runtime_proofs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`funding_proof_id`) REFERENCES `v2_runtime_proofs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_runtime_plan_bounds" CHECK(typeof("v2_runtime_plans"."operation_revision")='integer' AND "v2_runtime_plans"."operation_revision" BETWEEN 1 AND 9007199254740991 AND typeof("v2_runtime_plans"."target_revision")='integer' AND "v2_runtime_plans"."target_revision" BETWEEN 1 AND 9007199254740991 AND typeof("v2_runtime_plans"."maximum_attempts")='integer' AND "v2_runtime_plans"."maximum_attempts" BETWEEN 1 AND 10 AND typeof("v2_runtime_plans"."reserved_krw")='integer' AND "v2_runtime_plans"."reserved_krw" BETWEEN 0 AND 1000000 AND length("v2_runtime_plans"."request_hash")=64 AND length("v2_runtime_plans"."digest")=64 AND "v2_runtime_plans"."deadline_at">"v2_runtime_plans"."created_at" AND "v2_runtime_plans"."target_kind" IN ('workspace','file','report','profile_asset') AND length(CAST("v2_runtime_plans"."payload_json" AS BLOB))<=65536)
);
--> statement-breakpoint
CREATE TABLE `v2_runtime_proofs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`environment` text NOT NULL,
	`digest` text NOT NULL,
	`payload_json` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`verification_method` text NOT NULL,
	`verified_at` text NOT NULL,
	`valid_until` text NOT NULL,
	CONSTRAINT "v2_runtime_proof_bounds" CHECK("v2_runtime_proofs"."kind" IN ('pricing','funding','allocation','drain') AND "v2_runtime_proofs"."environment" IN ('preview','production') AND length("v2_runtime_proofs"."digest")=64 AND length("v2_runtime_proofs"."evidence_hash")=64 AND "v2_runtime_proofs"."verification_method" IN ('official_document','authenticated_console','authenticated_coordinator','provider_receipt') AND "v2_runtime_proofs"."valid_until">"v2_runtime_proofs"."verified_at" AND length(CAST("v2_runtime_proofs"."payload_json" AS BLOB))<=65536)
);
--> statement-breakpoint
CREATE TABLE `v2_runtime_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`digest` text NOT NULL,
	`payload_json` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`observed_at` text NOT NULL,
	`outcome` text NOT NULL,
	`charged_krw` integer,
	FOREIGN KEY (`attempt_id`) REFERENCES `v2_cost_attempts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_runtime_usage_bounds" CHECK(length("v2_runtime_usage"."digest")=64 AND length("v2_runtime_usage"."evidence_hash")=64 AND length(CAST("v2_runtime_usage"."payload_json" AS BLOB))<=65536 AND "v2_runtime_usage"."outcome" IN ('settled','ambiguous','released') AND (("v2_runtime_usage"."outcome"='settled' AND typeof("v2_runtime_usage"."charged_krw")='integer' AND "v2_runtime_usage"."charged_krw" BETWEEN 0 AND 9007199254740991) OR ("v2_runtime_usage"."outcome"!='settled' AND "v2_runtime_usage"."charged_krw" IS NULL)))
);
--> statement-breakpoint
CREATE INDEX `v2_runtime_usage_attempt_idx` ON `v2_runtime_usage` (`attempt_id`);--> statement-breakpoint
CREATE INDEX `v2_official_discovery_idx` ON `v2_official_sources` (`source_type`,`official_id`,`version`,`section`,`extractor_version`,`fetched_at`,`verified_at`);
--> statement-breakpoint
CREATE TRIGGER v2_maintenance_evidence_delete_immutable BEFORE DELETE ON v2_maintenance_evidence BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RUNTIME_EVIDENCE'); END;
--> statement-breakpoint
CREATE TRIGGER v2_maintenance_evidence_update_immutable BEFORE UPDATE ON v2_maintenance_evidence BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RUNTIME_EVIDENCE'); END;
--> statement-breakpoint
CREATE TRIGGER v2_runtime_proofs_update_immutable BEFORE UPDATE ON v2_runtime_proofs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RUNTIME_EVIDENCE'); END;

--> statement-breakpoint
CREATE TRIGGER v2_runtime_proofs_delete_immutable BEFORE DELETE ON v2_runtime_proofs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RUNTIME_EVIDENCE'); END;

--> statement-breakpoint
CREATE TRIGGER v2_runtime_plans_update_immutable BEFORE UPDATE ON v2_runtime_plans BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RUNTIME_EVIDENCE'); END;

--> statement-breakpoint
CREATE TRIGGER v2_runtime_plans_delete_immutable BEFORE DELETE ON v2_runtime_plans BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RUNTIME_EVIDENCE'); END;

--> statement-breakpoint
CREATE TRIGGER v2_runtime_usage_update_immutable BEFORE UPDATE ON v2_runtime_usage BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RUNTIME_EVIDENCE'); END;

--> statement-breakpoint
CREATE TRIGGER v2_runtime_usage_delete_immutable BEFORE DELETE ON v2_runtime_usage BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RUNTIME_EVIDENCE'); END;

--> statement-breakpoint
CREATE TRIGGER v2_runtime_drains_update_immutable BEFORE UPDATE ON v2_runtime_drains BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RUNTIME_EVIDENCE'); END;

--> statement-breakpoint
CREATE TRIGGER v2_runtime_drains_delete_immutable BEFORE DELETE ON v2_runtime_drains BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RUNTIME_EVIDENCE'); END;

--> statement-breakpoint
UPDATE app_metadata SET value='0007_runtime_paid_execution',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
