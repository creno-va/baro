import { CURRENT_POLICY_VERSIONS } from "../../src/contracts/consent";
export const DIRECTORY_NOW = "2026-10-14T00:00:00.000Z";
export const directoryOptions = {
  secret: "synthetic-directory-secret-at-least-thirty-two-characters",
  scope: "preview:synthetic-release",
  clock: () => DIRECTORY_NOW,
};
/** Synthetic public authority metadata. Payloads deliberately cannot be decrypted:
 * native query benchmarks must succeed without loading private snapshots. */
export function directorySeedSql(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 10000)
    throw new Error("SYNTHETIC_COUNT_INVALID");
  const ids = `WITH RECURSIVE numbers(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM numbers WHERE i<${count})`;
  return [
    `${ids} INSERT INTO user(id,name,email,created_at,updated_at) SELECT printf('owner-%05d',i),'Synthetic',printf('synthetic-%d@example.invalid',i),1,1 FROM numbers`,
    `INSERT INTO user_consents SELECT id,'${CURRENT_POLICY_VERSIONS.termsVersion}','${CURRENT_POLICY_VERSIONS.privacyVersion}','${CURRENT_POLICY_VERSIONS.aiNoticeVersion}',1,'${DIRECTORY_NOW}' FROM user`,
    "INSERT INTO app_metadata(key,value) SELECT 'account-type:'||id,'lawyer' FROM user",
    `${ids} INSERT INTO v2_profiles(id,owner_id,revision,created_at,updated_at,self_listing_state) SELECT printf('profile-%05d',i),printf('owner-%05d',i),1,'${DIRECTORY_NOW}','${DIRECTORY_NOW}','listed' FROM numbers`,
    `INSERT INTO v2_private_snapshots(id,owner_id,purpose,target_id,revision,part_count,byte_length,encrypted_payload,created_at) SELECT 'snapshot-'||id,owner_id,'profile_revision',id,1,1,1,'synthetic-not-decryptable','${DIRECTORY_NOW}' FROM v2_profiles`,
    `INSERT INTO v2_consents(id,owner_id,kind,version,revision,encrypted_payload,created_at) SELECT id,owner_id,'profile_publication','mvp-self-profile-public-v1',1,'synthetic-not-decryptable','${DIRECTORY_NOW}' FROM v2_private_snapshots`,
    `${ids} INSERT INTO v2_directory_entries(profile_id,owner_id,source,source_id,revision,sort_key,normalized_name,normalized_office,region,public_json,tokens_json,facets_json,refs_json,updated_at) SELECT printf('profile-%05d',i),printf('owner-%05d',i),'self',printf('snapshot-profile-%05d',i),1,printf('%08x%08x',(i*2654435761)%4294967296,i),'합성 변호사 '||i,'example office '||i,'seoul',json_object('id',printf('profile-%05d',i),'revision',1,'name','합성 변호사 '||i,'officeName','Example office '||i,'introduction','합성 공개 프로필','region','seoul','practiceAreas',json('["civil"]'),'photoUrl',NULL,'photoAssetId',NULL,'verificationStatus','self_declared'),'["b:변호","b:호사","b:ab","b:bc"]','["*|*","*|civil","seoul|*","seoul|civil"]','[]','${DIRECTORY_NOW}' FROM numbers`,
  ];
}
