CREATE TABLE `v2_lookup_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`job_id` text NOT NULL,
	`tool` text NOT NULL,
	`request_hash` text NOT NULL,
	`transport` text DEFAULT 'unknown' NOT NULL,
	`dispatched_at` text NOT NULL,
	`observed_at` text,
	CONSTRAINT "v2_lookup_tool" CHECK("v2_lookup_executions"."tool" IN ('hometax_status','thecheat','datahub_property','datahub_building')),
	CONSTRAINT "v2_lookup_transport" CHECK("v2_lookup_executions"."transport" IN ('unknown','response','provider_error','not_sent')),
	CONSTRAINT "v2_lookup_hash" CHECK(length("v2_lookup_executions"."request_hash")=64 AND "v2_lookup_executions"."request_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "v2_lookup_observation" CHECK(("v2_lookup_executions"."transport"='unknown' OR "v2_lookup_executions"."observed_at" IS NOT NULL) AND ("v2_lookup_executions"."observed_at" IS NULL OR "v2_lookup_executions"."observed_at">="v2_lookup_executions"."dispatched_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_lookup_operation_tool_unique` ON `v2_lookup_executions` (`operation_id`,`tool`);
--> statement-breakpoint
CREATE TRIGGER v2_lookup_execution_retained BEFORE DELETE ON v2_lookup_executions
BEGIN SELECT RAISE(ABORT,'LOOKUP_EXECUTION_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER v2_lookup_execution_immutable BEFORE UPDATE ON v2_lookup_executions
WHEN NEW.id IS NOT OLD.id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.job_id IS NOT OLD.job_id
  OR NEW.tool IS NOT OLD.tool OR NEW.request_hash IS NOT OLD.request_hash OR NEW.dispatched_at IS NOT OLD.dispatched_at
  OR OLD.transport!='unknown' OR (OLD.observed_at IS NOT NULL AND (NEW.observed_at IS NULL OR NEW.observed_at<OLD.observed_at))
BEGIN SELECT RAISE(ABORT,'LOOKUP_EXECUTION_IMMUTABLE'); END;
--> statement-breakpoint
UPDATE app_metadata SET value='0018_external_lookup_admission',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
