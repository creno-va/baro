-- Preserve all evidence rows and restore dependent immutable/capacity triggers in the same D1 import.
-- Only numeric representation changes; no funding value or recorded cost is rewritten.
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
DROP TRIGGER v2_physical_binding_insert;
--> statement-breakpoint
DROP TRIGGER v2_runtime_plans_delete_immutable;
--> statement-breakpoint
DROP TRIGGER v2_runtime_plans_update_immutable;
--> statement-breakpoint
DROP TRIGGER v2_storage_activation_projection;
--> statement-breakpoint
DROP TRIGGER v2_storage_projection_immutable;
--> statement-breakpoint
DROP TRIGGER v2_storage_projection_no_delete;
--> statement-breakpoint
CREATE TABLE `__new_v2_runtime_plans` (
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
	CONSTRAINT "v2_runtime_plan_bounds" CHECK(typeof("__new_v2_runtime_plans"."operation_revision")='integer' AND "__new_v2_runtime_plans"."operation_revision" BETWEEN 1 AND 9007199254740991 AND typeof("__new_v2_runtime_plans"."target_revision")='integer' AND "__new_v2_runtime_plans"."target_revision" BETWEEN 1 AND 9007199254740991 AND typeof("__new_v2_runtime_plans"."maximum_attempts")='integer' AND "__new_v2_runtime_plans"."maximum_attempts" BETWEEN 1 AND 10 AND typeof("__new_v2_runtime_plans"."reserved_krw")='integer' AND "__new_v2_runtime_plans"."reserved_krw" BETWEEN 0 AND 9007199254740991 AND length("__new_v2_runtime_plans"."request_hash")=64 AND length("__new_v2_runtime_plans"."digest")=64 AND "__new_v2_runtime_plans"."deadline_at">"__new_v2_runtime_plans"."created_at" AND "__new_v2_runtime_plans"."target_kind" IN ('workspace','file','report','profile_asset') AND length(CAST("__new_v2_runtime_plans"."payload_json" AS BLOB))<=65536)
);
--> statement-breakpoint
INSERT INTO `__new_v2_runtime_plans`("id", "operation_id", "operation_revision", "request_hash", "invocation_id", "pricing_proof_id", "funding_proof_id", "job_id", "target_kind", "target_id", "target_revision", "digest", "payload_json", "evidence_hash", "verified_at", "maximum_attempts", "reserved_krw", "deadline_at", "created_at") SELECT "id", "operation_id", "operation_revision", "request_hash", "invocation_id", "pricing_proof_id", "funding_proof_id", "job_id", "target_kind", "target_id", "target_revision", "digest", "payload_json", "evidence_hash", "verified_at", "maximum_attempts", "reserved_krw", "deadline_at", "created_at" FROM `v2_runtime_plans`;
--> statement-breakpoint
DROP TABLE `v2_runtime_plans`;
--> statement-breakpoint
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
	CONSTRAINT "v2_runtime_plan_bounds" CHECK(typeof("v2_runtime_plans"."operation_revision")='integer' AND "v2_runtime_plans"."operation_revision" BETWEEN 1 AND 9007199254740991 AND typeof("v2_runtime_plans"."target_revision")='integer' AND "v2_runtime_plans"."target_revision" BETWEEN 1 AND 9007199254740991 AND typeof("v2_runtime_plans"."maximum_attempts")='integer' AND "v2_runtime_plans"."maximum_attempts" BETWEEN 1 AND 10 AND typeof("v2_runtime_plans"."reserved_krw")='integer' AND "v2_runtime_plans"."reserved_krw" BETWEEN 0 AND 9007199254740991 AND length("v2_runtime_plans"."request_hash")=64 AND length("v2_runtime_plans"."digest")=64 AND "v2_runtime_plans"."deadline_at">"v2_runtime_plans"."created_at" AND "v2_runtime_plans"."target_kind" IN ('workspace','file','report','profile_asset') AND length(CAST("v2_runtime_plans"."payload_json" AS BLOB))<=65536)
);
--> statement-breakpoint
INSERT INTO `v2_runtime_plans`("id", "operation_id", "operation_revision", "request_hash", "invocation_id", "pricing_proof_id", "funding_proof_id", "job_id", "target_kind", "target_id", "target_revision", "digest", "payload_json", "evidence_hash", "verified_at", "maximum_attempts", "reserved_krw", "deadline_at", "created_at") SELECT "id", "operation_id", "operation_revision", "request_hash", "invocation_id", "pricing_proof_id", "funding_proof_id", "job_id", "target_kind", "target_id", "target_revision", "digest", "payload_json", "evidence_hash", "verified_at", "maximum_attempts", "reserved_krw", "deadline_at", "created_at" FROM `__new_v2_runtime_plans`;
--> statement-breakpoint
DROP TABLE `__new_v2_runtime_plans`;
--> statement-breakpoint
CREATE TABLE `__new_v2_storage_projections` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`environment` text NOT NULL,
	`capacity_bytes` integer NOT NULL,
	`payload_json` text NOT NULL,
	`digest` text NOT NULL,
	`pricing_proof_id` text NOT NULL,
	`funding_proof_id` text NOT NULL,
	`allocation_proof_id` text NOT NULL,
	`maintenance_id` text NOT NULL,
	`reserved_krw` integer NOT NULL,
	`get_limit` integer NOT NULL,
	`head_limit` integer NOT NULL,
	`delete_limit` integer NOT NULL,
	`gets` integer DEFAULT 0 NOT NULL,
	`heads` integer DEFAULT 0 NOT NULL,
	`deletes` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`valid_until` text NOT NULL,
	CONSTRAINT "v2_storage_projection_bounds" CHECK("__new_v2_storage_projections"."environment" IN ('preview','production') AND typeof("__new_v2_storage_projections"."capacity_bytes")='integer' AND "__new_v2_storage_projections"."capacity_bytes" BETWEEN 1 AND 100000000000 AND typeof("__new_v2_storage_projections"."reserved_krw")='integer' AND "__new_v2_storage_projections"."reserved_krw" BETWEEN 1 AND 9007199254740991 AND length("__new_v2_storage_projections"."digest")=64 AND length(CAST("__new_v2_storage_projections"."payload_json" AS BLOB))<=262144 AND "__new_v2_storage_projections"."valid_until">"__new_v2_storage_projections"."created_at"),
	CONSTRAINT "v2_storage_projection_counters" CHECK(typeof("__new_v2_storage_projections"."get_limit")='integer' AND "__new_v2_storage_projections"."get_limit" BETWEEN 0 AND 1000000 AND typeof("__new_v2_storage_projections"."head_limit")='integer' AND "__new_v2_storage_projections"."head_limit" BETWEEN 0 AND 1000000 AND typeof("__new_v2_storage_projections"."delete_limit")='integer' AND "__new_v2_storage_projections"."delete_limit" BETWEEN 0 AND 1000000 AND typeof("__new_v2_storage_projections"."gets")='integer' AND "__new_v2_storage_projections"."gets" BETWEEN 0 AND "__new_v2_storage_projections"."get_limit" AND typeof("__new_v2_storage_projections"."heads")='integer' AND "__new_v2_storage_projections"."heads" BETWEEN 0 AND "__new_v2_storage_projections"."head_limit" AND typeof("__new_v2_storage_projections"."deletes")='integer' AND "__new_v2_storage_projections"."deletes" BETWEEN 0 AND "__new_v2_storage_projections"."delete_limit")
);
--> statement-breakpoint
INSERT INTO `__new_v2_storage_projections`("id", "month", "environment", "capacity_bytes", "payload_json", "digest", "pricing_proof_id", "funding_proof_id", "allocation_proof_id", "maintenance_id", "reserved_krw", "get_limit", "head_limit", "delete_limit", "gets", "heads", "deletes", "created_at", "valid_until") SELECT "id", "month", "environment", "capacity_bytes", "payload_json", "digest", "pricing_proof_id", "funding_proof_id", "allocation_proof_id", "maintenance_id", "reserved_krw", "get_limit", "head_limit", "delete_limit", "gets", "heads", "deletes", "created_at", "valid_until" FROM `v2_storage_projections`;
--> statement-breakpoint
DROP TABLE `v2_storage_projections`;
--> statement-breakpoint
CREATE TABLE `v2_storage_projections` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`environment` text NOT NULL,
	`capacity_bytes` integer NOT NULL,
	`payload_json` text NOT NULL,
	`digest` text NOT NULL,
	`pricing_proof_id` text NOT NULL,
	`funding_proof_id` text NOT NULL,
	`allocation_proof_id` text NOT NULL,
	`maintenance_id` text NOT NULL,
	`reserved_krw` integer NOT NULL,
	`get_limit` integer NOT NULL,
	`head_limit` integer NOT NULL,
	`delete_limit` integer NOT NULL,
	`gets` integer DEFAULT 0 NOT NULL,
	`heads` integer DEFAULT 0 NOT NULL,
	`deletes` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`valid_until` text NOT NULL,
	CONSTRAINT "v2_storage_projection_bounds" CHECK("v2_storage_projections"."environment" IN ('preview','production') AND typeof("v2_storage_projections"."capacity_bytes")='integer' AND "v2_storage_projections"."capacity_bytes" BETWEEN 1 AND 100000000000 AND typeof("v2_storage_projections"."reserved_krw")='integer' AND "v2_storage_projections"."reserved_krw" BETWEEN 1 AND 9007199254740991 AND length("v2_storage_projections"."digest")=64 AND length(CAST("v2_storage_projections"."payload_json" AS BLOB))<=262144 AND "v2_storage_projections"."valid_until">"v2_storage_projections"."created_at"),
	CONSTRAINT "v2_storage_projection_counters" CHECK(typeof("v2_storage_projections"."get_limit")='integer' AND "v2_storage_projections"."get_limit" BETWEEN 0 AND 1000000 AND typeof("v2_storage_projections"."head_limit")='integer' AND "v2_storage_projections"."head_limit" BETWEEN 0 AND 1000000 AND typeof("v2_storage_projections"."delete_limit")='integer' AND "v2_storage_projections"."delete_limit" BETWEEN 0 AND 1000000 AND typeof("v2_storage_projections"."gets")='integer' AND "v2_storage_projections"."gets" BETWEEN 0 AND "v2_storage_projections"."get_limit" AND typeof("v2_storage_projections"."heads")='integer' AND "v2_storage_projections"."heads" BETWEEN 0 AND "v2_storage_projections"."head_limit" AND typeof("v2_storage_projections"."deletes")='integer' AND "v2_storage_projections"."deletes" BETWEEN 0 AND "v2_storage_projections"."delete_limit")
);
--> statement-breakpoint
INSERT INTO `v2_storage_projections`("id", "month", "environment", "capacity_bytes", "payload_json", "digest", "pricing_proof_id", "funding_proof_id", "allocation_proof_id", "maintenance_id", "reserved_krw", "get_limit", "head_limit", "delete_limit", "gets", "heads", "deletes", "created_at", "valid_until") SELECT "id", "month", "environment", "capacity_bytes", "payload_json", "digest", "pricing_proof_id", "funding_proof_id", "allocation_proof_id", "maintenance_id", "reserved_krw", "get_limit", "head_limit", "delete_limit", "gets", "heads", "deletes", "created_at", "valid_until" FROM `__new_v2_storage_projections`;
--> statement-breakpoint
DROP TABLE `__new_v2_storage_projections`;
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_storage_projection_month` ON `v2_storage_projections` (`environment`,`month`);
--> statement-breakpoint
CREATE TRIGGER v2_physical_binding_insert BEFORE INSERT ON v2_physical_blob_bindings BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v2_physical_storage_capacity c WHERE c.environment=NEW.environment AND c.held_bytes+CASE WHEN EXISTS(SELECT 1 FROM v2_physical_blob_bindings old WHERE old.blob_id=NEW.blob_id AND old.environment=NEW.environment AND old.owner_id=NEW.owner_id AND old.object_key=NEW.object_key AND old.maximum_cipher_bytes=NEW.maximum_cipher_bytes AND old.state='held') THEN 0 ELSE NEW.maximum_cipher_bytes END<=c.capacity_bytes) THEN RAISE(ABORT,'PHYSICAL_CAPACITY_UNAVAILABLE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM v2_physical_blob_bindings old WHERE old.blob_id=NEW.blob_id AND (old.environment!=NEW.environment OR old.owner_id!=NEW.owner_id OR old.object_key!=NEW.object_key OR old.maximum_cipher_bytes!=NEW.maximum_cipher_bytes OR old.state!='held')) THEN RAISE(ABORT,'PHYSICAL_BINDING_IMMUTABLE') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v2_blobs b JOIN v2_billing_principals principal ON principal.id=b.principal_id WHERE b.id=NEW.blob_id AND principal.owner_id=NEW.owner_id AND b.object_key=NEW.object_key AND b.cipher_bytes<=NEW.maximum_cipher_bytes AND ((NEW.inventory_hash IS NULL AND b.state='pending') OR (NEW.inventory_hash IS NOT NULL AND b.state IN ('pending','stored','deleting')))) THEN RAISE(ABORT,'PHYSICAL_PENDING_BINDING_REQUIRED') END;
 SELECT CASE WHEN NEW.inventory_hash IS NULL AND NOT EXISTS(SELECT 1 FROM v2_storage_projections p JOIN v2_runtime_controls c ON c.month=p.month AND c.environment=p.environment WHERE p.environment=NEW.environment AND p.month=substr(datetime(NEW.created_at,'+9 hours'),1,7) AND p.valid_until>NEW.created_at AND c.phase='active') THEN RAISE(ABORT,'STORAGE_PROJECTION_REQUIRED') END;
END;
--> statement-breakpoint
CREATE TRIGGER v2_runtime_plans_delete_immutable BEFORE DELETE ON v2_runtime_plans BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RUNTIME_EVIDENCE'); END;
--> statement-breakpoint
CREATE TRIGGER v2_runtime_plans_update_immutable BEFORE UPDATE ON v2_runtime_plans BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RUNTIME_EVIDENCE'); END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_activation_projection BEFORE UPDATE OF phase ON v2_runtime_controls WHEN NEW.phase='active' AND EXISTS(SELECT 1 FROM v2_physical_storage_capacity WHERE environment=NEW.environment) BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v2_storage_projections p JOIN v2_physical_storage_capacity c ON c.environment=p.environment JOIN v2_maintenance_exposure m ON m.id=p.maintenance_id JOIN v2_monthly_budget b ON b.month=p.month AND b.environment=p.environment WHERE p.environment=NEW.environment AND p.month=NEW.month AND p.capacity_bytes=c.capacity_bytes AND p.valid_until>NEW.updated_at AND p.allocation_proof_id=NEW.allocation_proof_id AND m.state IN ('reserved','ambiguous') AND m.amount_krw=p.reserved_krw AND b.fixed_maintenance_krw>=p.reserved_krw) OR EXISTS(SELECT 1 FROM v2_blobs b LEFT JOIN v2_physical_blob_bindings binding ON binding.blob_id=b.id WHERE b.state!='deleted' AND (binding.blob_id IS NULL OR binding.state!='held' OR binding.environment!=NEW.environment OR binding.object_key!=b.object_key OR b.cipher_bytes>binding.maximum_cipher_bytes)) THEN RAISE(ABORT,'STORAGE_PROJECTION_REQUIRED') END;
END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_projection_immutable BEFORE UPDATE ON v2_storage_projections WHEN NOT (
 (NEW.id IS OLD.id AND NEW.month IS OLD.month AND NEW.environment IS OLD.environment AND NEW.capacity_bytes IS OLD.capacity_bytes AND NEW.payload_json IS OLD.payload_json AND NEW.digest IS OLD.digest AND NEW.pricing_proof_id IS OLD.pricing_proof_id AND NEW.funding_proof_id IS OLD.funding_proof_id AND NEW.allocation_proof_id IS OLD.allocation_proof_id AND NEW.maintenance_id IS OLD.maintenance_id AND NEW.reserved_krw IS OLD.reserved_krw AND NEW.get_limit IS OLD.get_limit AND NEW.head_limit IS OLD.head_limit AND NEW.delete_limit IS OLD.delete_limit AND NEW.created_at IS OLD.created_at AND NEW.valid_until IS OLD.valid_until AND NEW.gets>=OLD.gets AND NEW.heads>=OLD.heads AND NEW.deletes>=OLD.deletes AND NEW.gets-OLD.gets+NEW.heads-OLD.heads+NEW.deletes-OLD.deletes=1)
 OR
 (NEW.id IS OLD.id AND NEW.month IS OLD.month AND NEW.environment IS OLD.environment AND NEW.capacity_bytes IS OLD.capacity_bytes AND NEW.allocation_proof_id IS OLD.allocation_proof_id AND NEW.get_limit IS OLD.get_limit AND NEW.head_limit IS OLD.head_limit AND NEW.delete_limit IS OLD.delete_limit AND NEW.gets IS OLD.gets AND NEW.heads IS OLD.heads AND NEW.deletes IS OLD.deletes AND EXISTS(
   SELECT 1 FROM v2_runtime_refreshes renewal JOIN v2_runtime_controls control ON control.environment=renewal.environment AND control.month=renewal.month
   JOIN v2_monthly_budget budget ON budget.month=renewal.month AND budget.environment=renewal.environment AND budget.allocation_version=renewal.allocation_version
   WHERE renewal.id=NEW.maintenance_id AND renewal.environment=OLD.environment AND renewal.month=OLD.month AND renewal.allocation_proof_id=OLD.allocation_proof_id
   AND control.revision+1=renewal.control_revision AND control.allocation_proof_id=renewal.allocation_proof_id
   AND renewal.pricing_proof_id=NEW.pricing_proof_id AND renewal.funding_proof_id=NEW.funding_proof_id
   AND renewal.created_at=NEW.created_at AND renewal.valid_until=NEW.valid_until
   AND json_extract(renewal.payload_json,'$.priorProjection')=OLD.payload_json
   AND json_extract(renewal.payload_json,'$.projection')=NEW.payload_json
   AND json_extract(renewal.payload_json,'$.projectionDigest')=NEW.digest
   AND json_extract(renewal.payload_json,'$.maintenanceKrw')=NEW.reserved_krw
  ))
) BEGIN SELECT RAISE(ABORT,'STORAGE_PROJECTION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_projection_no_delete BEFORE DELETE ON v2_storage_projections BEGIN SELECT RAISE(ABORT,'STORAGE_PROJECTION_IMMUTABLE'); END;
--> statement-breakpoint
INSERT INTO app_metadata(key,value) VALUES ('schema_version','0014_cost_observation_bounds') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
