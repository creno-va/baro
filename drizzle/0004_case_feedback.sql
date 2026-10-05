CREATE TABLE `case_feedback` (
	`case_id` text PRIMARY KEY NOT NULL,
	`analysis_id` text NOT NULL,
	`helpful` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "case_feedback_helpful_check" CHECK(typeof("case_feedback"."helpful")='integer' AND "case_feedback"."helpful" IN (0,1))
);
--> statement-breakpoint
UPDATE app_metadata SET value='0004_case_feedback',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
