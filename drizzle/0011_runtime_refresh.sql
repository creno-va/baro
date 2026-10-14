CREATE TABLE `v2_runtime_refreshes` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`environment` text NOT NULL,
	`control_revision` integer NOT NULL,
	`allocation_version` integer NOT NULL,
	`allocation_proof_id` text NOT NULL,
	`pricing_proof_id` text NOT NULL,
	`funding_proof_id` text NOT NULL,
	`request_digest` text NOT NULL,
	`payload_json` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`valid_until` text NOT NULL,
	CONSTRAINT "v2_runtime_refresh_bounds" CHECK("v2_runtime_refreshes"."environment" IN ('preview','production') AND "v2_runtime_refreshes"."control_revision">0 AND "v2_runtime_refreshes"."allocation_version">0 AND length("v2_runtime_refreshes"."request_digest")=64 AND length("v2_runtime_refreshes"."evidence_hash")=64 AND length(CAST("v2_runtime_refreshes"."payload_json" AS BLOB))<=1048576 AND "v2_runtime_refreshes"."valid_until">"v2_runtime_refreshes"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_runtime_refresh_revision` ON `v2_runtime_refreshes` (`environment`,`month`,`control_revision`);--> statement-breakpoint
CREATE TRIGGER v2_runtime_refresh_immutable_update BEFORE UPDATE ON v2_runtime_refreshes BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RUNTIME_REFRESH'); END;
--> statement-breakpoint
CREATE TRIGGER v2_runtime_refresh_immutable_delete BEFORE DELETE ON v2_runtime_refreshes BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RUNTIME_REFRESH'); END;
--> statement-breakpoint
DROP TRIGGER v2_storage_projection_immutable;
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
INSERT INTO app_metadata(key,value,updated_at) VALUES('schema_version','0011_runtime_refresh',CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
