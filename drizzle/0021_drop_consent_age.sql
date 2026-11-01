-- Contract only after the age-independent Worker has been deployed.
ALTER TABLE `user_consents` DROP COLUMN `over_14_confirmed`;
--> statement-breakpoint
INSERT INTO app_metadata(key,value,updated_at) VALUES('schema_version','0021_drop_consent_age',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
