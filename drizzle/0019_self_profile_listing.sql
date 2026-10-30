-- Public-on-save is a lifecycle, not a user visibility preference.
-- Preserve existing encrypted private drafts; their next valid owner save publishes a new revision.
-- ADD COLUMN avoids rebuilding a parent table and cascading profile assets/approvals.
ALTER TABLE v2_profiles ADD COLUMN self_listing_state text NOT NULL DEFAULT 'unlisted'
  CONSTRAINT v2_profiles_self_listing_state_check CHECK(self_listing_state IN ('unlisted','listed'));
--> statement-breakpoint
UPDATE v2_profiles SET self_listing_state='listed'
WHERE EXISTS (
  SELECT 1 FROM v2_private_snapshots s JOIN v2_consents c ON c.id=s.id AND c.owner_id=s.owner_id
  WHERE s.target_id=v2_profiles.id AND s.owner_id=v2_profiles.owner_id
    AND s.purpose='profile_revision' AND s.state='published'
    AND c.kind='profile_publication' AND c.version='mvp-self-profile-public-v1'
    AND c.revision=s.revision
    AND s.revision=(SELECT max(revision) FROM v2_private_snapshots WHERE target_id=v2_profiles.id AND purpose='profile_revision')
) AND NOT EXISTS (
  SELECT 1 FROM v2_tombstones WHERE (target_kind='profile' AND target_id=v2_profiles.id)
    OR (target_kind='account' AND target_id=v2_profiles.owner_id)
);
--> statement-breakpoint
INSERT INTO app_metadata(key,value,updated_at) VALUES('schema_version','0019_self_profile_listing',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
