CREATE TABLE `v2_storage_paid_executions` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`operation_revision` integer NOT NULL,
	`reservation_id` text NOT NULL,
	`blob_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`target_revision` integer NOT NULL,
	`scope` text NOT NULL,
	`pricing_proof_id` text NOT NULL,
	`funding_proof_id` text NOT NULL,
	`digest` text NOT NULL,
	`payload_json` text NOT NULL,
	`anchor_json` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`verified_at` text NOT NULL,
	`deadline_at` text NOT NULL,
	`created_at` text NOT NULL,
	`state` text DEFAULT 'prepared' NOT NULL,
	`dispatch_token` text,
	`dispatched_at` text,
	FOREIGN KEY (`attempt_id`) REFERENCES `v2_cost_attempts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pricing_proof_id`) REFERENCES `v2_runtime_proofs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`funding_proof_id`) REFERENCES `v2_runtime_proofs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_storage_paid_bounds" CHECK("v2_storage_paid_executions"."target_kind" IN ('file','profile_asset') AND "v2_storage_paid_executions"."scope" IN ('case_original','lawyer_original','approved_public_copy') AND typeof("v2_storage_paid_executions"."operation_revision")='integer' AND "v2_storage_paid_executions"."operation_revision" BETWEEN 1 AND 9007199254740991 AND typeof("v2_storage_paid_executions"."target_revision")='integer' AND "v2_storage_paid_executions"."target_revision" BETWEEN 1 AND 9007199254740991 AND length("v2_storage_paid_executions"."digest")=64 AND length("v2_storage_paid_executions"."evidence_hash")=64 AND length(CAST("v2_storage_paid_executions"."payload_json" AS BLOB))<=65536 AND length(CAST("v2_storage_paid_executions"."anchor_json" AS BLOB))<=1048576 AND "v2_storage_paid_executions"."deadline_at">"v2_storage_paid_executions"."created_at"),
	CONSTRAINT "v2_storage_paid_state" CHECK("v2_storage_paid_executions"."state" IN ('prepared','dispatched','unknown','final') AND (("v2_storage_paid_executions"."state"='prepared' AND "v2_storage_paid_executions"."dispatch_token" IS NULL AND "v2_storage_paid_executions"."dispatched_at" IS NULL) OR "v2_storage_paid_executions"."state"='final' OR ("v2_storage_paid_executions"."state" IN ('dispatched','unknown') AND "v2_storage_paid_executions"."dispatch_token" IS NOT NULL AND "v2_storage_paid_executions"."dispatched_at" IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_storage_paid_plan_unique` ON `v2_storage_paid_executions` (`plan_id`);--> statement-breakpoint
CREATE INDEX `v2_storage_paid_intent_idx` ON `v2_storage_paid_executions` (`blob_id`,`state`);
--> statement-breakpoint
CREATE TRIGGER v2_storage_paid_binding_immutable BEFORE UPDATE ON v2_storage_paid_executions WHEN NEW.attempt_id IS NOT OLD.attempt_id OR NEW.plan_id IS NOT OLD.plan_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.operation_revision IS NOT OLD.operation_revision OR NEW.reservation_id IS NOT OLD.reservation_id OR NEW.blob_id IS NOT OLD.blob_id OR NEW.target_kind IS NOT OLD.target_kind OR NEW.target_id IS NOT OLD.target_id OR NEW.target_revision IS NOT OLD.target_revision OR NEW.scope IS NOT OLD.scope OR NEW.pricing_proof_id IS NOT OLD.pricing_proof_id OR NEW.funding_proof_id IS NOT OLD.funding_proof_id OR NEW.digest IS NOT OLD.digest OR NEW.payload_json IS NOT OLD.payload_json OR NEW.anchor_json IS NOT OLD.anchor_json OR NEW.evidence_hash IS NOT OLD.evidence_hash OR NEW.verified_at IS NOT OLD.verified_at OR NEW.deadline_at IS NOT OLD.deadline_at OR NEW.created_at IS NOT OLD.created_at OR (OLD.state!='prepared' AND (NEW.dispatch_token IS NOT OLD.dispatch_token OR NEW.dispatched_at IS NOT OLD.dispatched_at)) OR NOT ((OLD.state='prepared' AND NEW.state IN ('prepared','dispatched','final')) OR (OLD.state='dispatched' AND NEW.state IN ('dispatched','unknown','final')) OR (OLD.state='unknown' AND NEW.state IN ('unknown','final')) OR (OLD.state='final' AND NEW.state='final')) BEGIN SELECT RAISE(ABORT,'IMMUTABLE_STORAGE_PAID_BINDING'); END;

--> statement-breakpoint
CREATE TRIGGER v2_storage_paid_delete_immutable BEFORE DELETE ON v2_storage_paid_executions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_STORAGE_PAID_BINDING'); END;

--> statement-breakpoint
UPDATE app_metadata SET value='0008_storage_paid_execution',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
