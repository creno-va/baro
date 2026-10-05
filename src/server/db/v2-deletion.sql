-- These database guards cover v1 auth/case cascade deletions as well as v2 repositories.
-- Journals contain only opaque object/workflow/reservation IDs and survive primary deletion.
CREATE TRIGGER v2_capture_account_delete BEFORE DELETE ON user BEGIN
 INSERT INTO v2_tombstones VALUES('account',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;

 INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at)
 VALUES(lower(hex(randomblob(16))),'account',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(target_kind,target_id) DO NOTHING;
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id)
 SELECT (SELECT id FROM v2_deletion_journals WHERE target_kind='account' AND target_id=OLD.id),coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='account' AND target_id=OLD.id)),0)+row_number() OVER(ORDER BY kind,target_id)-1,kind,target_id FROM (
 SELECT DISTINCT 'job' AS kind,runtime_instance_id AS target_id FROM v2_jobs WHERE operation_id IN (SELECT id FROM v2_operations WHERE owner_id=OLD.id)
 UNION SELECT 'job',target_id FROM v2_outbox WHERE kind='job_dispatch' AND operation_id IN (SELECT operation_id FROM v2_jobs WHERE operation_id IN (SELECT id FROM v2_operations WHERE owner_id=OLD.id))
 UNION SELECT 'blob',id FROM v2_blobs WHERE principal_id IN (SELECT id FROM v2_billing_principals WHERE owner_id=OLD.id)
 UNION SELECT 'reservation',id FROM v2_storage_reservations WHERE principal_id IN (SELECT id FROM v2_billing_principals WHERE owner_id=OLD.id)) AS resources
 WHERE NOT EXISTS(SELECT 1 FROM v2_deletion_targets d WHERE d.journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='account' AND target_id=OLD.id) AND d.kind=resources.kind AND d.target_id=resources.target_id)
 ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
 UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE (principal_id IN (SELECT id FROM v2_billing_principals WHERE owner_id=OLD.id)) AND state!='deleted';
 UPDATE v2_jobs SET status='cancelled',failure_code=NULL,retryable=0,lease_token=NULL,lease_until=NULL,fencing=fencing+1 WHERE (operation_id IN (SELECT id FROM v2_operations WHERE owner_id=OLD.id)) AND status IN ('queued','running','validating','failed');
 UPDATE v2_operations SET state='cancelled' WHERE id IN (SELECT operation_id FROM v2_jobs WHERE operation_id IN (SELECT id FROM v2_operations WHERE owner_id=OLD.id)) AND state IN ('admitted','failed','ambiguous');

 UPDATE v2_monthly_budget SET reserved_krw=reserved_krw-coalesce((SELECT sum(reserved_krw) FROM v2_cost_attempts a WHERE a.month=v2_monthly_budget.month AND a.state='reserved' AND a.operation_id IN (SELECT id FROM v2_operations WHERE owner_id=OLD.id)),0),
 ambiguous_krw=ambiguous_krw+coalesce((SELECT sum(reserved_krw) FROM v2_cost_attempts a WHERE a.month=v2_monthly_budget.month AND a.state='reserved' AND a.operation_id IN (SELECT id FROM v2_operations WHERE owner_id=OLD.id)),0);
 INSERT INTO v2_cost_receipts(id,attempt_id,previous_state,next_state) SELECT lower(hex(randomblob(16))),id,'reserved','ambiguous' FROM v2_cost_attempts WHERE state='reserved' AND operation_id IN (SELECT id FROM v2_operations WHERE owner_id=OLD.id);
 UPDATE v2_cost_attempts SET state='ambiguous' WHERE state='reserved' AND operation_id IN (SELECT id FROM v2_operations WHERE owner_id=OLD.id);
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id)
 SELECT (SELECT id FROM v2_deletion_journals WHERE target_kind='account' AND target_id=OLD.id),coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='account' AND target_id=OLD.id)),0)+row_number() OVER(ORDER BY workflow)-1,'legacy_workflow',workflow FROM (
 SELECT DISTINCT a.id||'-'||n.attempt AS workflow FROM analyses a JOIN cases c ON c.id=a.case_id JOIN (SELECT 1 attempt UNION SELECT 2 UNION SELECT 3) n ON n.attempt<=a.attempt WHERE c.user_id=OLD.id
 UNION SELECT d.instance_id FROM dispatch_outbox d JOIN analyses a ON a.id=d.analysis_id JOIN cases c ON c.id=a.case_id WHERE c.user_id=OLD.id) WHERE 1 ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER v2_capture_workspace_delete BEFORE DELETE ON v2_workspaces BEGIN
 INSERT INTO v2_tombstones VALUES('workspace',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;

 INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at)
 VALUES(lower(hex(randomblob(16))),'workspace',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(target_kind,target_id) DO NOTHING;
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id)
 SELECT (SELECT id FROM v2_deletion_journals WHERE target_kind='workspace' AND target_id=OLD.id),coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='workspace' AND target_id=OLD.id)),0)+row_number() OVER(ORDER BY kind,target_id)-1,kind,target_id FROM (
 SELECT DISTINCT 'job' AS kind,runtime_instance_id AS target_id FROM v2_jobs WHERE workspace_id=OLD.id
 UNION SELECT 'job',target_id FROM v2_outbox WHERE kind='job_dispatch' AND operation_id IN (SELECT operation_id FROM v2_jobs WHERE workspace_id=OLD.id)
 UNION SELECT 'blob',id FROM v2_blobs WHERE reservation_id IN (SELECT id FROM v2_storage_reservations WHERE workspace_id=OLD.id)
 UNION SELECT 'reservation',id FROM v2_storage_reservations WHERE workspace_id=OLD.id) AS resources
 WHERE NOT EXISTS(SELECT 1 FROM v2_deletion_targets d WHERE d.journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='workspace' AND target_id=OLD.id) AND d.kind=resources.kind AND d.target_id=resources.target_id)
 ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
 UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE (reservation_id IN (SELECT id FROM v2_storage_reservations WHERE workspace_id=OLD.id)) AND state!='deleted';
 UPDATE v2_jobs SET status='cancelled',failure_code=NULL,retryable=0,lease_token=NULL,lease_until=NULL,fencing=fencing+1 WHERE (workspace_id=OLD.id) AND status IN ('queued','running','validating','failed');
 UPDATE v2_operations SET state='cancelled' WHERE id IN (SELECT operation_id FROM v2_jobs WHERE workspace_id=OLD.id) AND state IN ('admitted','failed','ambiguous');

 UPDATE v2_monthly_budget SET reserved_krw=reserved_krw-coalesce((SELECT sum(reserved_krw) FROM v2_cost_attempts a WHERE a.month=v2_monthly_budget.month AND a.state='reserved' AND a.operation_id IN (SELECT id FROM v2_operations WHERE workspace_id=OLD.id)),0),
 ambiguous_krw=ambiguous_krw+coalesce((SELECT sum(reserved_krw) FROM v2_cost_attempts a WHERE a.month=v2_monthly_budget.month AND a.state='reserved' AND a.operation_id IN (SELECT id FROM v2_operations WHERE workspace_id=OLD.id)),0);
 INSERT INTO v2_cost_receipts(id,attempt_id,previous_state,next_state) SELECT lower(hex(randomblob(16))),id,'reserved','ambiguous' FROM v2_cost_attempts WHERE state='reserved' AND operation_id IN (SELECT id FROM v2_operations WHERE workspace_id=OLD.id);
 UPDATE v2_cost_attempts SET state='ambiguous' WHERE state='reserved' AND operation_id IN (SELECT id FROM v2_operations WHERE workspace_id=OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER v2_capture_file_delete BEFORE DELETE ON v2_files BEGIN
 INSERT INTO v2_tombstones VALUES('file',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;
 DELETE FROM v2_reports WHERE id IN (SELECT report_id FROM v2_report_selections WHERE file_id=OLD.id);

 INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at)
 VALUES(lower(hex(randomblob(16))),'file',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(target_kind,target_id) DO NOTHING;
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id)
 SELECT (SELECT id FROM v2_deletion_journals WHERE target_kind='file' AND target_id=OLD.id),coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='file' AND target_id=OLD.id)),0)+row_number() OVER(ORDER BY kind,target_id)-1,kind,target_id FROM (
 SELECT DISTINCT 'job' AS kind,runtime_instance_id AS target_id FROM v2_jobs WHERE target_kind='file' AND target_id=OLD.id
 UNION SELECT 'job',target_id FROM v2_outbox WHERE kind='job_dispatch' AND operation_id IN (SELECT operation_id FROM v2_jobs WHERE target_kind='file' AND target_id=OLD.id)
 UNION SELECT 'blob',id FROM v2_blobs WHERE reservation_id IN (SELECT id FROM v2_storage_reservations WHERE entity_id=OLD.id) OR id IN (SELECT blob_id FROM v2_file_derivatives WHERE file_id=OLD.id)
 UNION SELECT 'reservation',id FROM v2_storage_reservations WHERE entity_id=OLD.id) AS resources
 WHERE NOT EXISTS(SELECT 1 FROM v2_deletion_targets d WHERE d.journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='file' AND target_id=OLD.id) AND d.kind=resources.kind AND d.target_id=resources.target_id)
 ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
 UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE (reservation_id IN (SELECT id FROM v2_storage_reservations WHERE entity_id=OLD.id) OR id IN (SELECT blob_id FROM v2_file_derivatives WHERE file_id=OLD.id)) AND state!='deleted';
 UPDATE v2_jobs SET status='cancelled',failure_code=NULL,retryable=0,lease_token=NULL,lease_until=NULL,fencing=fencing+1 WHERE (target_kind='file' AND target_id=OLD.id) AND status IN ('queued','running','validating','failed');
 UPDATE v2_operations SET state='cancelled' WHERE id IN (SELECT operation_id FROM v2_jobs WHERE target_kind='file' AND target_id=OLD.id) AND state IN ('admitted','failed','ambiguous');

 DELETE FROM v2_private_snapshots WHERE target_id=OLD.id AND purpose IN ('file_manifest','file_coverage');
END;
--> statement-breakpoint
CREATE TRIGGER v2_capture_report_delete BEFORE DELETE ON v2_reports BEGIN
 INSERT INTO v2_tombstones VALUES('report',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;

 INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at)
 VALUES(lower(hex(randomblob(16))),'report',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(target_kind,target_id) DO NOTHING;
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id)
 SELECT (SELECT id FROM v2_deletion_journals WHERE target_kind='report' AND target_id=OLD.id),coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='report' AND target_id=OLD.id)),0)+row_number() OVER(ORDER BY kind,target_id)-1,kind,target_id FROM (
 SELECT DISTINCT 'job' AS kind,runtime_instance_id AS target_id FROM v2_jobs WHERE target_kind='report' AND target_id=OLD.id
 UNION SELECT 'job',target_id FROM v2_outbox WHERE kind='job_dispatch' AND operation_id IN (SELECT operation_id FROM v2_jobs WHERE target_kind='report' AND target_id=OLD.id)
 UNION SELECT 'blob',id FROM v2_blobs WHERE id=OLD.pdf_blob_id OR id=OLD.zip_blob_id OR reservation_id IN (SELECT id FROM v2_storage_reservations WHERE operation_id=OLD.operation_id)
 UNION SELECT 'reservation',id FROM v2_storage_reservations WHERE operation_id=OLD.operation_id) AS resources
 WHERE NOT EXISTS(SELECT 1 FROM v2_deletion_targets d WHERE d.journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='report' AND target_id=OLD.id) AND d.kind=resources.kind AND d.target_id=resources.target_id)
 ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
 UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE (id=OLD.pdf_blob_id OR id=OLD.zip_blob_id OR reservation_id IN (SELECT id FROM v2_storage_reservations WHERE operation_id=OLD.operation_id)) AND state!='deleted';
 UPDATE v2_jobs SET status='cancelled',failure_code=NULL,retryable=0,lease_token=NULL,lease_until=NULL,fencing=fencing+1 WHERE (target_kind='report' AND target_id=OLD.id) AND status IN ('queued','running','validating','failed');
 UPDATE v2_operations SET state='cancelled' WHERE id IN (SELECT operation_id FROM v2_jobs WHERE target_kind='report' AND target_id=OLD.id) AND state IN ('admitted','failed','ambiguous');

 DELETE FROM v2_private_snapshots WHERE target_id=OLD.id AND purpose='report';
END;
--> statement-breakpoint
CREATE TRIGGER v2_capture_profile_delete BEFORE DELETE ON v2_profiles BEGIN
 INSERT INTO v2_tombstones VALUES('profile',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;

 INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at)
 VALUES(lower(hex(randomblob(16))),'profile',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(target_kind,target_id) DO NOTHING;
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id)
 SELECT (SELECT id FROM v2_deletion_journals WHERE target_kind='profile' AND target_id=OLD.id),coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='profile' AND target_id=OLD.id)),0)+row_number() OVER(ORDER BY kind,target_id)-1,kind,target_id FROM (
 SELECT DISTINCT 'job' AS kind,runtime_instance_id AS target_id FROM v2_jobs WHERE profile_id=OLD.id
 UNION SELECT 'job',target_id FROM v2_outbox WHERE kind='job_dispatch' AND operation_id IN (SELECT operation_id FROM v2_jobs WHERE profile_id=OLD.id)
 UNION SELECT 'blob',id FROM v2_blobs WHERE reservation_id IN (SELECT r.id FROM v2_storage_reservations r JOIN v2_assets a ON a.id=r.entity_id WHERE a.profile_id=OLD.id)
 UNION SELECT 'reservation',id FROM v2_storage_reservations WHERE entity_id IN (SELECT id FROM v2_assets WHERE profile_id=OLD.id)) AS resources
 WHERE NOT EXISTS(SELECT 1 FROM v2_deletion_targets d WHERE d.journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='profile' AND target_id=OLD.id) AND d.kind=resources.kind AND d.target_id=resources.target_id)
 ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
 UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE (reservation_id IN (SELECT r.id FROM v2_storage_reservations r JOIN v2_assets a ON a.id=r.entity_id WHERE a.profile_id=OLD.id)) AND state!='deleted';
 UPDATE v2_jobs SET status='cancelled',failure_code=NULL,retryable=0,lease_token=NULL,lease_until=NULL,fencing=fencing+1 WHERE (profile_id=OLD.id) AND status IN ('queued','running','validating','failed');
 UPDATE v2_operations SET state='cancelled' WHERE id IN (SELECT operation_id FROM v2_jobs WHERE profile_id=OLD.id) AND state IN ('admitted','failed','ambiguous');

 DELETE FROM v2_private_snapshots WHERE target_id=OLD.id AND purpose='profile_revision';
END;
--> statement-breakpoint
CREATE TRIGGER v2_capture_asset_delete BEFORE DELETE ON v2_assets BEGIN
 INSERT INTO v2_tombstones VALUES('asset',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;

 INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at)
 VALUES(lower(hex(randomblob(16))),'asset',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(target_kind,target_id) DO NOTHING;
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id)
 SELECT (SELECT id FROM v2_deletion_journals WHERE target_kind='asset' AND target_id=OLD.id),coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='asset' AND target_id=OLD.id)),0)+row_number() OVER(ORDER BY kind,target_id)-1,kind,target_id FROM (
 SELECT DISTINCT 'job' AS kind,runtime_instance_id AS target_id FROM v2_jobs WHERE target_kind='profile_asset' AND target_id=OLD.id
 UNION SELECT 'job',target_id FROM v2_outbox WHERE kind='job_dispatch' AND operation_id IN (SELECT operation_id FROM v2_jobs WHERE target_kind='profile_asset' AND target_id=OLD.id)
 UNION SELECT 'blob',id FROM v2_blobs WHERE reservation_id IN (SELECT id FROM v2_storage_reservations WHERE entity_id=OLD.id)
 UNION SELECT 'reservation',id FROM v2_storage_reservations WHERE entity_id=OLD.id) AS resources
 WHERE NOT EXISTS(SELECT 1 FROM v2_deletion_targets d WHERE d.journal_id=(SELECT id FROM v2_deletion_journals WHERE target_kind='asset' AND target_id=OLD.id) AND d.kind=resources.kind AND d.target_id=resources.target_id)
 ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
 UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE (reservation_id IN (SELECT id FROM v2_storage_reservations WHERE entity_id=OLD.id)) AND state!='deleted';
 UPDATE v2_jobs SET status='cancelled',failure_code=NULL,retryable=0,lease_token=NULL,lease_until=NULL,fencing=fencing+1 WHERE (target_kind='profile_asset' AND target_id=OLD.id) AND status IN ('queued','running','validating','failed');
 UPDATE v2_operations SET state='cancelled' WHERE id IN (SELECT operation_id FROM v2_jobs WHERE target_kind='profile_asset' AND target_id=OLD.id) AND state IN ('admitted','failed','ambiguous');

 DELETE FROM v2_public_profiles WHERE profile_id IN (SELECT profile_id FROM v2_public_assets WHERE asset_id=OLD.id);
 UPDATE v2_profiles SET approved_revision_id=NULL WHERE id=OLD.profile_id AND NOT EXISTS(SELECT 1 FROM v2_public_profiles WHERE profile_id=OLD.profile_id);
 UPDATE v2_applications SET status='withdrawn',withdrawn_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (SELECT application_id FROM v2_application_assets WHERE asset_id=OLD.id) AND status IN ('submitted','approved','rejected');
 DELETE FROM v2_role_bindings WHERE owner_id=OLD.owner_id AND role='verified_lawyer' AND OLD.purpose IN ('identity','lawyer_license','office');
 DELETE FROM v2_application_assets WHERE asset_id=OLD.id;
 DELETE FROM v2_profile_revision_assets WHERE asset_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER v2_verified_role_withdraw BEFORE DELETE ON v2_role_bindings WHEN OLD.role='verified_lawyer' BEGIN
 UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE id IN (SELECT pa.public_blob_id FROM v2_public_assets pa JOIN v2_profiles p ON p.id=pa.profile_id WHERE p.owner_id=OLD.owner_id) AND state!='deleted';
 INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at) SELECT lower(hex(randomblob(16))),'publication',p.approved_revision_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM v2_profiles p WHERE p.owner_id=OLD.owner_id AND p.approved_revision_id IS NOT NULL ON CONFLICT(target_kind,target_id) DO NOTHING;
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id) SELECT j.id,row_number() OVER(ORDER BY pa.public_blob_id)-1,'blob',pa.public_blob_id FROM v2_public_assets pa JOIN v2_profiles p ON p.id=pa.profile_id JOIN v2_deletion_journals j ON j.target_kind='publication' AND j.target_id=p.approved_revision_id WHERE p.owner_id=OLD.owner_id ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
 DELETE FROM v2_public_profiles WHERE profile_id IN (SELECT id FROM v2_profiles WHERE owner_id=OLD.owner_id);
 UPDATE v2_profiles SET approved_revision_id=NULL WHERE owner_id=OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER v2_applications_immutable_content BEFORE UPDATE ON v2_applications WHEN OLD.status!='draft' AND (NEW.encrypted_payload!=OLD.encrypted_payload OR NEW.revision!=OLD.revision OR NEW.id!=OLD.id OR NEW.status='draft') BEGIN SELECT RAISE(ABORT,'V2_IMMUTABLE_REVISION'); END;
--> statement-breakpoint
CREATE TRIGGER v2_profile_revisions_immutable_content BEFORE UPDATE ON v2_profile_revisions WHEN OLD.status!='draft' AND (NEW.encrypted_payload!=OLD.encrypted_payload OR NEW.revision!=OLD.revision OR NEW.id!=OLD.id OR NEW.status='draft') BEGIN SELECT RAISE(ABORT,'V2_IMMUTABLE_REVISION'); END;
--> statement-breakpoint
CREATE TRIGGER v2_snapshot_immutable_parts BEFORE UPDATE ON v2_private_parts WHEN EXISTS(SELECT 1 FROM v2_private_snapshots WHERE id=OLD.snapshot_id AND state IN ('sealed','published')) BEGIN SELECT RAISE(ABORT,'V2_IMMUTABLE_SNAPSHOT'); END;
--> statement-breakpoint
CREATE TRIGGER v2_snapshot_immutable_header BEFORE UPDATE ON v2_private_snapshots WHEN OLD.state IN ('sealed','published') AND (NEW.encrypted_payload!=OLD.encrypted_payload OR NEW.target_id!=OLD.target_id OR NEW.purpose!=OLD.purpose OR NEW.owner_id!=OLD.owner_id OR NEW.revision!=OLD.revision OR NEW.part_count!=OLD.part_count OR NEW.byte_length!=OLD.byte_length) BEGIN SELECT RAISE(ABORT,'V2_IMMUTABLE_SNAPSHOT'); END;


--> statement-breakpoint
CREATE TRIGGER v2_release_operation_delete BEFORE DELETE ON v2_operations BEGIN
 UPDATE v2_daily_usage SET cases_reserved=cases_reserved-coalesce((SELECT sum(units) FROM v2_quota_reservations r WHERE r.operation_id=OLD.id AND r.owner_id=v2_daily_usage.owner_id AND r.day=v2_daily_usage.day AND r.kind='new_case' AND r.state='reserved'),0),responses_reserved=responses_reserved-coalesce((SELECT sum(units) FROM v2_quota_reservations r WHERE r.operation_id=OLD.id AND r.owner_id=v2_daily_usage.owner_id AND r.day=v2_daily_usage.day AND r.kind='visible_response' AND r.state='reserved'),0),media_reserved=media_reserved-coalesce((SELECT sum(units) FROM v2_quota_reservations r WHERE r.operation_id=OLD.id AND r.owner_id=v2_daily_usage.owner_id AND r.day=v2_daily_usage.day AND r.kind='media' AND r.state='reserved'),0);
 UPDATE v2_quota_reservations SET state='released' WHERE operation_id=OLD.id AND state='reserved';
END;
--> statement-breakpoint
CREATE TRIGGER v2_release_cancelled_operation AFTER UPDATE OF state ON v2_operations WHEN NEW.state='cancelled' AND OLD.state!='cancelled' BEGIN
 UPDATE v2_daily_usage SET cases_reserved=cases_reserved-coalesce((SELECT sum(units) FROM v2_quota_reservations r WHERE r.operation_id=NEW.id AND r.owner_id=v2_daily_usage.owner_id AND r.day=v2_daily_usage.day AND r.kind='new_case' AND r.state='reserved'),0),responses_reserved=responses_reserved-coalesce((SELECT sum(units) FROM v2_quota_reservations r WHERE r.operation_id=NEW.id AND r.owner_id=v2_daily_usage.owner_id AND r.day=v2_daily_usage.day AND r.kind='visible_response' AND r.state='reserved'),0),media_reserved=media_reserved-coalesce((SELECT sum(units) FROM v2_quota_reservations r WHERE r.operation_id=NEW.id AND r.owner_id=v2_daily_usage.owner_id AND r.day=v2_daily_usage.day AND r.kind='media' AND r.state='reserved'),0);
 UPDATE v2_quota_reservations SET state='released' WHERE operation_id=NEW.id AND state='reserved';
END;

--> statement-breakpoint
CREATE TRIGGER v2_legacy_stage_delete BEFORE DELETE ON cases BEGIN
 DELETE FROM v2_private_snapshots WHERE id IN (SELECT snapshot_id FROM v2_upgrade_stages WHERE legacy_case_id=OLD.id) AND state IN ('staging','sealed');
END;

--> statement-breakpoint
CREATE TRIGGER v2_public_asset_delete BEFORE DELETE ON v2_public_assets BEGIN
 INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at) VALUES(lower(hex(randomblob(16))),'publication',OLD.revision_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(target_kind,target_id) DO NOTHING;
 INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id) SELECT j.id,coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=j.id),0),'blob',OLD.public_blob_id FROM v2_deletion_journals j WHERE j.target_kind='publication' AND j.target_id=OLD.revision_id ON CONFLICT(journal_id,kind,target_id) DO NOTHING;
 UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE id=OLD.public_blob_id AND state!='deleted';
END;
--> statement-breakpoint
CREATE TRIGGER v2_cancel_cost_preserve AFTER UPDATE OF state ON v2_operations WHEN NEW.state='cancelled' AND OLD.state!='cancelled' BEGIN
 UPDATE v2_monthly_budget SET reserved_krw=reserved_krw-coalesce((SELECT sum(reserved_krw) FROM v2_cost_attempts a WHERE a.month=v2_monthly_budget.month AND a.state='reserved' AND a.operation_id=NEW.id),0),ambiguous_krw=ambiguous_krw+coalesce((SELECT sum(reserved_krw) FROM v2_cost_attempts a WHERE a.month=v2_monthly_budget.month AND a.state='reserved' AND a.operation_id=NEW.id),0);
 INSERT INTO v2_cost_receipts(id,attempt_id,previous_state,next_state) SELECT lower(hex(randomblob(16))),id,'reserved','ambiguous' FROM v2_cost_attempts WHERE state='reserved' AND operation_id=NEW.id;
 UPDATE v2_cost_attempts SET state='ambiguous' WHERE state='reserved' AND operation_id=NEW.id;
END;

--> statement-breakpoint
CREATE TRIGGER v2_sealed_part_insert BEFORE INSERT ON v2_private_parts WHEN EXISTS(SELECT 1 FROM v2_private_snapshots WHERE id=NEW.snapshot_id AND state='sealed') BEGIN SELECT RAISE(ABORT,'V2_IMMUTABLE_SNAPSHOT'); END;

--> statement-breakpoint
-- All D1 INTEGER metadata is nonnegative and exactly JS-safe.
CREATE TRIGGER v2_actions_safe_integer_insert BEFORE INSERT ON "v2_actions" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_actions_safe_integer_update BEFORE UPDATE ON "v2_actions" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_allocation_acknowledgments_safe_integer_insert BEFORE INSERT ON "v2_allocation_acknowledgments" WHEN (NEW."version" IS NOT NULL AND (typeof(NEW."version")!='integer' OR NEW."version"<0 OR NEW."version">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_allocation_acknowledgments_safe_integer_update BEFORE UPDATE ON "v2_allocation_acknowledgments" WHEN (NEW."version" IS NOT NULL AND (typeof(NEW."version")!='integer' OR NEW."version"<0 OR NEW."version">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_answers_safe_integer_insert BEFORE INSERT ON "v2_answers" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_answers_safe_integer_update BEFORE UPDATE ON "v2_answers" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_applications_safe_integer_insert BEFORE INSERT ON "v2_applications" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_applications_safe_integer_update BEFORE UPDATE ON "v2_applications" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_assets_safe_integer_insert BEFORE INSERT ON "v2_assets" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_assets_safe_integer_update BEFORE UPDATE ON "v2_assets" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_blobs_safe_integer_insert BEFORE INSERT ON "v2_blobs" WHEN (NEW."logical_bytes" IS NOT NULL AND (typeof(NEW."logical_bytes")!='integer' OR NEW."logical_bytes"<0 OR NEW."logical_bytes">9007199254740991)) OR (NEW."cipher_bytes" IS NOT NULL AND (typeof(NEW."cipher_bytes")!='integer' OR NEW."cipher_bytes"<0 OR NEW."cipher_bytes">9007199254740991)) OR (NEW."source_asset_revision" IS NOT NULL AND (typeof(NEW."source_asset_revision")!='integer' OR NEW."source_asset_revision"<0 OR NEW."source_asset_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_blobs_safe_integer_update BEFORE UPDATE ON "v2_blobs" WHEN (NEW."logical_bytes" IS NOT NULL AND (typeof(NEW."logical_bytes")!='integer' OR NEW."logical_bytes"<0 OR NEW."logical_bytes">9007199254740991)) OR (NEW."cipher_bytes" IS NOT NULL AND (typeof(NEW."cipher_bytes")!='integer' OR NEW."cipher_bytes"<0 OR NEW."cipher_bytes">9007199254740991)) OR (NEW."source_asset_revision" IS NOT NULL AND (typeof(NEW."source_asset_revision")!='integer' OR NEW."source_asset_revision"<0 OR NEW."source_asset_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_budget_allocations_safe_integer_insert BEFORE INSERT ON "v2_budget_allocations" WHEN (NEW."version" IS NOT NULL AND (typeof(NEW."version")!='integer' OR NEW."version"<0 OR NEW."version">9007199254740991)) OR (NEW."preview_krw" IS NOT NULL AND (typeof(NEW."preview_krw")!='integer' OR NEW."preview_krw"<0 OR NEW."preview_krw">9007199254740991)) OR (NEW."production_krw" IS NOT NULL AND (typeof(NEW."production_krw")!='integer' OR NEW."production_krw"<0 OR NEW."production_krw">9007199254740991)) OR (NEW."shared_fixed_krw" IS NOT NULL AND (typeof(NEW."shared_fixed_krw")!='integer' OR NEW."shared_fixed_krw"<0 OR NEW."shared_fixed_krw">9007199254740991)) OR (NEW."maintenance_reserve_krw" IS NOT NULL AND (typeof(NEW."maintenance_reserve_krw")!='integer' OR NEW."maintenance_reserve_krw"<0 OR NEW."maintenance_reserve_krw">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_budget_allocations_safe_integer_update BEFORE UPDATE ON "v2_budget_allocations" WHEN (NEW."version" IS NOT NULL AND (typeof(NEW."version")!='integer' OR NEW."version"<0 OR NEW."version">9007199254740991)) OR (NEW."preview_krw" IS NOT NULL AND (typeof(NEW."preview_krw")!='integer' OR NEW."preview_krw"<0 OR NEW."preview_krw">9007199254740991)) OR (NEW."production_krw" IS NOT NULL AND (typeof(NEW."production_krw")!='integer' OR NEW."production_krw"<0 OR NEW."production_krw">9007199254740991)) OR (NEW."shared_fixed_krw" IS NOT NULL AND (typeof(NEW."shared_fixed_krw")!='integer' OR NEW."shared_fixed_krw"<0 OR NEW."shared_fixed_krw">9007199254740991)) OR (NEW."maintenance_reserve_krw" IS NOT NULL AND (typeof(NEW."maintenance_reserve_krw")!='integer' OR NEW."maintenance_reserve_krw"<0 OR NEW."maintenance_reserve_krw">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_case_original_usage_safe_integer_insert BEFORE INSERT ON "v2_case_original_usage" WHEN (NEW."stored_count" IS NOT NULL AND (typeof(NEW."stored_count")!='integer' OR NEW."stored_count"<0 OR NEW."stored_count">9007199254740991)) OR (NEW."reserved_count" IS NOT NULL AND (typeof(NEW."reserved_count")!='integer' OR NEW."reserved_count"<0 OR NEW."reserved_count">9007199254740991)) OR (NEW."stored_bytes" IS NOT NULL AND (typeof(NEW."stored_bytes")!='integer' OR NEW."stored_bytes"<0 OR NEW."stored_bytes">9007199254740991)) OR (NEW."reserved_bytes" IS NOT NULL AND (typeof(NEW."reserved_bytes")!='integer' OR NEW."reserved_bytes"<0 OR NEW."reserved_bytes">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_case_original_usage_safe_integer_update BEFORE UPDATE ON "v2_case_original_usage" WHEN (NEW."stored_count" IS NOT NULL AND (typeof(NEW."stored_count")!='integer' OR NEW."stored_count"<0 OR NEW."stored_count">9007199254740991)) OR (NEW."reserved_count" IS NOT NULL AND (typeof(NEW."reserved_count")!='integer' OR NEW."reserved_count"<0 OR NEW."reserved_count">9007199254740991)) OR (NEW."stored_bytes" IS NOT NULL AND (typeof(NEW."stored_bytes")!='integer' OR NEW."stored_bytes"<0 OR NEW."stored_bytes">9007199254740991)) OR (NEW."reserved_bytes" IS NOT NULL AND (typeof(NEW."reserved_bytes")!='integer' OR NEW."reserved_bytes"<0 OR NEW."reserved_bytes">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_citation_bindings_safe_integer_insert BEFORE INSERT ON "v2_citation_bindings" WHEN (NEW."snapshot_revision" IS NOT NULL AND (typeof(NEW."snapshot_revision")!='integer' OR NEW."snapshot_revision"<0 OR NEW."snapshot_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_citation_bindings_safe_integer_update BEFORE UPDATE ON "v2_citation_bindings" WHEN (NEW."snapshot_revision" IS NOT NULL AND (typeof(NEW."snapshot_revision")!='integer' OR NEW."snapshot_revision"<0 OR NEW."snapshot_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_consents_safe_integer_insert BEFORE INSERT ON "v2_consents" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_consents_safe_integer_update BEFORE UPDATE ON "v2_consents" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_cost_attempts_safe_integer_insert BEFORE INSERT ON "v2_cost_attempts" WHEN (NEW."attempt" IS NOT NULL AND (typeof(NEW."attempt")!='integer' OR NEW."attempt"<0 OR NEW."attempt">9007199254740991)) OR (NEW."reserved_krw" IS NOT NULL AND (typeof(NEW."reserved_krw")!='integer' OR NEW."reserved_krw"<0 OR NEW."reserved_krw">9007199254740991)) OR (NEW."charged_krw" IS NOT NULL AND (typeof(NEW."charged_krw")!='integer' OR NEW."charged_krw"<0 OR NEW."charged_krw">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_cost_attempts_safe_integer_update BEFORE UPDATE ON "v2_cost_attempts" WHEN (NEW."attempt" IS NOT NULL AND (typeof(NEW."attempt")!='integer' OR NEW."attempt"<0 OR NEW."attempt">9007199254740991)) OR (NEW."reserved_krw" IS NOT NULL AND (typeof(NEW."reserved_krw")!='integer' OR NEW."reserved_krw"<0 OR NEW."reserved_krw">9007199254740991)) OR (NEW."charged_krw" IS NOT NULL AND (typeof(NEW."charged_krw")!='integer' OR NEW."charged_krw"<0 OR NEW."charged_krw">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_cost_quotes_safe_integer_insert BEFORE INSERT ON "v2_cost_quotes" WHEN (NEW."version" IS NOT NULL AND (typeof(NEW."version")!='integer' OR NEW."version"<0 OR NEW."version">9007199254740991)) OR (NEW."estimated_krw" IS NOT NULL AND (typeof(NEW."estimated_krw")!='integer' OR NEW."estimated_krw"<0 OR NEW."estimated_krw">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_cost_quotes_safe_integer_update BEFORE UPDATE ON "v2_cost_quotes" WHEN (NEW."version" IS NOT NULL AND (typeof(NEW."version")!='integer' OR NEW."version"<0 OR NEW."version">9007199254740991)) OR (NEW."estimated_krw" IS NOT NULL AND (typeof(NEW."estimated_krw")!='integer' OR NEW."estimated_krw"<0 OR NEW."estimated_krw">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_daily_usage_safe_integer_insert BEFORE INSERT ON "v2_daily_usage" WHEN (NEW."cases_used" IS NOT NULL AND (typeof(NEW."cases_used")!='integer' OR NEW."cases_used"<0 OR NEW."cases_used">9007199254740991)) OR (NEW."cases_reserved" IS NOT NULL AND (typeof(NEW."cases_reserved")!='integer' OR NEW."cases_reserved"<0 OR NEW."cases_reserved">9007199254740991)) OR (NEW."responses_used" IS NOT NULL AND (typeof(NEW."responses_used")!='integer' OR NEW."responses_used"<0 OR NEW."responses_used">9007199254740991)) OR (NEW."responses_reserved" IS NOT NULL AND (typeof(NEW."responses_reserved")!='integer' OR NEW."responses_reserved"<0 OR NEW."responses_reserved">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_daily_usage_safe_integer_update BEFORE UPDATE ON "v2_daily_usage" WHEN (NEW."cases_used" IS NOT NULL AND (typeof(NEW."cases_used")!='integer' OR NEW."cases_used"<0 OR NEW."cases_used">9007199254740991)) OR (NEW."cases_reserved" IS NOT NULL AND (typeof(NEW."cases_reserved")!='integer' OR NEW."cases_reserved"<0 OR NEW."cases_reserved">9007199254740991)) OR (NEW."responses_used" IS NOT NULL AND (typeof(NEW."responses_used")!='integer' OR NEW."responses_used"<0 OR NEW."responses_used">9007199254740991)) OR (NEW."responses_reserved" IS NOT NULL AND (typeof(NEW."responses_reserved")!='integer' OR NEW."responses_reserved"<0 OR NEW."responses_reserved">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_deletion_journals_safe_integer_insert BEFORE INSERT ON "v2_deletion_journals" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."fencing" IS NOT NULL AND (typeof(NEW."fencing")!='integer' OR NEW."fencing"<0 OR NEW."fencing">9007199254740991)) OR (NEW."cursor" IS NOT NULL AND (typeof(NEW."cursor")!='integer' OR NEW."cursor"<0 OR NEW."cursor">9007199254740991)) OR (NEW."attempts" IS NOT NULL AND (typeof(NEW."attempts")!='integer' OR NEW."attempts"<0 OR NEW."attempts">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_deletion_journals_safe_integer_update BEFORE UPDATE ON "v2_deletion_journals" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."fencing" IS NOT NULL AND (typeof(NEW."fencing")!='integer' OR NEW."fencing"<0 OR NEW."fencing">9007199254740991)) OR (NEW."cursor" IS NOT NULL AND (typeof(NEW."cursor")!='integer' OR NEW."cursor"<0 OR NEW."cursor">9007199254740991)) OR (NEW."attempts" IS NOT NULL AND (typeof(NEW."attempts")!='integer' OR NEW."attempts"<0 OR NEW."attempts">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_deletion_targets_safe_integer_insert BEFORE INSERT ON "v2_deletion_targets" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_deletion_targets_safe_integer_update BEFORE UPDATE ON "v2_deletion_targets" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_items_safe_integer_insert BEFORE INSERT ON "v2_directory_items" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_items_safe_integer_update BEFORE UPDATE ON "v2_directory_items" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_snapshots_safe_integer_insert BEFORE INSERT ON "v2_directory_snapshots" WHEN (NEW."item_count" IS NOT NULL AND (typeof(NEW."item_count")!='integer' OR NEW."item_count"<0 OR NEW."item_count">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_directory_snapshots_safe_integer_update BEFORE UPDATE ON "v2_directory_snapshots" WHEN (NEW."item_count" IS NOT NULL AND (typeof(NEW."item_count")!='integer' OR NEW."item_count"<0 OR NEW."item_count">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_fact_references_safe_integer_insert BEFORE INSERT ON "v2_fact_references" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) OR (NEW."source_revision" IS NOT NULL AND (typeof(NEW."source_revision")!='integer' OR NEW."source_revision"<0 OR NEW."source_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_fact_references_safe_integer_update BEFORE UPDATE ON "v2_fact_references" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) OR (NEW."source_revision" IS NOT NULL AND (typeof(NEW."source_revision")!='integer' OR NEW."source_revision"<0 OR NEW."source_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_facts_safe_integer_insert BEFORE INSERT ON "v2_facts" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."summary_revision" IS NOT NULL AND (typeof(NEW."summary_revision")!='integer' OR NEW."summary_revision"<0 OR NEW."summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_facts_safe_integer_update BEFORE UPDATE ON "v2_facts" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."summary_revision" IS NOT NULL AND (typeof(NEW."summary_revision")!='integer' OR NEW."summary_revision"<0 OR NEW."summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_file_derivatives_safe_integer_insert BEFORE INSERT ON "v2_file_derivatives" WHEN (NEW."file_revision" IS NOT NULL AND (typeof(NEW."file_revision")!='integer' OR NEW."file_revision"<0 OR NEW."file_revision">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_file_derivatives_safe_integer_update BEFORE UPDATE ON "v2_file_derivatives" WHEN (NEW."file_revision" IS NOT NULL AND (typeof(NEW."file_revision")!='integer' OR NEW."file_revision"<0 OR NEW."file_revision">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_file_edit_receipts_safe_integer_insert BEFORE INSERT ON "v2_file_edit_receipts" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_file_edit_receipts_safe_integer_update BEFORE UPDATE ON "v2_file_edit_receipts" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_file_edit_stages_safe_integer_insert BEFORE INSERT ON "v2_file_edit_stages" WHEN (NEW."source_revision" IS NOT NULL AND (typeof(NEW."source_revision")!='integer' OR NEW."source_revision"<0 OR NEW."source_revision">9007199254740991)) OR (NEW."target_revision" IS NOT NULL AND (typeof(NEW."target_revision")!='integer' OR NEW."target_revision"<0 OR NEW."target_revision">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) OR (NEW."observation_count" IS NOT NULL AND (typeof(NEW."observation_count")!='integer' OR NEW."observation_count"<0 OR NEW."observation_count">9007199254740991)) OR (NEW."derivative_count" IS NOT NULL AND (typeof(NEW."derivative_count")!='integer' OR NEW."derivative_count"<0 OR NEW."derivative_count">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_file_edit_stages_safe_integer_update BEFORE UPDATE ON "v2_file_edit_stages" WHEN (NEW."source_revision" IS NOT NULL AND (typeof(NEW."source_revision")!='integer' OR NEW."source_revision"<0 OR NEW."source_revision">9007199254740991)) OR (NEW."target_revision" IS NOT NULL AND (typeof(NEW."target_revision")!='integer' OR NEW."target_revision"<0 OR NEW."target_revision">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) OR (NEW."observation_count" IS NOT NULL AND (typeof(NEW."observation_count")!='integer' OR NEW."observation_count"<0 OR NEW."observation_count">9007199254740991)) OR (NEW."derivative_count" IS NOT NULL AND (typeof(NEW."derivative_count")!='integer' OR NEW."derivative_count"<0 OR NEW."derivative_count">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_file_observations_safe_integer_insert BEFORE INSERT ON "v2_file_observations" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."file_revision" IS NOT NULL AND (typeof(NEW."file_revision")!='integer' OR NEW."file_revision"<0 OR NEW."file_revision">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_file_observations_safe_integer_update BEFORE UPDATE ON "v2_file_observations" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."file_revision" IS NOT NULL AND (typeof(NEW."file_revision")!='integer' OR NEW."file_revision"<0 OR NEW."file_revision">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_files_safe_integer_insert BEFORE INSERT ON "v2_files" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."declared_bytes" IS NOT NULL AND (typeof(NEW."declared_bytes")!='integer' OR NEW."declared_bytes"<0 OR NEW."declared_bytes">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_files_safe_integer_update BEFORE UPDATE ON "v2_files" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."declared_bytes" IS NOT NULL AND (typeof(NEW."declared_bytes")!='integer' OR NEW."declared_bytes"<0 OR NEW."declared_bytes">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_intakes_safe_integer_insert BEFORE INSERT ON "v2_intakes" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."confirmed_summary_revision" IS NOT NULL AND (typeof(NEW."confirmed_summary_revision")!='integer' OR NEW."confirmed_summary_revision"<0 OR NEW."confirmed_summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_intakes_safe_integer_update BEFORE UPDATE ON "v2_intakes" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."confirmed_summary_revision" IS NOT NULL AND (typeof(NEW."confirmed_summary_revision")!='integer' OR NEW."confirmed_summary_revision"<0 OR NEW."confirmed_summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_job_checkpoints_safe_integer_insert BEFORE INSERT ON "v2_job_checkpoints" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."fencing" IS NOT NULL AND (typeof(NEW."fencing")!='integer' OR NEW."fencing"<0 OR NEW."fencing">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_job_checkpoints_safe_integer_update BEFORE UPDATE ON "v2_job_checkpoints" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."fencing" IS NOT NULL AND (typeof(NEW."fencing")!='integer' OR NEW."fencing"<0 OR NEW."fencing">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_jobs_safe_integer_insert BEFORE INSERT ON "v2_jobs" WHEN (NEW."target_revision" IS NOT NULL AND (typeof(NEW."target_revision")!='integer' OR NEW."target_revision"<0 OR NEW."target_revision">9007199254740991)) OR (NEW."progress" IS NOT NULL AND (typeof(NEW."progress")!='integer' OR NEW."progress"<0 OR NEW."progress">9007199254740991)) OR (NEW."attempts" IS NOT NULL AND (typeof(NEW."attempts")!='integer' OR NEW."attempts"<0 OR NEW."attempts">9007199254740991)) OR (NEW."fencing" IS NOT NULL AND (typeof(NEW."fencing")!='integer' OR NEW."fencing"<0 OR NEW."fencing">9007199254740991)) OR (NEW."retryable" IS NOT NULL AND (typeof(NEW."retryable")!='integer' OR NEW."retryable"<0 OR NEW."retryable">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_jobs_safe_integer_update BEFORE UPDATE ON "v2_jobs" WHEN (NEW."target_revision" IS NOT NULL AND (typeof(NEW."target_revision")!='integer' OR NEW."target_revision"<0 OR NEW."target_revision">9007199254740991)) OR (NEW."progress" IS NOT NULL AND (typeof(NEW."progress")!='integer' OR NEW."progress"<0 OR NEW."progress">9007199254740991)) OR (NEW."attempts" IS NOT NULL AND (typeof(NEW."attempts")!='integer' OR NEW."attempts"<0 OR NEW."attempts">9007199254740991)) OR (NEW."fencing" IS NOT NULL AND (typeof(NEW."fencing")!='integer' OR NEW."fencing"<0 OR NEW."fencing">9007199254740991)) OR (NEW."retryable" IS NOT NULL AND (typeof(NEW."retryable")!='integer' OR NEW."retryable"<0 OR NEW."retryable">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_messages_safe_integer_insert BEFORE INSERT ON "v2_messages" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_messages_safe_integer_update BEFORE UPDATE ON "v2_messages" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_moderation_decisions_safe_integer_insert BEFORE INSERT ON "v2_moderation_decisions" WHEN (NEW."target_revision" IS NOT NULL AND (typeof(NEW."target_revision")!='integer' OR NEW."target_revision"<0 OR NEW."target_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_moderation_decisions_safe_integer_update BEFORE UPDATE ON "v2_moderation_decisions" WHEN (NEW."target_revision" IS NOT NULL AND (typeof(NEW."target_revision")!='integer' OR NEW."target_revision"<0 OR NEW."target_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_moderation_reports_safe_integer_insert BEFORE INSERT ON "v2_moderation_reports" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_moderation_reports_safe_integer_update BEFORE UPDATE ON "v2_moderation_reports" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_monthly_budget_safe_integer_insert BEFORE INSERT ON "v2_monthly_budget" WHEN (NEW."allocation_version" IS NOT NULL AND (typeof(NEW."allocation_version")!='integer' OR NEW."allocation_version"<0 OR NEW."allocation_version">9007199254740991)) OR (NEW."limit_krw" IS NOT NULL AND (typeof(NEW."limit_krw")!='integer' OR NEW."limit_krw"<0 OR NEW."limit_krw">9007199254740991)) OR (NEW."settled_krw" IS NOT NULL AND (typeof(NEW."settled_krw")!='integer' OR NEW."settled_krw"<0 OR NEW."settled_krw">9007199254740991)) OR (NEW."reserved_krw" IS NOT NULL AND (typeof(NEW."reserved_krw")!='integer' OR NEW."reserved_krw"<0 OR NEW."reserved_krw">9007199254740991)) OR (NEW."ambiguous_krw" IS NOT NULL AND (typeof(NEW."ambiguous_krw")!='integer' OR NEW."ambiguous_krw"<0 OR NEW."ambiguous_krw">9007199254740991)) OR (NEW."fixed_maintenance_krw" IS NOT NULL AND (typeof(NEW."fixed_maintenance_krw")!='integer' OR NEW."fixed_maintenance_krw"<0 OR NEW."fixed_maintenance_krw">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_monthly_budget_safe_integer_update BEFORE UPDATE ON "v2_monthly_budget" WHEN (NEW."allocation_version" IS NOT NULL AND (typeof(NEW."allocation_version")!='integer' OR NEW."allocation_version"<0 OR NEW."allocation_version">9007199254740991)) OR (NEW."limit_krw" IS NOT NULL AND (typeof(NEW."limit_krw")!='integer' OR NEW."limit_krw"<0 OR NEW."limit_krw">9007199254740991)) OR (NEW."settled_krw" IS NOT NULL AND (typeof(NEW."settled_krw")!='integer' OR NEW."settled_krw"<0 OR NEW."settled_krw">9007199254740991)) OR (NEW."reserved_krw" IS NOT NULL AND (typeof(NEW."reserved_krw")!='integer' OR NEW."reserved_krw"<0 OR NEW."reserved_krw">9007199254740991)) OR (NEW."ambiguous_krw" IS NOT NULL AND (typeof(NEW."ambiguous_krw")!='integer' OR NEW."ambiguous_krw"<0 OR NEW."ambiguous_krw">9007199254740991)) OR (NEW."fixed_maintenance_krw" IS NOT NULL AND (typeof(NEW."fixed_maintenance_krw")!='integer' OR NEW."fixed_maintenance_krw"<0 OR NEW."fixed_maintenance_krw">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_mutation_claims_safe_integer_insert BEFORE INSERT ON "v2_mutation_claims" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."verified" IS NOT NULL AND (typeof(NEW."verified")!='integer' OR NEW."verified"<0 OR NEW."verified">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_mutation_claims_safe_integer_update BEFORE UPDATE ON "v2_mutation_claims" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."verified" IS NOT NULL AND (typeof(NEW."verified")!='integer' OR NEW."verified"<0 OR NEW."verified">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_operations_safe_integer_insert BEFORE INSERT ON "v2_operations" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_operations_safe_integer_update BEFORE UPDATE ON "v2_operations" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_outbox_safe_integer_insert BEFORE INSERT ON "v2_outbox" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."attempts" IS NOT NULL AND (typeof(NEW."attempts")!='integer' OR NEW."attempts"<0 OR NEW."attempts">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_outbox_safe_integer_update BEFORE UPDATE ON "v2_outbox" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."attempts" IS NOT NULL AND (typeof(NEW."attempts")!='integer' OR NEW."attempts"<0 OR NEW."attempts">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_parties_safe_integer_insert BEFORE INSERT ON "v2_parties" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."summary_revision" IS NOT NULL AND (typeof(NEW."summary_revision")!='integer' OR NEW."summary_revision"<0 OR NEW."summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_parties_safe_integer_update BEFORE UPDATE ON "v2_parties" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."summary_revision" IS NOT NULL AND (typeof(NEW."summary_revision")!='integer' OR NEW."summary_revision"<0 OR NEW."summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_private_parts_safe_integer_insert BEFORE INSERT ON "v2_private_parts" WHEN (NEW."part_index" IS NOT NULL AND (typeof(NEW."part_index")!='integer' OR NEW."part_index"<0 OR NEW."part_index">9007199254740991)) OR (NEW."byte_length" IS NOT NULL AND (typeof(NEW."byte_length")!='integer' OR NEW."byte_length"<0 OR NEW."byte_length">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_private_parts_safe_integer_update BEFORE UPDATE ON "v2_private_parts" WHEN (NEW."part_index" IS NOT NULL AND (typeof(NEW."part_index")!='integer' OR NEW."part_index"<0 OR NEW."part_index">9007199254740991)) OR (NEW."byte_length" IS NOT NULL AND (typeof(NEW."byte_length")!='integer' OR NEW."byte_length"<0 OR NEW."byte_length">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_private_snapshots_safe_integer_insert BEFORE INSERT ON "v2_private_snapshots" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."part_count" IS NOT NULL AND (typeof(NEW."part_count")!='integer' OR NEW."part_count"<0 OR NEW."part_count">9007199254740991)) OR (NEW."byte_length" IS NOT NULL AND (typeof(NEW."byte_length")!='integer' OR NEW."byte_length"<0 OR NEW."byte_length">9007199254740991)) OR (NEW."written_parts" IS NOT NULL AND (typeof(NEW."written_parts")!='integer' OR NEW."written_parts"<0 OR NEW."written_parts">9007199254740991)) OR (NEW."written_bytes" IS NOT NULL AND (typeof(NEW."written_bytes")!='integer' OR NEW."written_bytes"<0 OR NEW."written_bytes">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) OR (NEW."lease_fencing" IS NOT NULL AND (typeof(NEW."lease_fencing")!='integer' OR NEW."lease_fencing"<0 OR NEW."lease_fencing">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_private_snapshots_safe_integer_update BEFORE UPDATE ON "v2_private_snapshots" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."part_count" IS NOT NULL AND (typeof(NEW."part_count")!='integer' OR NEW."part_count"<0 OR NEW."part_count">9007199254740991)) OR (NEW."byte_length" IS NOT NULL AND (typeof(NEW."byte_length")!='integer' OR NEW."byte_length"<0 OR NEW."byte_length">9007199254740991)) OR (NEW."written_parts" IS NOT NULL AND (typeof(NEW."written_parts")!='integer' OR NEW."written_parts"<0 OR NEW."written_parts">9007199254740991)) OR (NEW."written_bytes" IS NOT NULL AND (typeof(NEW."written_bytes")!='integer' OR NEW."written_bytes"<0 OR NEW."written_bytes">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) OR (NEW."lease_fencing" IS NOT NULL AND (typeof(NEW."lease_fencing")!='integer' OR NEW."lease_fencing"<0 OR NEW."lease_fencing">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_profile_revision_assets_safe_integer_insert BEFORE INSERT ON "v2_profile_revision_assets" WHEN (NEW."asset_revision" IS NOT NULL AND (typeof(NEW."asset_revision")!='integer' OR NEW."asset_revision"<0 OR NEW."asset_revision">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_profile_revision_assets_safe_integer_update BEFORE UPDATE ON "v2_profile_revision_assets" WHEN (NEW."asset_revision" IS NOT NULL AND (typeof(NEW."asset_revision")!='integer' OR NEW."asset_revision"<0 OR NEW."asset_revision">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_profile_revisions_safe_integer_insert BEFORE INSERT ON "v2_profile_revisions" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_profile_revisions_safe_integer_update BEFORE UPDATE ON "v2_profile_revisions" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_profiles_safe_integer_insert BEFORE INSERT ON "v2_profiles" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_profiles_safe_integer_update BEFORE UPDATE ON "v2_profiles" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_public_profiles_safe_integer_insert BEFORE INSERT ON "v2_public_profiles" WHEN (NEW."approved_revision" IS NOT NULL AND (typeof(NEW."approved_revision")!='integer' OR NEW."approved_revision"<0 OR NEW."approved_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_public_profiles_safe_integer_update BEFORE UPDATE ON "v2_public_profiles" WHEN (NEW."approved_revision" IS NOT NULL AND (typeof(NEW."approved_revision")!='integer' OR NEW."approved_revision"<0 OR NEW."approved_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_question_batches_safe_integer_insert BEFORE INSERT ON "v2_question_batches" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) OR (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."intake_revision" IS NOT NULL AND (typeof(NEW."intake_revision")!='integer' OR NEW."intake_revision"<0 OR NEW."intake_revision">9007199254740991)) OR (NEW."question_count" IS NOT NULL AND (typeof(NEW."question_count")!='integer' OR NEW."question_count"<0 OR NEW."question_count">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_question_batches_safe_integer_update BEFORE UPDATE ON "v2_question_batches" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) OR (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."intake_revision" IS NOT NULL AND (typeof(NEW."intake_revision")!='integer' OR NEW."intake_revision"<0 OR NEW."intake_revision">9007199254740991)) OR (NEW."question_count" IS NOT NULL AND (typeof(NEW."question_count")!='integer' OR NEW."question_count"<0 OR NEW."question_count">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_report_selection_stages_safe_integer_insert BEFORE INSERT ON "v2_report_selection_stages" WHEN (NEW."file_revision" IS NOT NULL AND (typeof(NEW."file_revision")!='integer' OR NEW."file_revision"<0 OR NEW."file_revision">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_report_selection_stages_safe_integer_update BEFORE UPDATE ON "v2_report_selection_stages" WHEN (NEW."file_revision" IS NOT NULL AND (typeof(NEW."file_revision")!='integer' OR NEW."file_revision"<0 OR NEW."file_revision">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_report_selections_safe_integer_insert BEFORE INSERT ON "v2_report_selections" WHEN (NEW."file_revision" IS NOT NULL AND (typeof(NEW."file_revision")!='integer' OR NEW."file_revision"<0 OR NEW."file_revision">9007199254740991)) OR (NEW."original_selected" IS NOT NULL AND (typeof(NEW."original_selected")!='integer' OR NEW."original_selected"<0 OR NEW."original_selected">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_report_selections_safe_integer_update BEFORE UPDATE ON "v2_report_selections" WHEN (NEW."file_revision" IS NOT NULL AND (typeof(NEW."file_revision")!='integer' OR NEW."file_revision"<0 OR NEW."file_revision">9007199254740991)) OR (NEW."original_selected" IS NOT NULL AND (typeof(NEW."original_selected")!='integer' OR NEW."original_selected"<0 OR NEW."original_selected">9007199254740991)) OR (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_reports_safe_integer_insert BEFORE INSERT ON "v2_reports" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) OR (NEW."summary_revision" IS NOT NULL AND (typeof(NEW."summary_revision")!='integer' OR NEW."summary_revision"<0 OR NEW."summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_reports_safe_integer_update BEFORE UPDATE ON "v2_reports" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) OR (NEW."summary_revision" IS NOT NULL AND (typeof(NEW."summary_revision")!='integer' OR NEW."summary_revision"<0 OR NEW."summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_role_bindings_safe_integer_insert BEFORE INSERT ON "v2_role_bindings" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_role_bindings_safe_integer_update BEFORE UPDATE ON "v2_role_bindings" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_reservations_safe_integer_insert BEFORE INSERT ON "v2_storage_reservations" WHEN (NEW."byte_length" IS NOT NULL AND (typeof(NEW."byte_length")!='integer' OR NEW."byte_length"<0 OR NEW."byte_length">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_reservations_safe_integer_update BEFORE UPDATE ON "v2_storage_reservations" WHEN (NEW."byte_length" IS NOT NULL AND (typeof(NEW."byte_length")!='integer' OR NEW."byte_length"<0 OR NEW."byte_length">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_usage_safe_integer_insert BEFORE INSERT ON "v2_storage_usage" WHEN (NEW."stored_bytes" IS NOT NULL AND (typeof(NEW."stored_bytes")!='integer' OR NEW."stored_bytes"<0 OR NEW."stored_bytes">9007199254740991)) OR (NEW."reserved_bytes" IS NOT NULL AND (typeof(NEW."reserved_bytes")!='integer' OR NEW."reserved_bytes"<0 OR NEW."reserved_bytes">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_storage_usage_safe_integer_update BEFORE UPDATE ON "v2_storage_usage" WHEN (NEW."stored_bytes" IS NOT NULL AND (typeof(NEW."stored_bytes")!='integer' OR NEW."stored_bytes"<0 OR NEW."stored_bytes">9007199254740991)) OR (NEW."reserved_bytes" IS NOT NULL AND (typeof(NEW."reserved_bytes")!='integer' OR NEW."reserved_bytes"<0 OR NEW."reserved_bytes">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_summaries_safe_integer_insert BEFORE INSERT ON "v2_summaries" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."intake_revision" IS NOT NULL AND (typeof(NEW."intake_revision")!='integer' OR NEW."intake_revision"<0 OR NEW."intake_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_summaries_safe_integer_update BEFORE UPDATE ON "v2_summaries" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."intake_revision" IS NOT NULL AND (typeof(NEW."intake_revision")!='integer' OR NEW."intake_revision"<0 OR NEW."intake_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_summary_edit_cursors_safe_integer_insert BEFORE INSERT ON "v2_summary_edit_cursors" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_summary_edit_cursors_safe_integer_update BEFORE UPDATE ON "v2_summary_edit_cursors" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_summary_edit_receipts_safe_integer_insert BEFORE INSERT ON "v2_summary_edit_receipts" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_summary_edit_receipts_safe_integer_update BEFORE UPDATE ON "v2_summary_edit_receipts" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_summary_edit_stages_safe_integer_insert BEFORE INSERT ON "v2_summary_edit_stages" WHEN (NEW."source_revision" IS NOT NULL AND (typeof(NEW."source_revision")!='integer' OR NEW."source_revision"<0 OR NEW."source_revision">9007199254740991)) OR (NEW."target_revision" IS NOT NULL AND (typeof(NEW."target_revision")!='integer' OR NEW."target_revision"<0 OR NEW."target_revision">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) OR (NEW."intake_revision" IS NOT NULL AND (typeof(NEW."intake_revision")!='integer' OR NEW."intake_revision"<0 OR NEW."intake_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_summary_edit_stages_safe_integer_update BEFORE UPDATE ON "v2_summary_edit_stages" WHEN (NEW."source_revision" IS NOT NULL AND (typeof(NEW."source_revision")!='integer' OR NEW."source_revision"<0 OR NEW."source_revision">9007199254740991)) OR (NEW."target_revision" IS NOT NULL AND (typeof(NEW."target_revision")!='integer' OR NEW."target_revision"<0 OR NEW."target_revision">9007199254740991)) OR (NEW."workspace_revision" IS NOT NULL AND (typeof(NEW."workspace_revision")!='integer' OR NEW."workspace_revision"<0 OR NEW."workspace_revision">9007199254740991)) OR (NEW."intake_revision" IS NOT NULL AND (typeof(NEW."intake_revision")!='integer' OR NEW."intake_revision"<0 OR NEW."intake_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_timeline_safe_integer_insert BEFORE INSERT ON "v2_timeline" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_timeline_safe_integer_update BEFORE UPDATE ON "v2_timeline" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_upgrade_stages_safe_integer_insert BEFORE INSERT ON "v2_upgrade_stages" WHEN (NEW."source_revision" IS NOT NULL AND (typeof(NEW."source_revision")!='integer' OR NEW."source_revision"<0 OR NEW."source_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_upgrade_stages_safe_integer_update BEFORE UPDATE ON "v2_upgrade_stages" WHEN (NEW."source_revision" IS NOT NULL AND (typeof(NEW."source_revision")!='integer' OR NEW."source_revision"<0 OR NEW."source_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_upload_parts_safe_integer_insert BEFORE INSERT ON "v2_upload_parts" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) OR (NEW."byte_length" IS NOT NULL AND (typeof(NEW."byte_length")!='integer' OR NEW."byte_length"<0 OR NEW."byte_length">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_upload_parts_safe_integer_update BEFORE UPDATE ON "v2_upload_parts" WHEN (NEW."ordinal" IS NOT NULL AND (typeof(NEW."ordinal")!='integer' OR NEW."ordinal"<0 OR NEW."ordinal">9007199254740991)) OR (NEW."byte_length" IS NOT NULL AND (typeof(NEW."byte_length")!='integer' OR NEW."byte_length"<0 OR NEW."byte_length">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_upload_sessions_safe_integer_insert BEFORE INSERT ON "v2_upload_sessions" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."reserved_bytes" IS NOT NULL AND (typeof(NEW."reserved_bytes")!='integer' OR NEW."reserved_bytes"<0 OR NEW."reserved_bytes">9007199254740991)) OR (NEW."chunk_bytes" IS NOT NULL AND (typeof(NEW."chunk_bytes")!='integer' OR NEW."chunk_bytes"<0 OR NEW."chunk_bytes">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_upload_sessions_safe_integer_update BEFORE UPDATE ON "v2_upload_sessions" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."reserved_bytes" IS NOT NULL AND (typeof(NEW."reserved_bytes")!='integer' OR NEW."reserved_bytes"<0 OR NEW."reserved_bytes">9007199254740991)) OR (NEW."chunk_bytes" IS NOT NULL AND (typeof(NEW."chunk_bytes")!='integer' OR NEW."chunk_bytes"<0 OR NEW."chunk_bytes">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_workspaces_safe_integer_insert BEFORE INSERT ON "v2_workspaces" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."intake_revision" IS NOT NULL AND (typeof(NEW."intake_revision")!='integer' OR NEW."intake_revision"<0 OR NEW."intake_revision">9007199254740991)) OR (NEW."confirmed_summary_revision" IS NOT NULL AND (typeof(NEW."confirmed_summary_revision")!='integer' OR NEW."confirmed_summary_revision"<0 OR NEW."confirmed_summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
--> statement-breakpoint
CREATE TRIGGER v2_workspaces_safe_integer_update BEFORE UPDATE ON "v2_workspaces" WHEN (NEW."revision" IS NOT NULL AND (typeof(NEW."revision")!='integer' OR NEW."revision"<0 OR NEW."revision">9007199254740991)) OR (NEW."intake_revision" IS NOT NULL AND (typeof(NEW."intake_revision")!='integer' OR NEW."intake_revision"<0 OR NEW."intake_revision">9007199254740991)) OR (NEW."confirmed_summary_revision" IS NOT NULL AND (typeof(NEW."confirmed_summary_revision")!='integer' OR NEW."confirmed_summary_revision"<0 OR NEW."confirmed_summary_revision">9007199254740991)) BEGIN SELECT RAISE(ABORT,'v2_integer_bounds'); END;
