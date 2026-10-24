CREATE TABLE `legacy_ai_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`invocation_id` text NOT NULL,
	`workflow_attempt` integer NOT NULL,
	`phase` text NOT NULL,
	`ordinal` integer NOT NULL,
	`correction` integer NOT NULL,
	`model` text NOT NULL,
	`wire_hash` text NOT NULL,
	`input_bytes` integer NOT NULL,
	`output_cap` integer NOT NULL,
	`evidence_hash` text NOT NULL,
	`bounds_json` text NOT NULL,
	`state` text DEFAULT 'prepared' NOT NULL,
	`dispatch_token` text,
	`dispatched_at` text,
	`transport` text,
	`observed_at` text,
	`deadline_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `legacy_ai_operations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "legacy_ai_attempt_bounds" CHECK(typeof("legacy_ai_attempts"."workflow_attempt")='integer' AND "legacy_ai_attempts"."workflow_attempt" BETWEEN 1 AND 3 AND typeof("legacy_ai_attempts"."ordinal")='integer' AND "legacy_ai_attempts"."ordinal" BETWEEN 1 AND 3 AND "legacy_ai_attempts"."correction" IN (0,1) AND typeof("legacy_ai_attempts"."input_bytes")='integer' AND "legacy_ai_attempts"."input_bytes">0 AND typeof("legacy_ai_attempts"."output_cap")='integer' AND "legacy_ai_attempts"."output_cap" BETWEEN 1 AND 65536),
	CONSTRAINT "legacy_ai_phase" CHECK("legacy_ai_attempts"."phase" IN ('minimize','screening','structure','questions','generation','validation')),
	CONSTRAINT "legacy_ai_attempt_hashes" CHECK(length("legacy_ai_attempts"."wire_hash")=64 AND "legacy_ai_attempts"."wire_hash" NOT GLOB '*[^0-9a-f]*' AND length("legacy_ai_attempts"."evidence_hash")=64 AND "legacy_ai_attempts"."evidence_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "legacy_ai_bounds_json" CHECK(json_valid("legacy_ai_attempts"."bounds_json") AND length(CAST("legacy_ai_attempts"."bounds_json" AS BLOB))<=8192),
	CONSTRAINT "legacy_ai_wire_binding" CHECK("legacy_ai_attempts"."model"='google/gemini-3.8-flash' AND json_extract("legacy_ai_attempts"."bounds_json",'$.model') IS "legacy_ai_attempts"."model" AND json_extract("legacy_ai_attempts"."bounds_json",'$.phase') IS "legacy_ai_attempts"."phase" AND json_extract("legacy_ai_attempts"."bounds_json",'$.wireInputSha256') IS "legacy_ai_attempts"."wire_hash" AND json_extract("legacy_ai_attempts"."bounds_json",'$.inputBytes') IS "legacy_ai_attempts"."input_bytes" AND json_extract("legacy_ai_attempts"."bounds_json",'$.outputTokenUpperBound') IS "legacy_ai_attempts"."output_cap" AND json_extract("legacy_ai_attempts"."bounds_json",'$.correction') IS "legacy_ai_attempts"."correction"),
	CONSTRAINT "legacy_ai_attempt_time" CHECK("legacy_ai_attempts"."deadline_at">"legacy_ai_attempts"."created_at"),
	CONSTRAINT "legacy_ai_attempt_state" CHECK("legacy_ai_attempts"."state" IN ('prepared','dispatched','unknown','final')),
	CONSTRAINT "legacy_ai_attempt_dispatch" CHECK(("legacy_ai_attempts"."state"='prepared' AND "legacy_ai_attempts"."dispatch_token" IS NULL AND "legacy_ai_attempts"."dispatched_at" IS NULL AND "legacy_ai_attempts"."transport" IS NULL AND "legacy_ai_attempts"."observed_at" IS NULL) OR ("legacy_ai_attempts"."state"='final' AND "legacy_ai_attempts"."dispatch_token" IS NULL AND "legacy_ai_attempts"."dispatched_at" IS NULL AND "legacy_ai_attempts"."transport"='not_sent' AND "legacy_ai_attempts"."observed_at" IS NOT NULL) OR ("legacy_ai_attempts"."state" IN ('dispatched','unknown','final') AND "legacy_ai_attempts"."dispatch_token" IS NOT NULL AND "legacy_ai_attempts"."dispatched_at" IS NOT NULL AND (("legacy_ai_attempts"."state"='dispatched' AND "legacy_ai_attempts"."transport" IS NULL AND "legacy_ai_attempts"."observed_at" IS NULL) OR ("legacy_ai_attempts"."state"='unknown' AND "legacy_ai_attempts"."transport"='unknown' AND "legacy_ai_attempts"."observed_at" IS NOT NULL) OR ("legacy_ai_attempts"."state"='final' AND "legacy_ai_attempts"."transport" IN ('response','provider_error') AND "legacy_ai_attempts"."observed_at" IS NOT NULL))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_ai_phase_ordinal_unique` ON `legacy_ai_attempts` (`operation_id`,`workflow_attempt`,`phase`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_ai_invocation_ordinal_unique` ON `legacy_ai_attempts` (`invocation_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `legacy_ai_operation_state` ON `legacy_ai_attempts` (`operation_id`,`state`);--> statement-breakpoint
CREATE TABLE `legacy_ai_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`digest` text NOT NULL,
	`payload_json` text NOT NULL,
	`observed_at` text NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `legacy_ai_attempts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "legacy_ai_observation_hash" CHECK(length("legacy_ai_observations"."digest")=64 AND "legacy_ai_observations"."digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "legacy_ai_observation_payload" CHECK(json_valid("legacy_ai_observations"."payload_json") AND length(CAST("legacy_ai_observations"."payload_json" AS BLOB))<=4096 AND json_extract("legacy_ai_observations"."payload_json",'$.observedAt') IS "legacy_ai_observations"."observed_at" AND json_extract("legacy_ai_observations"."payload_json",'$.transport') IN ('response','provider_error','unknown','not_sent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_ai_observation_digest` ON `legacy_ai_observations` (`attempt_id`,`digest`);--> statement-breakpoint
CREATE TABLE `legacy_ai_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`analysis_id` text,
	`case_id` text,
	`input_revision` integer NOT NULL,
	`source_hash` text NOT NULL,
	`day` text NOT NULL,
	`workflow_attempt` integer NOT NULL,
	`quota_state` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`principal_id`) REFERENCES `v2_billing_principals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "legacy_ai_operation_bounds" CHECK(typeof("legacy_ai_operations"."input_revision")='integer' AND "legacy_ai_operations"."input_revision" BETWEEN 1 AND 9007199254740991 AND typeof("legacy_ai_operations"."workflow_attempt")='integer' AND "legacy_ai_operations"."workflow_attempt" BETWEEN 1 AND 3),
	CONSTRAINT "legacy_ai_source_hash" CHECK(length("legacy_ai_operations"."source_hash")=64 AND "legacy_ai_operations"."source_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "legacy_ai_quota_state" CHECK("legacy_ai_operations"."quota_state" IN ('reserved','consumed','released')),
	CONSTRAINT "legacy_ai_day" CHECK("legacy_ai_operations"."day" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_ai_analysis_unique` ON `legacy_ai_operations` (`analysis_id`);--> statement-breakpoint
CREATE INDEX `legacy_ai_principal_day` ON `legacy_ai_operations` (`principal_id`,`day`);
--> statement-breakpoint
-- These reservations share the actual AI200/day counter with v2. They never
-- reserve money or depend on price/funding/monthly observations.
CREATE TRIGGER legacy_ai_quota_insert_guard BEFORE INSERT ON legacy_ai_operations
WHEN NEW.quota_state!='reserved' OR NOT EXISTS(
 SELECT 1 FROM v2_billing_principals p JOIN v2_daily_usage u ON u.owner_id=p.owner_id
 WHERE p.id=NEW.principal_id AND u.day=NEW.day AND u.responses_used+u.responses_reserved<200
) BEGIN SELECT RAISE(ABORT,'LEGACY_AI_QUOTA_UNAVAILABLE'); END;
--> statement-breakpoint
CREATE TRIGGER legacy_ai_quota_insert AFTER INSERT ON legacy_ai_operations
BEGIN UPDATE v2_daily_usage SET responses_reserved=responses_reserved+1
 WHERE owner_id=(SELECT owner_id FROM v2_billing_principals WHERE id=NEW.principal_id) AND day=NEW.day; END;
--> statement-breakpoint
CREATE TRIGGER legacy_ai_quota_transition_guard BEFORE UPDATE OF quota_state ON legacy_ai_operations
WHEN NEW.quota_state!=OLD.quota_state AND NOT (
 (OLD.quota_state='reserved' AND NEW.quota_state IN ('consumed','released')) OR
 (OLD.quota_state='released' AND NEW.quota_state='reserved' AND NEW.workflow_attempt>OLD.workflow_attempt AND EXISTS(
  SELECT 1 FROM v2_billing_principals p JOIN v2_daily_usage u ON u.owner_id=p.owner_id
  WHERE p.id=NEW.principal_id AND u.day=NEW.day AND u.responses_used+u.responses_reserved<200
 ))) BEGIN SELECT RAISE(ABORT,'LEGACY_AI_QUOTA_TRANSITION'); END;
--> statement-breakpoint
CREATE TRIGGER legacy_ai_quota_transition AFTER UPDATE OF quota_state ON legacy_ai_operations
WHEN NEW.quota_state!=OLD.quota_state
BEGIN UPDATE v2_daily_usage SET
 responses_reserved=responses_reserved+CASE WHEN NEW.quota_state='reserved' THEN 1 ELSE -1 END,
 responses_used=responses_used+CASE WHEN NEW.quota_state='consumed' THEN 1 ELSE 0 END
 WHERE owner_id=(SELECT owner_id FROM v2_billing_principals WHERE id=NEW.principal_id) AND day=NEW.day; END;
--> statement-breakpoint
CREATE TRIGGER legacy_ai_analysis_publication AFTER UPDATE OF status ON analyses
WHEN NEW.status IN ('waiting_for_answers','completed','failed')
BEGIN UPDATE legacy_ai_operations SET quota_state=CASE WHEN NEW.status='failed' THEN 'released' ELSE 'consumed' END
 WHERE analysis_id=NEW.id AND workflow_attempt=NEW.attempt AND quota_state='reserved'; END;
--> statement-breakpoint
CREATE TRIGGER legacy_ai_analysis_delete BEFORE DELETE ON analyses
BEGIN UPDATE legacy_ai_operations SET quota_state='released' WHERE analysis_id=OLD.id AND quota_state='reserved'; END;
--> statement-breakpoint
CREATE TRIGGER legacy_ai_case_superseded AFTER UPDATE OF current_analysis_id,input_revision,user_id ON cases
WHEN NEW.current_analysis_id IS NOT OLD.current_analysis_id OR NEW.input_revision!=OLD.input_revision OR NEW.user_id!=OLD.user_id
BEGIN UPDATE legacy_ai_operations SET quota_state='released' WHERE case_id=OLD.id AND quota_state='reserved'; END;
--> statement-breakpoint
CREATE TRIGGER legacy_ai_account_delete BEFORE DELETE ON user
BEGIN UPDATE legacy_ai_operations SET quota_state='released' WHERE principal_id IN
 (SELECT id FROM v2_billing_principals WHERE owner_id=OLD.id) AND quota_state='reserved'; END;
--> statement-breakpoint
CREATE TRIGGER legacy_ai_account_tombstone AFTER INSERT ON v2_tombstones
WHEN NEW.target_kind='account'
BEGIN UPDATE legacy_ai_operations SET quota_state='released' WHERE principal_id IN
 (SELECT id FROM v2_billing_principals WHERE owner_id=NEW.target_id) AND quota_state='reserved'; END;
--> statement-breakpoint
CREATE TRIGGER legacy_ai_operation_immutable BEFORE UPDATE ON legacy_ai_operations
WHEN NEW.id IS NOT OLD.id OR NEW.principal_id IS NOT OLD.principal_id OR NEW.input_revision IS NOT OLD.input_revision
 OR NEW.source_hash IS NOT OLD.source_hash OR NEW.day IS NOT OLD.day OR NEW.created_at IS NOT OLD.created_at
 OR (NEW.analysis_id IS NOT OLD.analysis_id AND NEW.analysis_id IS NOT NULL)
 OR (NEW.case_id IS NOT OLD.case_id AND NEW.case_id IS NOT NULL)
 OR (NEW.workflow_attempt!=OLD.workflow_attempt AND NOT (NEW.workflow_attempt>OLD.workflow_attempt AND OLD.quota_state='released' AND NEW.quota_state='reserved'))
BEGIN SELECT RAISE(ABORT,'LEGACY_AI_OPERATION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER legacy_ai_operation_retained BEFORE DELETE ON legacy_ai_operations
BEGIN SELECT RAISE(ABORT,'LEGACY_AI_OPERATION_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER legacy_ai_attempt_immutable BEFORE UPDATE ON legacy_ai_attempts
WHEN NEW.id IS NOT OLD.id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.invocation_id IS NOT OLD.invocation_id
 OR NEW.workflow_attempt IS NOT OLD.workflow_attempt OR NEW.phase IS NOT OLD.phase OR NEW.ordinal IS NOT OLD.ordinal
 OR NEW.correction IS NOT OLD.correction OR NEW.model IS NOT OLD.model OR NEW.wire_hash IS NOT OLD.wire_hash
 OR NEW.input_bytes IS NOT OLD.input_bytes OR NEW.output_cap IS NOT OLD.output_cap OR NEW.evidence_hash IS NOT OLD.evidence_hash
 OR NEW.bounds_json IS NOT OLD.bounds_json OR NEW.deadline_at IS NOT OLD.deadline_at OR NEW.created_at IS NOT OLD.created_at
 OR (OLD.state='final') OR (OLD.state='unknown' AND NEW.state!='final')
 OR (OLD.state='dispatched' AND NEW.state NOT IN ('unknown','final'))
 OR (OLD.state='prepared' AND NEW.state NOT IN ('dispatched','final'))
 OR (OLD.dispatch_token IS NOT NULL AND (NEW.dispatch_token IS NOT OLD.dispatch_token OR NEW.dispatched_at IS NOT OLD.dispatched_at))
BEGIN SELECT RAISE(ABORT,'LEGACY_AI_ATTEMPT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER legacy_ai_attempt_retained BEFORE DELETE ON legacy_ai_attempts
BEGIN SELECT RAISE(ABORT,'LEGACY_AI_ATTEMPT_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER legacy_ai_observation_immutable BEFORE UPDATE ON legacy_ai_observations
BEGIN SELECT RAISE(ABORT,'LEGACY_AI_OBSERVATION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER legacy_ai_observation_retained BEFORE DELETE ON legacy_ai_observations
BEGIN SELECT RAISE(ABORT,'LEGACY_AI_OBSERVATION_RETAINED'); END;

--> statement-breakpoint
UPDATE app_metadata SET value='0017_legacy_analysis_journal',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
