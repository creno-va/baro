CREATE TABLE `v2_rework_records` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
  `workspace_id` text NOT NULL REFERENCES `v2_workspaces`(`id`) ON DELETE cascade,
  `kind` text NOT NULL,
  `entity_id` text NOT NULL,
  `revision` integer NOT NULL,
  `workspace_revision` integer NOT NULL,
  `state` text DEFAULT 'staging' NOT NULL,
  `part_count` integer NOT NULL,
  `byte_length` integer NOT NULL,
  `encrypted_payload` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `v2_rework_kind` CHECK (`kind` IN ('context','reconciliation','analysis','resolution','task','action_receipt','checkpoint')),
  CONSTRAINT `v2_rework_bounds` CHECK (`revision`>=1 AND `workspace_revision`>=1 AND `part_count` BETWEEN 1 AND 64 AND `byte_length` BETWEEN 1 AND 4194304 AND `state` IN ('staging','published','abandoned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_rework_published_version_unique` ON `v2_rework_records` (`workspace_id`,`kind`,`entity_id`,`revision`) WHERE `state`='published';
--> statement-breakpoint
CREATE INDEX `v2_rework_latest_idx` ON `v2_rework_records` (`workspace_id`,`kind`,`entity_id`,`state`,`revision`);
--> statement-breakpoint
CREATE TABLE `v2_rework_parts` (
  `id` text PRIMARY KEY NOT NULL,
  `record_id` text NOT NULL REFERENCES `v2_rework_records`(`id`) ON DELETE cascade,
  `part_index` integer NOT NULL,
  `byte_length` integer NOT NULL,
  `encrypted_payload` text NOT NULL,
  CONSTRAINT `v2_rework_part_bounds` CHECK (`part_index` BETWEEN 0 AND 63 AND `byte_length` BETWEEN 1 AND 65536)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_rework_part_unique` ON `v2_rework_parts` (`record_id`,`part_index`);
--> statement-breakpoint
CREATE TRIGGER `v2_rework_record_immutable` BEFORE UPDATE ON `v2_rework_records`
WHEN OLD.state='published' BEGIN SELECT RAISE(ABORT,'V2_IMMUTABLE_REWORK'); END;
--> statement-breakpoint
CREATE TRIGGER `v2_rework_part_immutable` BEFORE UPDATE ON `v2_rework_parts`
WHEN EXISTS(SELECT 1 FROM v2_rework_records WHERE id=OLD.record_id AND state='published')
BEGIN SELECT RAISE(ABORT,'V2_IMMUTABLE_REWORK'); END;
--> statement-breakpoint
CREATE TRIGGER `v2_rework_published_part_insert` BEFORE INSERT ON `v2_rework_parts`
WHEN EXISTS(SELECT 1 FROM v2_rework_records WHERE id=NEW.record_id AND state='published')
BEGIN SELECT RAISE(ABORT,'V2_IMMUTABLE_REWORK'); END;
--> statement-breakpoint
INSERT INTO app_metadata(key,value,updated_at) VALUES('schema_version','0022_conversation_rework',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
