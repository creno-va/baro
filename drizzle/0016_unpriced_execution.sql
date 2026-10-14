CREATE TABLE `v2_execution_admissions` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`principal_id` text NOT NULL,
	`environment` text NOT NULL,
	`kind` text NOT NULL,
	`operation_id` text NOT NULL,
	`operation_revision` integer NOT NULL,
	`request_hash` text NOT NULL,
	`invocation_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`service` text NOT NULL,
	`job_id` text,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`target_revision` integer NOT NULL,
	`reservation_id` text,
	`blob_id` text,
	`scope` text,
	`anchor_json` text,
	`digest` text NOT NULL,
	`payload_json` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`verified_at` text NOT NULL,
	`deadline_at` text NOT NULL,
	`created_at` text NOT NULL,
	`state` text DEFAULT 'prepared' NOT NULL,
	`lease_token` text,
	`fencing` integer,
	`dispatch_token` text,
	`dispatched_at` text,
	`transport` text,
	`transport_observed_at` text,
	`transport_digest` text,
	FOREIGN KEY (`principal_id`) REFERENCES `v2_billing_principals`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_execution_environment" CHECK("v2_execution_admissions"."environment" IN ('preview','production')),
	CONSTRAINT "v2_execution_kind" CHECK(("v2_execution_admissions"."kind"='job' AND "v2_execution_admissions"."job_id" IS NOT NULL AND "v2_execution_admissions"."reservation_id" IS NULL AND "v2_execution_admissions"."blob_id" IS NULL AND "v2_execution_admissions"."scope" IS NULL AND "v2_execution_admissions"."anchor_json" IS NULL) OR ("v2_execution_admissions"."kind"='storage' AND "v2_execution_admissions"."job_id" IS NULL AND "v2_execution_admissions"."reservation_id" IS NOT NULL AND "v2_execution_admissions"."blob_id" IS NOT NULL AND "v2_execution_admissions"."scope" IN ('case_original','lawyer_original','approved_public_copy') AND json_valid("v2_execution_admissions"."anchor_json"))),
	CONSTRAINT "v2_execution_plan_binding" CHECK(json_valid("v2_execution_admissions"."payload_json") AND json_extract("v2_execution_admissions"."payload_json",'$.attemptId')="v2_execution_admissions"."attempt_id" AND json_extract("v2_execution_admissions"."payload_json",'$.planId')="v2_execution_admissions"."plan_id" AND json_extract("v2_execution_admissions"."payload_json",'$.plan.operationId')="v2_execution_admissions"."operation_id" AND json_extract("v2_execution_admissions"."payload_json",'$.plan.operationRevision')="v2_execution_admissions"."operation_revision" AND json_extract("v2_execution_admissions"."payload_json",'$.plan.requestHash')="v2_execution_admissions"."request_hash" AND json_extract("v2_execution_admissions"."payload_json",'$.plan.invocationId')="v2_execution_admissions"."invocation_id" AND json_extract("v2_execution_admissions"."payload_json",'$.attempt')="v2_execution_admissions"."attempt" AND json_extract("v2_execution_admissions"."payload_json",'$.targetKind')="v2_execution_admissions"."target_kind" AND json_extract("v2_execution_admissions"."payload_json",'$.targetId')="v2_execution_admissions"."target_id" AND json_extract("v2_execution_admissions"."payload_json",'$.targetRevision')="v2_execution_admissions"."target_revision" AND json_extract("v2_execution_admissions"."payload_json",'$.plan.deadlineAt')="v2_execution_admissions"."deadline_at" AND "v2_execution_admissions"."attempt" BETWEEN 1 AND json_extract("v2_execution_admissions"."payload_json",'$.plan.maximumAttempts') AND json_extract("v2_execution_admissions"."payload_json",'$.plan.maximumAttempts') BETWEEN 1 AND 10),
	CONSTRAINT "v2_execution_hashes" CHECK(length("v2_execution_admissions"."digest")=64 AND "v2_execution_admissions"."digest" NOT GLOB '*[^0-9a-f]*' AND length("v2_execution_admissions"."evidence_hash")=64 AND "v2_execution_admissions"."evidence_hash" NOT GLOB '*[^0-9a-f]*' AND length("v2_execution_admissions"."request_hash")=64 AND "v2_execution_admissions"."request_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "v2_execution_time" CHECK("v2_execution_admissions"."verified_at"<="v2_execution_admissions"."created_at" AND "v2_execution_admissions"."deadline_at">"v2_execution_admissions"."created_at"),
	CONSTRAINT "v2_execution_state" CHECK("v2_execution_admissions"."state" IN ('prepared','dispatched','unknown','final')),
	CONSTRAINT "v2_execution_transport" CHECK("v2_execution_admissions"."transport" IS NULL OR "v2_execution_admissions"."transport" IN ('response','provider_error','unknown','not_sent')),
	CONSTRAINT "v2_execution_dispatch" CHECK(("v2_execution_admissions"."state"='prepared' AND "v2_execution_admissions"."dispatch_token" IS NULL AND "v2_execution_admissions"."dispatched_at" IS NULL AND "v2_execution_admissions"."transport" IS NULL) OR ("v2_execution_admissions"."state"='final' AND "v2_execution_admissions"."transport"='not_sent' AND "v2_execution_admissions"."dispatch_token" IS NULL AND "v2_execution_admissions"."dispatched_at" IS NULL) OR ("v2_execution_admissions"."state" IN ('dispatched','unknown','final') AND "v2_execution_admissions"."dispatch_token" IS NOT NULL AND "v2_execution_admissions"."dispatched_at" IS NOT NULL AND ("v2_execution_admissions"."kind"='storage' OR ("v2_execution_admissions"."lease_token" IS NOT NULL AND "v2_execution_admissions"."fencing">=1)))),
	CONSTRAINT "v2_execution_observation" CHECK(("v2_execution_admissions"."transport" IS NULL AND "v2_execution_admissions"."transport_observed_at" IS NULL AND "v2_execution_admissions"."transport_digest" IS NULL) OR ("v2_execution_admissions"."transport" IS NOT NULL AND "v2_execution_admissions"."transport_observed_at" IS NOT NULL AND length("v2_execution_admissions"."transport_digest")=64))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_execution_plan_unique` ON `v2_execution_admissions` (`plan_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `v2_execution_invocation_attempt_unique` ON `v2_execution_admissions` (`invocation_id`,`attempt`);--> statement-breakpoint
CREATE INDEX `v2_execution_job_state` ON `v2_execution_admissions` (`job_id`,`state`);--> statement-breakpoint
CREATE INDEX `v2_execution_blob_state` ON `v2_execution_admissions` (`blob_id`,`state`);--> statement-breakpoint
CREATE TABLE `v2_execution_cost_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`digest` text NOT NULL,
	`payload_json` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`verified_at` text NOT NULL,
	`observed_at` text NOT NULL,
	`pricing_proof_id` text,
	`funding_proof_id` text,
	`pricing_status` text NOT NULL,
	`funding_status` text NOT NULL,
	`charged_usd` text,
	`charged_krw` integer,
	FOREIGN KEY (`attempt_id`) REFERENCES `v2_execution_admissions`(`attempt_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pricing_proof_id`) REFERENCES `v2_runtime_proofs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`funding_proof_id`) REFERENCES `v2_runtime_proofs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_execution_observation_payload" CHECK(json_valid("v2_execution_cost_observations"."payload_json") AND json_extract("v2_execution_cost_observations"."payload_json",'$.attemptId')="v2_execution_cost_observations"."attempt_id" AND json_extract("v2_execution_cost_observations"."payload_json",'$.observedAt')="v2_execution_cost_observations"."observed_at"),
	CONSTRAINT "v2_execution_price_status" CHECK("v2_execution_cost_observations"."pricing_status" IN ('missing','stale','incomplete','current')),
	CONSTRAINT "v2_execution_funding_status" CHECK("v2_execution_cost_observations"."funding_status" IN ('missing','stale','unavailable','current')),
	CONSTRAINT "v2_execution_observation_amount" CHECK("v2_execution_cost_observations"."charged_krw" IS NULL OR (typeof("v2_execution_cost_observations"."charged_krw")='integer' AND "v2_execution_cost_observations"."charged_krw" BETWEEN 0 AND 9007199254740991 AND "v2_execution_cost_observations"."pricing_status"='current'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_execution_observation_digest` ON `v2_execution_cost_observations` (`attempt_id`,`digest`);
--> statement-breakpoint
CREATE TRIGGER v2_execution_admission_immutable BEFORE UPDATE ON v2_execution_admissions WHEN NEW.attempt_id IS NOT OLD.attempt_id OR NEW.plan_id IS NOT OLD.plan_id OR NEW.principal_id IS NOT OLD.principal_id OR NEW.environment IS NOT OLD.environment OR NEW.kind IS NOT OLD.kind OR NEW.operation_id IS NOT OLD.operation_id OR NEW.operation_revision IS NOT OLD.operation_revision OR NEW.request_hash IS NOT OLD.request_hash OR NEW.invocation_id IS NOT OLD.invocation_id OR NEW.attempt IS NOT OLD.attempt OR NEW.service IS NOT OLD.service OR NEW.job_id IS NOT OLD.job_id OR NEW.target_kind IS NOT OLD.target_kind OR NEW.target_id IS NOT OLD.target_id OR NEW.target_revision IS NOT OLD.target_revision OR NEW.reservation_id IS NOT OLD.reservation_id OR NEW.blob_id IS NOT OLD.blob_id OR NEW.scope IS NOT OLD.scope OR NEW.anchor_json IS NOT OLD.anchor_json OR NEW.digest IS NOT OLD.digest OR NEW.payload_json IS NOT OLD.payload_json OR NEW.evidence_hash IS NOT OLD.evidence_hash OR NEW.verified_at IS NOT OLD.verified_at OR NEW.deadline_at IS NOT OLD.deadline_at OR NEW.created_at IS NOT OLD.created_at BEGIN SELECT RAISE(ABORT,'EXECUTION_BINDING_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER v2_execution_admission_no_delete BEFORE DELETE ON v2_execution_admissions BEGIN SELECT RAISE(ABORT,'EXECUTION_HISTORY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER v2_execution_transition BEFORE UPDATE ON v2_execution_admissions WHEN NOT (
 (OLD.state='prepared' AND NEW.state='dispatched' AND NEW.transport IS NULL)
 OR (OLD.state='prepared' AND NEW.state='final' AND NEW.transport='not_sent' AND NEW.dispatch_token IS NULL)
 OR (OLD.state IN ('dispatched','unknown') AND NEW.state IN ('unknown','final') AND NEW.dispatch_token IS OLD.dispatch_token AND NEW.dispatched_at IS OLD.dispatched_at AND NEW.lease_token IS OLD.lease_token AND NEW.fencing IS OLD.fencing AND NEW.transport IN ('response','provider_error','unknown') AND (NEW.state='unknown')=(NEW.transport='unknown'))
) BEGIN SELECT RAISE(ABORT,'EXECUTION_STATE_CONFLICT'); END;
--> statement-breakpoint
CREATE TRIGGER v2_execution_cross_route_insert BEFORE INSERT ON v2_execution_admissions WHEN
 EXISTS(SELECT 1 FROM v2_cost_attempts WHERE id=NEW.attempt_id OR (invocation_id=NEW.invocation_id AND (attempt=NEW.attempt OR state IN ('reserved','ambiguous'))))
 OR EXISTS(SELECT 1 FROM v2_execution_admissions WHERE invocation_id=NEW.invocation_id AND state IN ('prepared','dispatched','unknown'))
 OR EXISTS(SELECT 1 FROM v2_runtime_plans WHERE id=NEW.plan_id)
 OR EXISTS(SELECT 1 FROM v2_storage_paid_executions WHERE plan_id=NEW.plan_id)
 BEGIN SELECT RAISE(ABORT,'EXECUTION_ATTEMPT_CONFLICT'); END;
--> statement-breakpoint
CREATE TRIGGER v2_priced_cross_route_insert BEFORE INSERT ON v2_cost_attempts WHEN
 EXISTS(SELECT 1 FROM v2_execution_admissions WHERE attempt_id=NEW.id OR (invocation_id=NEW.invocation_id AND (attempt=NEW.attempt OR state IN ('prepared','dispatched','unknown'))))
 BEGIN SELECT RAISE(ABORT,'EXECUTION_ATTEMPT_CONFLICT'); END;
--> statement-breakpoint
CREATE TRIGGER v2_execution_observation_no_update BEFORE UPDATE ON v2_execution_cost_observations BEGIN SELECT RAISE(ABORT,'EXECUTION_OBSERVATION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER v2_execution_observation_no_delete BEFORE DELETE ON v2_execution_cost_observations BEGIN SELECT RAISE(ABORT,'EXECUTION_OBSERVATION_IMMUTABLE'); END;
--> statement-breakpoint
-- Read-only compatibility for immutable job restore/retry paths. A NULL money
-- value is unknown; these views must never synthesize cost quotes or receipts.
CREATE VIEW v2_execution_job_holds AS SELECT * FROM v2_paid_holds UNION ALL
 SELECT attempt_id,plan_id,job_id,state,lease_token,fencing,dispatch_token,dispatched_at FROM v2_execution_admissions WHERE kind='job';
--> statement-breakpoint
CREATE VIEW v2_execution_job_plans AS SELECT * FROM v2_runtime_plans UNION ALL
 SELECT plan_id,operation_id,operation_revision,request_hash,invocation_id,json_extract(payload_json,'$.pricingProofId'),json_extract(payload_json,'$.fundingProofId'),job_id,target_kind,target_id,target_revision,digest,payload_json,evidence_hash,verified_at,json_extract(payload_json,'$.plan.maximumAttempts'),NULL,deadline_at,created_at FROM v2_execution_admissions WHERE kind='job';
--> statement-breakpoint
CREATE VIEW v2_execution_attempts AS SELECT * FROM v2_cost_attempts UNION ALL
 SELECT attempt_id,principal_id,operation_id,invocation_id,attempt,NULL,NULL,service,CASE state WHEN 'unknown' THEN 'ambiguous' WHEN 'final' THEN CASE transport WHEN 'not_sent' THEN 'released' ELSE 'settled' END ELSE 'reserved' END,NULL,NULL,created_at FROM v2_execution_admissions;
--> statement-breakpoint
CREATE VIEW v2_execution_storage_holds AS SELECT * FROM v2_storage_paid_executions UNION ALL
 SELECT attempt_id,plan_id,operation_id,operation_revision,reservation_id,blob_id,target_kind,target_id,target_revision,scope,json_extract(payload_json,'$.pricingProofId'),json_extract(payload_json,'$.fundingProofId'),digest,payload_json,anchor_json,evidence_hash,verified_at,deadline_at,created_at,state,dispatch_token,dispatched_at FROM v2_execution_admissions WHERE kind='storage';

--> statement-breakpoint
UPDATE app_metadata SET value='0016_unpriced_execution',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
