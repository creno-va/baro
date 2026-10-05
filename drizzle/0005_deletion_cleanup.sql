ALTER TABLE `deletion_jobs` ADD `cleanup_cursor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `deletion_jobs` ADD `next_attempt_at` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL;
--> statement-breakpoint
UPDATE app_metadata SET value='0005_deletion_cleanup',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
