CREATE INDEX `v2_blob_reservation_state` ON `v2_blobs` (`reservation_id`,`state`,`id`);--> statement-breakpoint
CREATE INDEX `v2_blob_public_source` ON `v2_blobs` (`source_blob_id`,`source_asset_revision`,`approved_revision_id`,`kind`,`state`,`id`);--> statement-breakpoint
CREATE INDEX `v2_profile_approved_revision` ON `v2_profile_revisions` (`profile_id`,`status`,`revision`);--> statement-breakpoint
CREATE INDEX `v2_storage_entity_history` ON `v2_storage_reservations` (`entity_id`,`kind`,`created_at`,`id`);
--> statement-breakpoint
INSERT INTO app_metadata(key,value) VALUES('schema_version','0013_lawyer_storage_lookups') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
