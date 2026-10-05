CREATE TABLE `user` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL,
  `email_verified` integer DEFAULT false NOT NULL,
  `image` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);
--> statement-breakpoint
CREATE TABLE `session` (
  `id` text PRIMARY KEY NOT NULL,
  `expires_at` integer NOT NULL,
  `token` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `ip_address` text,
  `user_agent` text,
  `user_id` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);
--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);
--> statement-breakpoint
CREATE TABLE `account` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `user_id` text NOT NULL,
  `access_token` text,
  `refresh_token` text,
  `id_token` text,
  `access_token_expires_at` integer,
  `refresh_token_expires_at` integer,
  `scope` text,
  `password` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_provider_account_unique` ON `account` (`provider_id`, `account_id`);
--> statement-breakpoint
CREATE TABLE `verification` (
  `id` text PRIMARY KEY NOT NULL,
  `identifier` text NOT NULL,
  `value` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);
--> statement-breakpoint
CREATE TABLE `user_consents` (
  `user_id` text PRIMARY KEY NOT NULL,
  `terms_version` text NOT NULL,
  `privacy_version` text NOT NULL,
  `ai_notice_version` text NOT NULL,
  `over_14_confirmed` integer NOT NULL,
  `consented_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `user_consents_over_14_check` CHECK (`over_14_confirmed` = 1)
);
--> statement-breakpoint
UPDATE `app_metadata` SET `value` = '0001_auth_and_consent', `updated_at` = CURRENT_TIMESTAMP WHERE `key` = 'schema_version';
