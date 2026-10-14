CREATE TABLE `v2_directory_asset_refs` (
	`profile_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`blob_id` text NOT NULL,
	PRIMARY KEY(`profile_id`, `asset_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `v2_directory_entries`(`profile_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `v2_directory_ref_asset` ON `v2_directory_asset_refs` (`asset_id`);--> statement-breakpoint
CREATE INDEX `v2_directory_ref_blob` ON `v2_directory_asset_refs` (`blob_id`);--> statement-breakpoint
CREATE TABLE `v2_directory_entries` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`revision` integer NOT NULL,
	`sort_key` text NOT NULL,
	`normalized_name` text NOT NULL,
	`normalized_office` text NOT NULL,
	`region` text NOT NULL,
	`public_json` text NOT NULL,
	`photo_data` text,
	`tokens_json` text NOT NULL,
	`facets_json` text NOT NULL,
	`refs_json` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `v2_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_directory_entry_bounds" CHECK("v2_directory_entries"."source" IN ('self','verified') AND "v2_directory_entries"."revision">0 AND length("v2_directory_entries"."sort_key")=16 AND "v2_directory_entries"."sort_key" NOT GLOB '*[^0-9a-f]*' AND length(CAST("v2_directory_entries"."public_json" AS BLOB))<=65536 AND length(CAST("v2_directory_entries"."tokens_json" AS BLOB))<=65536 AND length(CAST("v2_directory_entries"."facets_json" AS BLOB))<=4096 AND length(CAST("v2_directory_entries"."refs_json" AS BLOB))<=16384 AND ("v2_directory_entries"."photo_data" IS NULL OR length(CAST("v2_directory_entries"."photo_data" AS BLOB))<=44000))
);
--> statement-breakpoint
CREATE INDEX `v2_directory_owner` ON `v2_directory_entries` (`owner_id`);
--> statement-breakpoint
CREATE INDEX `v2_directory_source` ON `v2_directory_entries` (`source`,`source_id`);--> statement-breakpoint
CREATE TABLE `v2_directory_epoch` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "v2_directory_epoch_bounds" CHECK("v2_directory_epoch"."id"=1 AND typeof("v2_directory_epoch"."revision")='integer' AND "v2_directory_epoch"."revision">0)
);
--> statement-breakpoint
CREATE TABLE `v2_directory_facets` (
	`facet` text NOT NULL,
	`sort_key` text NOT NULL,
	`profile_id` text NOT NULL,
	PRIMARY KEY(`facet`, `sort_key`, `profile_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `v2_directory_entries`(`profile_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `v2_directory_facets_profile` ON `v2_directory_facets` (`profile_id`);--> statement-breakpoint
CREATE TABLE `v2_directory_terms` (
	`token` text NOT NULL,
	`sort_key` text NOT NULL,
	`profile_id` text NOT NULL,
	PRIMARY KEY(`token`, `sort_key`, `profile_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `v2_directory_entries`(`profile_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `v2_directory_terms_profile` ON `v2_directory_terms` (`profile_id`);
--> statement-breakpoint
INSERT INTO v2_directory_epoch(id,revision) VALUES(1,1);
--> statement-breakpoint
CREATE TRIGGER v2_directory_insert AFTER INSERT ON v2_directory_entries BEGIN
  INSERT INTO v2_directory_terms(token,sort_key,profile_id) SELECT value,NEW.sort_key,NEW.profile_id FROM json_each(NEW.tokens_json);
  INSERT INTO v2_directory_facets(facet,sort_key,profile_id) SELECT value,NEW.sort_key,NEW.profile_id FROM json_each(NEW.facets_json);
  INSERT INTO v2_directory_asset_refs(profile_id,asset_id,blob_id) SELECT NEW.profile_id,json_extract(value,'$.assetId'),json_extract(value,'$.blobId') FROM json_each(NEW.refs_json);
  UPDATE v2_directory_epoch SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_update AFTER UPDATE ON v2_directory_entries BEGIN
  DELETE FROM v2_directory_terms WHERE profile_id=OLD.profile_id;
  DELETE FROM v2_directory_facets WHERE profile_id=OLD.profile_id;
  DELETE FROM v2_directory_asset_refs WHERE profile_id=OLD.profile_id;
  INSERT INTO v2_directory_terms(token,sort_key,profile_id) SELECT value,NEW.sort_key,NEW.profile_id FROM json_each(NEW.tokens_json);
  INSERT INTO v2_directory_facets(facet,sort_key,profile_id) SELECT value,NEW.sort_key,NEW.profile_id FROM json_each(NEW.facets_json);
  INSERT INTO v2_directory_asset_refs(profile_id,asset_id,blob_id) SELECT NEW.profile_id,json_extract(value,'$.assetId'),json_extract(value,'$.blobId') FROM json_each(NEW.refs_json);
  UPDATE v2_directory_epoch SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_delete AFTER DELETE ON v2_directory_entries BEGIN
  UPDATE v2_directory_epoch SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_tombstone AFTER INSERT ON v2_tombstones BEGIN
  DELETE FROM v2_directory_entries WHERE (NEW.target_kind='account' AND owner_id=NEW.target_id) OR (NEW.target_kind='profile' AND profile_id=NEW.target_id) OR (NEW.target_kind='asset' AND profile_id IN (SELECT profile_id FROM v2_directory_asset_refs WHERE asset_id=NEW.target_id)) OR (NEW.target_kind='blob' AND profile_id IN (SELECT profile_id FROM v2_directory_asset_refs WHERE blob_id=NEW.target_id));
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_snapshot_delete AFTER DELETE ON v2_private_snapshots BEGIN
  DELETE FROM v2_directory_entries WHERE source='self' AND source_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_consent_delete AFTER DELETE ON v2_consents BEGIN
  DELETE FROM v2_directory_entries WHERE source='self' AND source_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_public_delete AFTER DELETE ON v2_public_profiles BEGIN
  DELETE FROM v2_directory_entries WHERE source='verified' AND profile_id=OLD.profile_id;
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_public_asset_delete AFTER DELETE ON v2_public_assets BEGIN
  DELETE FROM v2_directory_entries WHERE source='verified' AND profile_id=OLD.profile_id;
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_asset_delete AFTER DELETE ON v2_assets BEGIN
  DELETE FROM v2_directory_entries WHERE profile_id IN (SELECT profile_id FROM v2_directory_asset_refs WHERE asset_id=OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_asset_update AFTER UPDATE OF state,revision,sanitized_blob_id ON v2_assets
WHEN NEW.state IS NOT OLD.state OR NEW.revision IS NOT OLD.revision OR NEW.sanitized_blob_id IS NOT OLD.sanitized_blob_id BEGIN
  DELETE FROM v2_directory_entries WHERE source='self' AND profile_id IN (SELECT profile_id FROM v2_directory_asset_refs WHERE asset_id=OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_blob_update AFTER UPDATE OF state,visibility ON v2_blobs
WHEN NEW.state IS NOT OLD.state OR NEW.visibility IS NOT OLD.visibility BEGIN
  DELETE FROM v2_directory_entries WHERE profile_id IN (SELECT profile_id FROM v2_directory_asset_refs WHERE blob_id=OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_blob_delete AFTER DELETE ON v2_blobs BEGIN
  DELETE FROM v2_directory_entries WHERE profile_id IN (SELECT profile_id FROM v2_directory_asset_refs WHERE blob_id=OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_role_insert AFTER INSERT ON v2_role_bindings BEGIN
  UPDATE v2_directory_epoch SET revision=revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v2_directory_entries WHERE owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_role_delete AFTER DELETE ON v2_role_bindings BEGIN
  UPDATE v2_directory_epoch SET revision=revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v2_directory_entries WHERE owner_id=OLD.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_role_update AFTER UPDATE ON v2_role_bindings BEGIN
  UPDATE v2_directory_epoch SET revision=revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v2_directory_entries WHERE owner_id IN (OLD.owner_id,NEW.owner_id));
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_policy_update AFTER UPDATE ON user_consents BEGIN
  UPDATE v2_directory_epoch SET revision=revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v2_directory_entries WHERE owner_id=NEW.user_id);
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_policy_delete AFTER DELETE ON user_consents BEGIN
  UPDATE v2_directory_epoch SET revision=revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v2_directory_entries WHERE owner_id=OLD.user_id);
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_account_update AFTER UPDATE ON app_metadata WHEN NEW.key LIKE 'account-type:%' BEGIN
  UPDATE v2_directory_epoch SET revision=revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v2_directory_entries WHERE owner_id=substr(NEW.key,14));
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_account_insert AFTER INSERT ON app_metadata WHEN NEW.key LIKE 'account-type:%' BEGIN
  UPDATE v2_directory_epoch SET revision=revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v2_directory_entries WHERE owner_id=substr(NEW.key,14));
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_account_delete AFTER DELETE ON app_metadata WHEN OLD.key LIKE 'account-type:%' BEGIN
  UPDATE v2_directory_epoch SET revision=revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v2_directory_entries WHERE owner_id=substr(OLD.key,14));
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_application_update AFTER UPDATE OF status ON v2_applications WHEN NEW.status IS NOT OLD.status BEGIN
  UPDATE v2_directory_epoch SET revision=revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v2_directory_entries WHERE owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_revision_update AFTER UPDATE OF status ON v2_profile_revisions WHEN NEW.status IS NOT OLD.status BEGIN
  DELETE FROM v2_directory_entries WHERE source='verified' AND source_id=NEW.id;
END;
--> statement-breakpoint
INSERT INTO app_metadata(key,value) VALUES('schema_version','0012_directory_index') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
--> statement-breakpoint
CREATE TRIGGER v2_directory_profile_pointer AFTER UPDATE OF approved_revision_id ON v2_profiles WHEN NEW.approved_revision_id IS NOT OLD.approved_revision_id BEGIN
  UPDATE v2_directory_epoch SET revision=revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v2_directory_entries WHERE profile_id=NEW.id);
END;
