CREATE TABLE `app_metadata` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `app_metadata` (`key`, `value`) VALUES ('schema_version', '0000_foundation');
