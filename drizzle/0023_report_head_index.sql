CREATE INDEX `v2_reports_workspace_head_idx` ON `v2_reports` (`workspace_id`,"revision" desc,"created_at" desc,"id" desc);
--> statement-breakpoint
INSERT INTO app_metadata(key,value,updated_at) VALUES('schema_version','0023_report_head_index',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
