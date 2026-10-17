/** The current original is aliased as s. A later conflicting observation of the
 * same public version defeats renewal; another law version does not supersede a
 * deliberately historical citation. Equal-time conflicting bodies are ambiguous.
 * Use inside the same SELECT on both sides of hashing and at publication fences. */
export const NO_NEWER_CONFLICTING_SOURCE_SQL = `NOT EXISTS (
  SELECT 1 FROM v2_official_sources newer
  WHERE newer.source_id<>s.source_id
    AND newer.source_type=s.source_type AND newer.official_id=s.official_id
    AND newer.version=s.version AND newer.section=s.section
    AND newer.extractor_version=s.extractor_version
    AND (newer.fetched_at>s.fetched_at OR
      (newer.fetched_at=s.fetched_at AND newer.verified_at>=s.verified_at))
)`;
