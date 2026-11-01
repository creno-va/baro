-- Expand before Worker cutover: preserve the historical column for old readers,
-- remove its age requirement, and allow new code to omit it (NULL, never fabricated true).
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_user_consents` (
	`user_id` text PRIMARY KEY NOT NULL,
	`terms_version` text NOT NULL,
	`privacy_version` text NOT NULL,
	`ai_notice_version` text NOT NULL,
	`over_14_confirmed` integer,
	`consented_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_consents`("user_id", "terms_version", "privacy_version", "ai_notice_version", "over_14_confirmed", "consented_at") SELECT "user_id", "terms_version", "privacy_version", "ai_notice_version", "over_14_confirmed", "consented_at" FROM `user_consents`;--> statement-breakpoint
DROP TABLE `user_consents`;--> statement-breakpoint
ALTER TABLE `__new_user_consents` RENAME TO `user_consents`;--> statement-breakpoint
CREATE TRIGGER v2_directory_policy_update AFTER UPDATE ON user_consents BEGIN
  UPDATE v2_directory_epoch SET revision=revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v2_directory_entries WHERE owner_id=NEW.user_id);
END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_policy_delete AFTER DELETE ON user_consents BEGIN
  UPDATE v2_directory_epoch SET revision=revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v2_directory_entries WHERE owner_id=OLD.user_id);
END;
--> statement-breakpoint
UPDATE v2_directory_epoch SET revision=revision+1 WHERE id=1;
--> statement-breakpoint
INSERT INTO app_metadata(key,value,updated_at) VALUES('schema_version','0020_remove_consent_age',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
