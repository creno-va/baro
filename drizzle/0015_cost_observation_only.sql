CREATE TABLE `v2_cost_execution_policy` (
	`environment` text PRIMARY KEY NOT NULL,
	`limits_enabled` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "v2_cost_execution_policy_bounds" CHECK("v2_cost_execution_policy"."environment" IN ('preview','production') AND "v2_cost_execution_policy"."limits_enabled" IN (0,1))
);
--> statement-breakpoint
CREATE TABLE `v2_storage_io_counters` (
	`environment` text NOT NULL,
	`month` text NOT NULL,
	`gets` integer DEFAULT 0 NOT NULL,
	`heads` integer DEFAULT 0 NOT NULL,
	`deletes` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`environment`, `month`),
	CONSTRAINT "v2_storage_io_counter_bounds" CHECK("v2_storage_io_counters"."environment" IN ('preview','production') AND typeof("v2_storage_io_counters"."gets")='integer' AND "v2_storage_io_counters"."gets">=0 AND typeof("v2_storage_io_counters"."heads")='integer' AND "v2_storage_io_counters"."heads">=0 AND typeof("v2_storage_io_counters"."deletes")='integer' AND "v2_storage_io_counters"."deletes">=0)
);

--> statement-breakpoint
DROP TRIGGER v2_physical_binding_insert;
--> statement-breakpoint
CREATE TRIGGER v2_physical_binding_insert BEFORE INSERT ON v2_physical_blob_bindings BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v2_physical_storage_capacity c WHERE c.environment=NEW.environment AND c.held_bytes+CASE WHEN EXISTS(SELECT 1 FROM v2_physical_blob_bindings old WHERE old.blob_id=NEW.blob_id AND old.environment=NEW.environment AND old.owner_id=NEW.owner_id AND old.object_key=NEW.object_key AND old.maximum_cipher_bytes=NEW.maximum_cipher_bytes AND old.state='held') THEN 0 ELSE NEW.maximum_cipher_bytes END<=c.capacity_bytes) THEN RAISE(ABORT,'PHYSICAL_CAPACITY_UNAVAILABLE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM v2_physical_blob_bindings old WHERE old.blob_id=NEW.blob_id AND (old.environment!=NEW.environment OR old.owner_id!=NEW.owner_id OR old.object_key!=NEW.object_key OR old.maximum_cipher_bytes!=NEW.maximum_cipher_bytes OR old.state!='held')) THEN RAISE(ABORT,'PHYSICAL_BINDING_IMMUTABLE') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v2_blobs b JOIN v2_billing_principals principal ON principal.id=b.principal_id WHERE b.id=NEW.blob_id AND principal.owner_id=NEW.owner_id AND b.object_key=NEW.object_key AND b.cipher_bytes<=NEW.maximum_cipher_bytes AND ((NEW.inventory_hash IS NULL AND b.state='pending') OR (NEW.inventory_hash IS NOT NULL AND b.state IN ('pending','stored','deleting')))) THEN RAISE(ABORT,'PHYSICAL_PENDING_BINDING_REQUIRED') END;
 SELECT CASE WHEN NEW.inventory_hash IS NULL AND NOT EXISTS(SELECT 1 FROM v2_cost_execution_policy WHERE environment=NEW.environment AND limits_enabled=0) AND NOT EXISTS(SELECT 1 FROM v2_storage_projections p JOIN v2_runtime_controls c ON c.month=p.month AND c.environment=p.environment WHERE p.environment=NEW.environment AND p.month=substr(datetime(NEW.created_at,'+9 hours'),1,7) AND p.valid_until>NEW.created_at AND c.phase='active') THEN RAISE(ABORT,'STORAGE_PROJECTION_REQUIRED') END;
END;
--> statement-breakpoint
DROP TRIGGER v2_storage_activation_projection;
--> statement-breakpoint
CREATE TRIGGER v2_storage_activation_projection BEFORE UPDATE OF phase ON v2_runtime_controls WHEN NEW.phase='active' AND EXISTS(SELECT 1 FROM v2_physical_storage_capacity WHERE environment=NEW.environment) BEGIN
 SELECT CASE WHEN (NOT EXISTS(SELECT 1 FROM v2_cost_execution_policy WHERE environment=NEW.environment AND limits_enabled=0) AND NOT EXISTS(SELECT 1 FROM v2_storage_projections p JOIN v2_physical_storage_capacity c ON c.environment=p.environment JOIN v2_maintenance_exposure m ON m.id=p.maintenance_id JOIN v2_monthly_budget b ON b.month=p.month AND b.environment=p.environment WHERE p.environment=NEW.environment AND p.month=NEW.month AND p.capacity_bytes=c.capacity_bytes AND p.valid_until>NEW.updated_at AND p.allocation_proof_id=NEW.allocation_proof_id AND m.state IN ('reserved','ambiguous') AND m.amount_krw=p.reserved_krw AND b.fixed_maintenance_krw>=p.reserved_krw)) OR EXISTS(SELECT 1 FROM v2_blobs b LEFT JOIN v2_physical_blob_bindings binding ON binding.blob_id=b.id WHERE b.state!='deleted' AND (binding.blob_id IS NULL OR binding.state!='held' OR binding.environment!=NEW.environment OR binding.object_key!=b.object_key OR b.cipher_bytes>binding.maximum_cipher_bytes)) THEN RAISE(ABORT,'STORAGE_PROJECTION_REQUIRED') END;
END;
--> statement-breakpoint
INSERT INTO app_metadata(key,value) VALUES ('schema_version','0015_cost_observation_only') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
