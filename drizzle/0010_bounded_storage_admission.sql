CREATE TABLE `v2_physical_binding_totals` (
	`blob_id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`held_bytes` integer NOT NULL,
	CONSTRAINT "v2_physical_binding_total_bounds" CHECK("v2_physical_binding_totals"."environment" IN ('preview','production') AND typeof("v2_physical_binding_totals"."held_bytes")='integer' AND "v2_physical_binding_totals"."held_bytes" BETWEEN 0 AND 100000000000)
);
--> statement-breakpoint
CREATE TABLE `v2_physical_storage_totals` (
	`environment` text PRIMARY KEY NOT NULL,
	`held_bytes` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "v2_physical_total_bounds" CHECK("v2_physical_storage_totals"."environment" IN ('preview','production') AND "v2_physical_storage_totals"."version"=1 AND typeof("v2_physical_storage_totals"."held_bytes")='integer' AND "v2_physical_storage_totals"."held_bytes" BETWEEN 0 AND 100000000000)
);
--> statement-breakpoint
CREATE TABLE `v2_physical_total_mutations` (
	`environment` text PRIMARY KEY NOT NULL,
	`blob_id` text NOT NULL,
	`delta` integer NOT NULL,
	CONSTRAINT "v2_physical_delta_bounds" CHECK("v2_physical_total_mutations"."environment" IN ('preview','production') AND typeof("v2_physical_total_mutations"."delta")='integer' AND "v2_physical_total_mutations"."delta"!=0 AND "v2_physical_total_mutations"."delta" BETWEEN -100000000000 AND 100000000000)
);
--> statement-breakpoint
CREATE TABLE `v2_storage_carryover` (
	`id` integer PRIMARY KEY NOT NULL,
	`cursor_month` text NOT NULL,
	`budget_krw` integer NOT NULL,
	`maintenance_krw` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "v2_storage_carryover_bounds" CHECK("v2_storage_carryover"."id"=1 AND "v2_storage_carryover"."version"=1 AND "v2_storage_carryover"."cursor_month" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr("v2_storage_carryover"."cursor_month",6,2) BETWEEN '01' AND '12' AND typeof("v2_storage_carryover"."revision")='integer' AND "v2_storage_carryover"."revision" BETWEEN 1 AND 9007199254740991 AND typeof("v2_storage_carryover"."budget_krw")='integer' AND "v2_storage_carryover"."budget_krw" BETWEEN 0 AND 9007199254740991 AND typeof("v2_storage_carryover"."maintenance_krw")='integer' AND "v2_storage_carryover"."maintenance_krw" BETWEEN 0 AND 9007199254740991 AND "v2_storage_carryover"."budget_krw"+"v2_storage_carryover"."maintenance_krw" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `v2_storage_funding_heads` (
	`environment` text PRIMARY KEY NOT NULL,
	`proof_id` text NOT NULL,
	`verified_at` text NOT NULL,
	CONSTRAINT "v2_storage_funding_environment" CHECK("v2_storage_funding_heads"."environment" IN ('preview','production'))
);
--> statement-breakpoint
CREATE TABLE `v2_storage_integrity_faults` (
	`environment` text NOT NULL,
	`blob_id` text NOT NULL,
	PRIMARY KEY(`environment`, `blob_id`),
	CONSTRAINT "v2_storage_fault_environment" CHECK("v2_storage_integrity_faults"."environment" IN ('preview','production'))
);
--> statement-breakpoint
ALTER TABLE `v2_storage_reservations` ADD `live_blob_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `v2_file_consent_idx` ON `v2_consents` (`file_id`,`owner_id`,`kind`,`version`);--> statement-breakpoint
CREATE INDEX `v2_unresolved_invocation_idx` ON `v2_cost_attempts` (`invocation_id`) WHERE "v2_cost_attempts"."state" IN ('reserved','ambiguous');--> statement-breakpoint
CREATE INDEX `v2_idempotency_operation_request_idx` ON `v2_idempotency` (`operation_id`,`request_hash`);--> statement-breakpoint
CREATE INDEX `v2_storage_paid_operation_request_idx` ON `v2_storage_paid_executions` ("operation_id",json_extract("payload_json",'$.plan.requestHash'));
--> statement-breakpoint
-- Backfill is deliberately cold. A CHECK violation aborts the enclosing D1
-- migration transaction if the existing physical ledger disagrees with source.
INSERT INTO v2_physical_storage_totals(environment,held_bytes)
SELECT env, CASE WHEN EXISTS(SELECT 1 FROM v2_physical_storage_capacity c WHERE c.environment=env AND c.held_bytes!=coalesce((SELECT sum(maximum_cipher_bytes) FROM v2_physical_blob_bindings WHERE environment=env AND state='held'),0)) THEN -1 ELSE coalesce((SELECT sum(maximum_cipher_bytes) FROM v2_physical_blob_bindings WHERE environment=env AND state='held'),0) END
FROM (SELECT 'preview' AS env UNION ALL SELECT 'production');
--> statement-breakpoint
INSERT INTO v2_physical_binding_totals(blob_id,environment,held_bytes) SELECT blob_id,environment,CASE WHEN state='held' THEN maximum_cipher_bytes ELSE 0 END FROM v2_physical_blob_bindings;
--> statement-breakpoint
UPDATE v2_storage_reservations SET live_blob_bytes=coalesce((SELECT sum(logical_bytes) FROM v2_blobs WHERE reservation_id=v2_storage_reservations.id AND state!='deleted'),0);
--> statement-breakpoint
INSERT INTO v2_storage_carryover(id,cursor_month,budget_krw,maintenance_krw)
SELECT 1,month,coalesce((SELECT sum(reserved_krw+ambiguous_krw) FROM v2_monthly_budget WHERE month<clock.month),0),coalesce((SELECT sum(amount_krw) FROM v2_maintenance_exposure WHERE month<clock.month AND state IN ('reserved','ambiguous')),0)
FROM (SELECT strftime('%Y-%m','now','+9 hours') AS month) clock;
--> statement-breakpoint
INSERT INTO v2_storage_funding_heads(environment,proof_id,verified_at)
SELECT environment,id,verified_at FROM v2_runtime_proofs p WHERE kind='funding' AND NOT EXISTS(SELECT 1 FROM v2_runtime_proofs newer WHERE newer.environment=p.environment AND newer.kind='funding' AND (newer.verified_at>p.verified_at OR (newer.verified_at=p.verified_at AND newer.id>p.id)));
--> statement-breakpoint
INSERT INTO v2_storage_integrity_faults(environment,blob_id) SELECT env,b.id FROM (SELECT 'preview' AS env UNION ALL SELECT 'production') CROSS JOIN v2_blobs b LEFT JOIN v2_physical_blob_bindings binding ON binding.blob_id=b.id WHERE b.state!='deleted' AND (binding.blob_id IS NULL OR binding.state!='held' OR binding.environment!=env OR binding.object_key!=b.object_key OR b.cipher_bytes>binding.maximum_cipher_bytes);
--> statement-breakpoint
CREATE TRIGGER v2_blobs_integrity_insert AFTER INSERT ON v2_blobs BEGIN
 DELETE FROM v2_storage_integrity_faults WHERE environment IN ('preview','production') AND blob_id=NEW.id;
 INSERT INTO v2_storage_integrity_faults(environment,blob_id) SELECT env,b.id FROM (SELECT 'preview' AS env UNION ALL SELECT 'production') CROSS JOIN v2_blobs b LEFT JOIN v2_physical_blob_bindings binding ON binding.blob_id=b.id WHERE b.id=NEW.id AND b.state!='deleted' AND (binding.blob_id IS NULL OR binding.state!='held' OR binding.environment!=env OR binding.object_key!=b.object_key OR b.cipher_bytes>binding.maximum_cipher_bytes);
END;
--> statement-breakpoint
CREATE TRIGGER v2_blobs_integrity_update AFTER UPDATE ON v2_blobs BEGIN
 DELETE FROM v2_storage_integrity_faults WHERE environment IN ('preview','production') AND blob_id=OLD.id;
 INSERT INTO v2_storage_integrity_faults(environment,blob_id) SELECT env,b.id FROM (SELECT 'preview' AS env UNION ALL SELECT 'production') CROSS JOIN v2_blobs b LEFT JOIN v2_physical_blob_bindings binding ON binding.blob_id=b.id WHERE b.id=OLD.id AND b.state!='deleted' AND (binding.blob_id IS NULL OR binding.state!='held' OR binding.environment!=env OR binding.object_key!=b.object_key OR b.cipher_bytes>binding.maximum_cipher_bytes);
 DELETE FROM v2_storage_integrity_faults WHERE environment IN ('preview','production') AND blob_id=NEW.id;
 INSERT INTO v2_storage_integrity_faults(environment,blob_id) SELECT env,b.id FROM (SELECT 'preview' AS env UNION ALL SELECT 'production') CROSS JOIN v2_blobs b LEFT JOIN v2_physical_blob_bindings binding ON binding.blob_id=b.id WHERE b.id=NEW.id AND b.state!='deleted' AND (binding.blob_id IS NULL OR binding.state!='held' OR binding.environment!=env OR binding.object_key!=b.object_key OR b.cipher_bytes>binding.maximum_cipher_bytes);
END;
--> statement-breakpoint
CREATE TRIGGER v2_blobs_integrity_delete AFTER DELETE ON v2_blobs BEGIN
 DELETE FROM v2_storage_integrity_faults WHERE environment IN ('preview','production') AND blob_id=OLD.id;
 INSERT INTO v2_storage_integrity_faults(environment,blob_id) SELECT env,b.id FROM (SELECT 'preview' AS env UNION ALL SELECT 'production') CROSS JOIN v2_blobs b LEFT JOIN v2_physical_blob_bindings binding ON binding.blob_id=b.id WHERE b.id=OLD.id AND b.state!='deleted' AND (binding.blob_id IS NULL OR binding.state!='held' OR binding.environment!=env OR binding.object_key!=b.object_key OR b.cipher_bytes>binding.maximum_cipher_bytes);
END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_blob_bindings_integrity_insert AFTER INSERT ON v2_physical_blob_bindings BEGIN
 DELETE FROM v2_storage_integrity_faults WHERE environment IN ('preview','production') AND blob_id=NEW.blob_id;
 INSERT INTO v2_storage_integrity_faults(environment,blob_id) SELECT env,b.id FROM (SELECT 'preview' AS env UNION ALL SELECT 'production') CROSS JOIN v2_blobs b LEFT JOIN v2_physical_blob_bindings binding ON binding.blob_id=b.id WHERE b.id=NEW.blob_id AND b.state!='deleted' AND (binding.blob_id IS NULL OR binding.state!='held' OR binding.environment!=env OR binding.object_key!=b.object_key OR b.cipher_bytes>binding.maximum_cipher_bytes);
END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_blob_bindings_integrity_update AFTER UPDATE ON v2_physical_blob_bindings BEGIN
 DELETE FROM v2_storage_integrity_faults WHERE environment IN ('preview','production') AND blob_id=OLD.blob_id;
 INSERT INTO v2_storage_integrity_faults(environment,blob_id) SELECT env,b.id FROM (SELECT 'preview' AS env UNION ALL SELECT 'production') CROSS JOIN v2_blobs b LEFT JOIN v2_physical_blob_bindings binding ON binding.blob_id=b.id WHERE b.id=OLD.blob_id AND b.state!='deleted' AND (binding.blob_id IS NULL OR binding.state!='held' OR binding.environment!=env OR binding.object_key!=b.object_key OR b.cipher_bytes>binding.maximum_cipher_bytes);
 DELETE FROM v2_storage_integrity_faults WHERE environment IN ('preview','production') AND blob_id=NEW.blob_id;
 INSERT INTO v2_storage_integrity_faults(environment,blob_id) SELECT env,b.id FROM (SELECT 'preview' AS env UNION ALL SELECT 'production') CROSS JOIN v2_blobs b LEFT JOIN v2_physical_blob_bindings binding ON binding.blob_id=b.id WHERE b.id=NEW.blob_id AND b.state!='deleted' AND (binding.blob_id IS NULL OR binding.state!='held' OR binding.environment!=env OR binding.object_key!=b.object_key OR b.cipher_bytes>binding.maximum_cipher_bytes);
END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_blob_bindings_integrity_delete AFTER DELETE ON v2_physical_blob_bindings BEGIN
 DELETE FROM v2_storage_integrity_faults WHERE environment IN ('preview','production') AND blob_id=OLD.blob_id;
 INSERT INTO v2_storage_integrity_faults(environment,blob_id) SELECT env,b.id FROM (SELECT 'preview' AS env UNION ALL SELECT 'production') CROSS JOIN v2_blobs b LEFT JOIN v2_physical_blob_bindings binding ON binding.blob_id=b.id WHERE b.id=OLD.blob_id AND b.state!='deleted' AND (binding.blob_id IS NULL OR binding.state!='held' OR binding.environment!=env OR binding.object_key!=b.object_key OR b.cipher_bytes>binding.maximum_cipher_bytes);
END;
--> statement-breakpoint
CREATE TRIGGER v2_blob_reservation_insert AFTER INSERT ON v2_blobs BEGIN
 UPDATE v2_storage_reservations SET live_blob_bytes=live_blob_bytes+CASE WHEN NEW.state!='deleted' THEN NEW.logical_bytes ELSE 0 END WHERE id=NEW.reservation_id;
END;
--> statement-breakpoint
CREATE TRIGGER v2_blob_reservation_update AFTER UPDATE ON v2_blobs BEGIN
 UPDATE v2_storage_reservations SET live_blob_bytes=live_blob_bytes-CASE WHEN OLD.state!='deleted' THEN OLD.logical_bytes ELSE 0 END WHERE id=OLD.reservation_id;
 UPDATE v2_storage_reservations SET live_blob_bytes=live_blob_bytes+CASE WHEN NEW.state!='deleted' THEN NEW.logical_bytes ELSE 0 END WHERE id=NEW.reservation_id;
END;
--> statement-breakpoint
CREATE TRIGGER v2_blob_reservation_delete AFTER DELETE ON v2_blobs BEGIN
 UPDATE v2_storage_reservations SET live_blob_bytes=live_blob_bytes-CASE WHEN OLD.state!='deleted' THEN OLD.logical_bytes ELSE 0 END WHERE id=OLD.reservation_id;
END;
--> statement-breakpoint
CREATE TRIGGER v2_reservation_live_bounds_insert BEFORE INSERT ON v2_storage_reservations WHEN typeof(NEW.live_blob_bytes)!='integer' OR NEW.live_blob_bytes NOT BETWEEN 0 AND 9007199254740991 BEGIN SELECT RAISE(ABORT,'STORAGE_LIVE_BYTES_INVALID'); END;
--> statement-breakpoint
CREATE TRIGGER v2_reservation_live_bounds_update BEFORE UPDATE ON v2_storage_reservations WHEN typeof(NEW.live_blob_bytes)!='integer' OR NEW.live_blob_bytes NOT BETWEEN 0 AND 9007199254740991 BEGIN SELECT RAISE(ABORT,'STORAGE_LIVE_BYTES_INVALID'); END;
--> statement-breakpoint
UPDATE v2_storage_reservations SET live_blob_bytes=live_blob_bytes;
--> statement-breakpoint
DROP TRIGGER v2_physical_binding_count;
--> statement-breakpoint
DROP TRIGGER v2_physical_binding_release;
--> statement-breakpoint
DROP TRIGGER v2_physical_capacity_consistent;
--> statement-breakpoint
CREATE TRIGGER v2_physical_capacity_consistent_insert BEFORE INSERT ON v2_physical_storage_capacity WHEN NOT EXISTS(SELECT 1 FROM v2_physical_storage_totals t WHERE t.environment=NEW.environment AND t.version=1 AND t.held_bytes=NEW.held_bytes) BEGIN SELECT RAISE(ABORT,'PHYSICAL_CAPACITY_LEDGER_MISMATCH'); END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_capacity_consistent_update BEFORE UPDATE ON v2_physical_storage_capacity WHEN NEW.environment IS NOT OLD.environment OR NOT EXISTS(SELECT 1 FROM v2_physical_storage_totals t WHERE t.environment=NEW.environment AND t.version=1 AND t.held_bytes=NEW.held_bytes) BEGIN SELECT RAISE(ABORT,'PHYSICAL_CAPACITY_LEDGER_MISMATCH'); END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_totals_update BEFORE UPDATE ON v2_physical_storage_totals BEGIN
 SELECT CASE WHEN NEW.environment IS NOT OLD.environment OR NEW.version!=OLD.version OR NOT EXISTS(SELECT 1 FROM v2_physical_total_mutations m JOIN v2_physical_blob_bindings b ON b.blob_id=m.blob_id JOIN v2_physical_storage_capacity c ON c.environment=m.environment WHERE m.environment=OLD.environment AND b.environment=m.environment AND c.held_bytes=OLD.held_bytes AND NEW.held_bytes=OLD.held_bytes+m.delta AND ((b.state='held' AND m.delta=b.maximum_cipher_bytes) OR (b.state='released' AND m.delta=-b.maximum_cipher_bytes))) THEN RAISE(ABORT,'PHYSICAL_TOTAL_IMMUTABLE') END;
END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_totals_insert BEFORE INSERT ON v2_physical_storage_totals BEGIN SELECT RAISE(ABORT,'PHYSICAL_TOTAL_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_mutation_insert BEFORE INSERT ON v2_physical_total_mutations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v2_physical_blob_bindings b LEFT JOIN v2_physical_binding_totals applied ON applied.blob_id=b.blob_id WHERE b.blob_id=NEW.blob_id AND b.environment=NEW.environment AND (applied.blob_id IS NULL OR applied.environment=b.environment) AND NEW.delta=CASE WHEN b.state='held' THEN b.maximum_cipher_bytes ELSE 0 END-coalesce(applied.held_bytes,0)) THEN RAISE(ABORT,'PHYSICAL_DELTA_ALREADY_APPLIED') END;
END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_mutation_update BEFORE UPDATE ON v2_physical_total_mutations BEGIN SELECT RAISE(ABORT,'PHYSICAL_DELTA_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_applied_insert BEFORE INSERT ON v2_physical_binding_totals BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v2_physical_total_mutations m JOIN v2_physical_blob_bindings b ON b.blob_id=m.blob_id WHERE m.blob_id=NEW.blob_id AND m.environment=NEW.environment AND b.environment=NEW.environment AND NEW.held_bytes=CASE WHEN b.state='held' THEN b.maximum_cipher_bytes ELSE 0 END AND NEW.held_bytes=coalesce((SELECT held_bytes FROM v2_physical_binding_totals old WHERE old.blob_id=NEW.blob_id),0)+m.delta) THEN RAISE(ABORT,'PHYSICAL_APPLIED_IMMUTABLE') END;
END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_applied_update BEFORE UPDATE ON v2_physical_binding_totals BEGIN
 SELECT CASE WHEN NEW.blob_id IS NOT OLD.blob_id OR NEW.environment IS NOT OLD.environment OR NOT EXISTS(SELECT 1 FROM v2_physical_total_mutations m JOIN v2_physical_blob_bindings b ON b.blob_id=m.blob_id WHERE m.blob_id=NEW.blob_id AND m.environment=NEW.environment AND b.environment=NEW.environment AND NEW.held_bytes=CASE WHEN b.state='held' THEN b.maximum_cipher_bytes ELSE 0 END AND NEW.held_bytes=coalesce((SELECT held_bytes FROM v2_physical_binding_totals old WHERE old.blob_id=NEW.blob_id),0)+m.delta) THEN RAISE(ABORT,'PHYSICAL_APPLIED_IMMUTABLE') END;
END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_applied_delete BEFORE DELETE ON v2_physical_binding_totals BEGIN SELECT RAISE(ABORT,'PHYSICAL_APPLIED_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_totals_delete BEFORE DELETE ON v2_physical_storage_totals BEGIN SELECT RAISE(ABORT,'PHYSICAL_TOTAL_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_binding_count AFTER INSERT ON v2_physical_blob_bindings  BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v2_physical_storage_totals t JOIN v2_physical_storage_capacity c ON c.environment=t.environment WHERE t.environment=NEW.environment AND t.version=1 AND t.held_bytes=c.held_bytes) THEN RAISE(ABORT,'PHYSICAL_TOTAL_UNAVAILABLE') END;
 INSERT INTO v2_physical_total_mutations(environment,blob_id,delta) VALUES(NEW.environment,NEW.blob_id,NEW.maximum_cipher_bytes);
 UPDATE v2_physical_storage_totals SET held_bytes=held_bytes+(NEW.maximum_cipher_bytes) WHERE environment=NEW.environment;
 UPDATE v2_physical_storage_capacity SET held_bytes=held_bytes+(NEW.maximum_cipher_bytes),revision=revision+1 WHERE environment=NEW.environment;
 INSERT INTO v2_physical_binding_totals(blob_id,environment,held_bytes) SELECT blob_id,environment,CASE WHEN state='held' THEN maximum_cipher_bytes ELSE 0 END FROM v2_physical_blob_bindings WHERE blob_id=NEW.blob_id ON CONFLICT(blob_id) DO UPDATE SET held_bytes=excluded.held_bytes;
 DELETE FROM v2_physical_total_mutations WHERE environment=NEW.environment;
END;
--> statement-breakpoint
CREATE TRIGGER v2_physical_binding_release AFTER UPDATE ON v2_physical_blob_bindings WHEN OLD.state='held' AND NEW.state='released' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v2_physical_storage_totals t JOIN v2_physical_storage_capacity c ON c.environment=t.environment WHERE t.environment=OLD.environment AND t.version=1 AND t.held_bytes=c.held_bytes) THEN RAISE(ABORT,'PHYSICAL_TOTAL_UNAVAILABLE') END;
 INSERT INTO v2_physical_total_mutations(environment,blob_id,delta) VALUES(OLD.environment,OLD.blob_id,-OLD.maximum_cipher_bytes);
 UPDATE v2_physical_storage_totals SET held_bytes=held_bytes+(-OLD.maximum_cipher_bytes) WHERE environment=OLD.environment;
 UPDATE v2_physical_storage_capacity SET held_bytes=held_bytes+(-OLD.maximum_cipher_bytes),revision=revision+1 WHERE environment=OLD.environment;
 INSERT INTO v2_physical_binding_totals(blob_id,environment,held_bytes) SELECT blob_id,environment,CASE WHEN state='held' THEN maximum_cipher_bytes ELSE 0 END FROM v2_physical_blob_bindings WHERE blob_id=OLD.blob_id ON CONFLICT(blob_id) DO UPDATE SET held_bytes=excluded.held_bytes;
 DELETE FROM v2_physical_total_mutations WHERE environment=OLD.environment;
END;
--> statement-breakpoint
CREATE TRIGGER v2_monthly_budget_carryover_insert AFTER INSERT ON v2_monthly_budget BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v2_storage_carryover WHERE id=1 AND version=1) THEN RAISE(ABORT,'STORAGE_CARRYOVER_UNAVAILABLE') END;
 UPDATE v2_storage_carryover SET budget_krw=budget_krw+(CASE WHEN NEW.month<cursor_month AND 1 THEN NEW.reserved_krw+NEW.ambiguous_krw ELSE 0 END),revision=revision+1 WHERE id=1 AND (CASE WHEN NEW.month<cursor_month AND 1 THEN NEW.reserved_krw+NEW.ambiguous_krw ELSE 0 END)!=0;
END;
--> statement-breakpoint
CREATE TRIGGER v2_monthly_budget_carryover_update AFTER UPDATE ON v2_monthly_budget BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v2_storage_carryover WHERE id=1 AND version=1) THEN RAISE(ABORT,'STORAGE_CARRYOVER_UNAVAILABLE') END;
 UPDATE v2_storage_carryover SET budget_krw=budget_krw+((CASE WHEN NEW.month<cursor_month AND 1 THEN NEW.reserved_krw+NEW.ambiguous_krw ELSE 0 END)-(CASE WHEN OLD.month<cursor_month AND 1 THEN OLD.reserved_krw+OLD.ambiguous_krw ELSE 0 END)),revision=revision+1 WHERE id=1 AND ((CASE WHEN NEW.month<cursor_month AND 1 THEN NEW.reserved_krw+NEW.ambiguous_krw ELSE 0 END)-(CASE WHEN OLD.month<cursor_month AND 1 THEN OLD.reserved_krw+OLD.ambiguous_krw ELSE 0 END))!=0;
END;
--> statement-breakpoint
CREATE TRIGGER v2_monthly_budget_carryover_delete AFTER DELETE ON v2_monthly_budget BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v2_storage_carryover WHERE id=1 AND version=1) THEN RAISE(ABORT,'STORAGE_CARRYOVER_UNAVAILABLE') END;
 UPDATE v2_storage_carryover SET budget_krw=budget_krw+(-(CASE WHEN OLD.month<cursor_month AND 1 THEN OLD.reserved_krw+OLD.ambiguous_krw ELSE 0 END)),revision=revision+1 WHERE id=1 AND (-(CASE WHEN OLD.month<cursor_month AND 1 THEN OLD.reserved_krw+OLD.ambiguous_krw ELSE 0 END))!=0;
END;
--> statement-breakpoint
CREATE TRIGGER v2_maintenance_exposure_carryover_insert AFTER INSERT ON v2_maintenance_exposure BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v2_storage_carryover WHERE id=1 AND version=1) THEN RAISE(ABORT,'STORAGE_CARRYOVER_UNAVAILABLE') END;
 UPDATE v2_storage_carryover SET maintenance_krw=maintenance_krw+(CASE WHEN NEW.month<cursor_month AND NEW.state IN ('reserved','ambiguous') THEN NEW.amount_krw ELSE 0 END),revision=revision+1 WHERE id=1 AND (CASE WHEN NEW.month<cursor_month AND NEW.state IN ('reserved','ambiguous') THEN NEW.amount_krw ELSE 0 END)!=0;
END;
--> statement-breakpoint
CREATE TRIGGER v2_maintenance_exposure_carryover_update AFTER UPDATE ON v2_maintenance_exposure BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v2_storage_carryover WHERE id=1 AND version=1) THEN RAISE(ABORT,'STORAGE_CARRYOVER_UNAVAILABLE') END;
 UPDATE v2_storage_carryover SET maintenance_krw=maintenance_krw+((CASE WHEN NEW.month<cursor_month AND NEW.state IN ('reserved','ambiguous') THEN NEW.amount_krw ELSE 0 END)-(CASE WHEN OLD.month<cursor_month AND OLD.state IN ('reserved','ambiguous') THEN OLD.amount_krw ELSE 0 END)),revision=revision+1 WHERE id=1 AND ((CASE WHEN NEW.month<cursor_month AND NEW.state IN ('reserved','ambiguous') THEN NEW.amount_krw ELSE 0 END)-(CASE WHEN OLD.month<cursor_month AND OLD.state IN ('reserved','ambiguous') THEN OLD.amount_krw ELSE 0 END))!=0;
END;
--> statement-breakpoint
CREATE TRIGGER v2_maintenance_exposure_carryover_delete AFTER DELETE ON v2_maintenance_exposure BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v2_storage_carryover WHERE id=1 AND version=1) THEN RAISE(ABORT,'STORAGE_CARRYOVER_UNAVAILABLE') END;
 UPDATE v2_storage_carryover SET maintenance_krw=maintenance_krw+(-(CASE WHEN OLD.month<cursor_month AND OLD.state IN ('reserved','ambiguous') THEN OLD.amount_krw ELSE 0 END)),revision=revision+1 WHERE id=1 AND (-(CASE WHEN OLD.month<cursor_month AND OLD.state IN ('reserved','ambiguous') THEN OLD.amount_krw ELSE 0 END))!=0;
END;
--> statement-breakpoint
-- Only a cursor transition executes historical SUMs. Normal ledger deltas
-- update one singleton and never rescan prior months.
CREATE TRIGGER v2_storage_carryover_cursor BEFORE UPDATE ON v2_storage_carryover WHEN NEW.cursor_month!=OLD.cursor_month BEGIN
 SELECT CASE WHEN NEW.cursor_month<=OLD.cursor_month OR NEW.cursor_month!=strftime('%Y-%m','now','+9 hours') OR NEW.revision!=OLD.revision+1 OR NEW.version!=OLD.version OR NEW.budget_krw!=coalesce((SELECT sum(reserved_krw+ambiguous_krw) FROM v2_monthly_budget WHERE month<NEW.cursor_month),0) OR NEW.maintenance_krw!=coalesce((SELECT sum(amount_krw) FROM v2_maintenance_exposure WHERE month<NEW.cursor_month AND state IN ('reserved','ambiguous')),0) THEN RAISE(ABORT,'STORAGE_CARRYOVER_CURSOR_INVALID') END;
END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_carryover_delete BEFORE DELETE ON v2_storage_carryover BEGIN SELECT RAISE(ABORT,'STORAGE_CARRYOVER_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_funding_head_insert AFTER INSERT ON v2_runtime_proofs WHEN NEW.kind='funding' BEGIN
 INSERT INTO v2_storage_funding_heads(environment,proof_id,verified_at) SELECT NEW.environment,NEW.id,NEW.verified_at WHERE NOT EXISTS(SELECT 1 FROM v2_storage_funding_heads current WHERE current.environment=NEW.environment AND (current.verified_at>NEW.verified_at OR (current.verified_at=NEW.verified_at AND current.proof_id>=NEW.id)))
 ON CONFLICT(environment) DO UPDATE SET proof_id=excluded.proof_id,verified_at=excluded.verified_at
 WHERE excluded.verified_at>verified_at OR (excluded.verified_at=verified_at AND excluded.proof_id>proof_id);
END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_funding_head_insert_valid BEFORE INSERT ON v2_storage_funding_heads BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM v2_storage_funding_heads old WHERE old.environment=NEW.environment AND (old.verified_at>NEW.verified_at OR (old.verified_at=NEW.verified_at AND old.proof_id>NEW.proof_id))) OR NOT EXISTS(SELECT 1 FROM v2_runtime_proofs p WHERE p.id=NEW.proof_id AND p.environment=NEW.environment AND p.kind='funding' AND p.verified_at=NEW.verified_at) THEN RAISE(ABORT,'STORAGE_FUNDING_HEAD_INVALID') END; END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_funding_head_update_valid BEFORE UPDATE ON v2_storage_funding_heads BEGIN SELECT CASE WHEN NEW.environment IS NOT OLD.environment OR (NEW.verified_at<OLD.verified_at OR (NEW.verified_at=OLD.verified_at AND NEW.proof_id<OLD.proof_id)) OR NOT EXISTS(SELECT 1 FROM v2_runtime_proofs p WHERE p.id=NEW.proof_id AND p.environment=NEW.environment AND p.kind='funding' AND p.verified_at=NEW.verified_at) THEN RAISE(ABORT,'STORAGE_FUNDING_HEAD_INVALID') END; END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_funding_head_delete BEFORE DELETE ON v2_storage_funding_heads BEGIN SELECT RAISE(ABORT,'STORAGE_FUNDING_HEAD_IMMUTABLE'); END;
--> statement-breakpoint
UPDATE app_metadata SET value='0010_bounded_storage_admission',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
