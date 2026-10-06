CREATE TABLE `v2_physical_blob_bindings` (
	`blob_id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`owner_id` text NOT NULL,
	`object_key` text NOT NULL,
	`maximum_cipher_bytes` integer NOT NULL,
	`state` text DEFAULT 'held' NOT NULL,
	`writer_state` text DEFAULT 'prepared' NOT NULL,
	`writer_token` text,
	`expected_cipher_bytes` integer,
	`inventory_hash` text,
	`created_at` text NOT NULL,
	`released_receipt_id` text,
	CONSTRAINT "v2_physical_binding_bounds" CHECK("v2_physical_blob_bindings"."environment" IN ('preview','production') AND typeof("v2_physical_blob_bindings"."maximum_cipher_bytes")='integer' AND "v2_physical_blob_bindings"."maximum_cipher_bytes" BETWEEN 1 AND 100000000000 AND "v2_physical_blob_bindings"."state" IN ('held','released') AND (("v2_physical_blob_bindings"."state"='held' AND "v2_physical_blob_bindings"."released_receipt_id" IS NULL) OR ("v2_physical_blob_bindings"."state"='released' AND "v2_physical_blob_bindings"."released_receipt_id" IS NOT NULL AND "v2_physical_blob_bindings"."writer_state"='stopped')) AND ("v2_physical_blob_bindings"."inventory_hash" IS NULL OR length("v2_physical_blob_bindings"."inventory_hash")=64) AND "v2_physical_blob_bindings"."writer_state" IN ('prepared','running','stopped') AND (("v2_physical_blob_bindings"."writer_state"='prepared' AND "v2_physical_blob_bindings"."writer_token" IS NULL AND "v2_physical_blob_bindings"."expected_cipher_bytes" IS NULL) OR ("v2_physical_blob_bindings"."writer_state"='running' AND "v2_physical_blob_bindings"."writer_token" IS NOT NULL AND typeof("v2_physical_blob_bindings"."expected_cipher_bytes")='integer' AND "v2_physical_blob_bindings"."expected_cipher_bytes" BETWEEN 1 AND "v2_physical_blob_bindings"."maximum_cipher_bytes") OR "v2_physical_blob_bindings"."writer_state"='stopped'))
);
--> statement-breakpoint
CREATE TABLE `v2_physical_storage_capacity` (
	`environment` text PRIMARY KEY NOT NULL,
	`capacity_bytes` integer NOT NULL,
	`held_bytes` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "v2_physical_capacity_bounds" CHECK("v2_physical_storage_capacity"."environment" IN ('preview','production') AND typeof("v2_physical_storage_capacity"."capacity_bytes")='integer' AND "v2_physical_storage_capacity"."capacity_bytes" BETWEEN 1 AND 100000000000 AND typeof("v2_physical_storage_capacity"."held_bytes")='integer' AND "v2_physical_storage_capacity"."held_bytes" BETWEEN 0 AND "v2_physical_storage_capacity"."capacity_bytes" AND typeof("v2_physical_storage_capacity"."revision")='integer' AND "v2_physical_storage_capacity"."revision">0)
);
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
	CONSTRAINT "v2_storage_projection_bounds" CHECK("v2_storage_projections"."environment" IN ('preview','production') AND typeof("v2_storage_projections"."capacity_bytes")='integer' AND "v2_storage_projections"."capacity_bytes" BETWEEN 1 AND 100000000000 AND typeof("v2_storage_projections"."reserved_krw")='integer' AND "v2_storage_projections"."reserved_krw" BETWEEN 1 AND 1000000 AND length("v2_storage_projections"."digest")=64 AND length(CAST("v2_storage_projections"."payload_json" AS BLOB))<=262144 AND "v2_storage_projections"."valid_until">"v2_storage_projections"."created_at"),
	CONSTRAINT "v2_storage_projection_counters" CHECK(typeof("v2_storage_projections"."get_limit")='integer' AND "v2_storage_projections"."get_limit" BETWEEN 0 AND 1000000 AND typeof("v2_storage_projections"."head_limit")='integer' AND "v2_storage_projections"."head_limit" BETWEEN 0 AND 1000000 AND typeof("v2_storage_projections"."delete_limit")='integer' AND "v2_storage_projections"."delete_limit" BETWEEN 0 AND 1000000 AND typeof("v2_storage_projections"."gets")='integer' AND "v2_storage_projections"."gets" BETWEEN 0 AND "v2_storage_projections"."get_limit" AND typeof("v2_storage_projections"."heads")='integer' AND "v2_storage_projections"."heads" BETWEEN 0 AND "v2_storage_projections"."head_limit" AND typeof("v2_storage_projections"."deletes")='integer' AND "v2_storage_projections"."deletes" BETWEEN 0 AND "v2_storage_projections"."delete_limit")
);
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
CREATE TRIGGER v2_physical_binding_count AFTER INSERT ON v2_physical_blob_bindings BEGIN
 UPDATE v2_physical_storage_capacity SET held_bytes=held_bytes+NEW.maximum_cipher_bytes,revision=revision+1 WHERE environment=NEW.environment;
END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_binding_immutable BEFORE UPDATE ON v2_physical_blob_bindings BEGIN
 SELECT CASE WHEN NEW.blob_id IS NOT OLD.blob_id OR NEW.environment IS NOT OLD.environment OR NEW.owner_id IS NOT OLD.owner_id OR NEW.object_key IS NOT OLD.object_key OR NEW.maximum_cipher_bytes IS NOT OLD.maximum_cipher_bytes OR NEW.inventory_hash IS NOT OLD.inventory_hash OR NEW.created_at IS NOT OLD.created_at OR OLD.state!='held' THEN RAISE(ABORT,'PHYSICAL_BINDING_IMMUTABLE') END;
 SELECT CASE WHEN NOT (
 (OLD.writer_state='prepared' AND NEW.writer_state='running' AND NEW.state='held' AND NEW.released_receipt_id IS NULL AND NEW.writer_token IS NOT NULL AND NEW.expected_cipher_bytes BETWEEN 1 AND NEW.maximum_cipher_bytes)
 OR (OLD.writer_state='running' AND NEW.writer_state='stopped' AND NEW.state='held' AND NEW.released_receipt_id IS NULL AND NEW.writer_token IS OLD.writer_token AND NEW.expected_cipher_bytes IS OLD.expected_cipher_bytes)
 OR (OLD.writer_state IN ('prepared','stopped') AND NEW.writer_state='stopped' AND NEW.state='released' AND NEW.released_receipt_id IS NOT NULL AND NEW.writer_token IS OLD.writer_token AND NEW.expected_cipher_bytes IS OLD.expected_cipher_bytes)
 ) THEN RAISE(ABORT,'PHYSICAL_WRITER_TRANSITION_INVALID') END;
 SELECT CASE WHEN NEW.state='released' AND NOT EXISTS(SELECT 1 FROM v2_blobs b JOIN v2_cleanup_receipts receipt ON receipt.target_id=b.id AND receipt.kind='blob' WHERE b.id=NEW.blob_id AND b.state='deleted' AND b.object_key=NEW.object_key AND receipt.id=NEW.released_receipt_id AND receipt.confirmed_at=b.deleted_at) THEN RAISE(ABORT,'PHYSICAL_DELETE_RECEIPT_REQUIRED') END;
END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_binding_release AFTER UPDATE ON v2_physical_blob_bindings WHEN OLD.state='held' AND NEW.state='released' BEGIN
 UPDATE v2_physical_storage_capacity SET held_bytes=held_bytes-OLD.maximum_cipher_bytes,revision=revision+1 WHERE environment=OLD.environment;
END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_binding_no_delete BEFORE DELETE ON v2_physical_blob_bindings BEGIN SELECT RAISE(ABORT,'PHYSICAL_BINDING_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_capacity_consistent BEFORE UPDATE ON v2_physical_storage_capacity WHEN NEW.environment IS NOT OLD.environment OR NEW.held_bytes!=coalesce((SELECT sum(maximum_cipher_bytes) FROM v2_physical_blob_bindings WHERE environment=OLD.environment AND state='held'),0) BEGIN SELECT RAISE(ABORT,'PHYSICAL_CAPACITY_LEDGER_MISMATCH'); END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_capacity_no_delete BEFORE DELETE ON v2_physical_storage_capacity BEGIN SELECT RAISE(ABORT,'PHYSICAL_CAPACITY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_blob_bounds BEFORE UPDATE ON v2_blobs WHEN EXISTS(SELECT 1 FROM v2_physical_blob_bindings binding WHERE binding.blob_id=OLD.id AND (NEW.object_key!=binding.object_key OR NEW.cipher_bytes>binding.maximum_cipher_bytes OR (binding.state='released' AND NEW.state!='deleted'))) BEGIN SELECT RAISE(ABORT,'PHYSICAL_BLOB_CAPACITY_BOUND'); END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_blob_deleted AFTER UPDATE OF state ON v2_blobs WHEN NEW.state='deleted' AND OLD.state!='deleted' BEGIN
 UPDATE v2_physical_blob_bindings SET state='released',writer_state='stopped',released_receipt_id=(SELECT id FROM v2_cleanup_receipts WHERE kind='blob' AND target_id=NEW.id AND confirmed_at=NEW.deleted_at ORDER BY id LIMIT 1) WHERE blob_id=NEW.id AND state='held' AND writer_state IN ('prepared','stopped');
END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_activation_projection BEFORE UPDATE OF phase ON v2_runtime_controls WHEN NEW.phase='active' AND EXISTS(SELECT 1 FROM v2_physical_storage_capacity WHERE environment=NEW.environment) BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v2_storage_projections p JOIN v2_physical_storage_capacity c ON c.environment=p.environment JOIN v2_maintenance_exposure m ON m.id=p.maintenance_id JOIN v2_monthly_budget b ON b.month=p.month AND b.environment=p.environment WHERE p.environment=NEW.environment AND p.month=NEW.month AND p.capacity_bytes=c.capacity_bytes AND p.valid_until>NEW.updated_at AND p.allocation_proof_id=NEW.allocation_proof_id AND m.state IN ('reserved','ambiguous') AND m.amount_krw=p.reserved_krw AND b.fixed_maintenance_krw>=p.reserved_krw) OR EXISTS(SELECT 1 FROM v2_blobs b LEFT JOIN v2_physical_blob_bindings binding ON binding.blob_id=b.id WHERE b.state!='deleted' AND (binding.blob_id IS NULL OR binding.state!='held' OR binding.environment!=NEW.environment OR binding.object_key!=b.object_key OR b.cipher_bytes>binding.maximum_cipher_bytes)) THEN RAISE(ABORT,'STORAGE_PROJECTION_REQUIRED') END;
END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_projection_immutable BEFORE UPDATE ON v2_storage_projections WHEN NEW.id IS NOT OLD.id OR NEW.month IS NOT OLD.month OR NEW.environment IS NOT OLD.environment OR NEW.capacity_bytes IS NOT OLD.capacity_bytes OR NEW.payload_json IS NOT OLD.payload_json OR NEW.digest IS NOT OLD.digest OR NEW.pricing_proof_id IS NOT OLD.pricing_proof_id OR NEW.funding_proof_id IS NOT OLD.funding_proof_id OR NEW.allocation_proof_id IS NOT OLD.allocation_proof_id OR NEW.maintenance_id IS NOT OLD.maintenance_id OR NEW.reserved_krw IS NOT OLD.reserved_krw OR NEW.get_limit IS NOT OLD.get_limit OR NEW.head_limit IS NOT OLD.head_limit OR NEW.delete_limit IS NOT OLD.delete_limit OR NEW.created_at IS NOT OLD.created_at OR NEW.valid_until IS NOT OLD.valid_until OR NEW.gets<OLD.gets OR NEW.heads<OLD.heads OR NEW.deletes<OLD.deletes OR NEW.gets-OLD.gets+NEW.heads-OLD.heads+NEW.deletes-OLD.deletes!=1 BEGIN SELECT RAISE(ABORT,'STORAGE_PROJECTION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_projection_no_delete BEFORE DELETE ON v2_storage_projections BEGIN SELECT RAISE(ABORT,'STORAGE_PROJECTION_IMMUTABLE'); END;
--> statement-breakpoint
UPDATE app_metadata SET value='0009_storage_capacity_maintenance',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
