ALTER TABLE `session` ADD `oauth_authenticated_at` integer;--> statement-breakpoint
UPDATE `app_metadata` SET `value` = '0002_oauth_session_security', `updated_at` = CURRENT_TIMESTAMP WHERE `key` = 'schema_version';
