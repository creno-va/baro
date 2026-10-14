import { CURRENT_POLICY_VERSIONS } from "../../contracts/consent";
import { type DirectoryItem, directoryItemSchema, type V2PublicLawyer } from "../../contracts/v2";
import type { SelfProfile } from "../modules/lawyers/self-profile-contract";
import { sqlClaim, type V2Core } from "./v2-core";
import { runtimeDigest } from "./v2-paid-runtime";

export const normalizeDirectoryText = (value: string) => value.normalize("NFKC").toLowerCase();
export function directoryTokens(name: string, office: string) {
  const tokens = new Set<string>();
  for (const field of [name, office]) {
    const chars = [...normalizeDirectoryText(field)];
    chars.forEach((c, i) => {
      tokens.add(`c:${c}`);
      if (chars[i + 1]) tokens.add(`b:${c}${chars[i + 1]}`);
    });
  }
  return [...tokens].sort();
}
export function directoryFacets(region: string, fields: readonly string[]) {
  return [...new Set(["*", region].flatMap((r) => ["*", ...fields].map((f) => `${r}|${f}`)))];
}
export type DirectorySource = "self" | "verified";
export const selfPublicationVersions = {
  public: "mvp-self-profile-public-v1",
  private: "mvp-self-profile-private-v1",
} as const;
const selfExists = (profile: string) =>
  `EXISTS(SELECT 1 FROM v2_private_snapshots s JOIN v2_consents consent ON consent.id=s.id AND consent.owner_id=s.owner_id WHERE s.target_id=${profile} AND s.purpose='profile_revision' AND consent.kind='profile_publication' AND consent.version IN ('${selfPublicationVersions.public}','${selfPublicationVersions.private}'))`;
export const directorySelfExistsSql = selfExists;

/** Authorization metadata only. Never reads an encrypted payload, case or identity
 * material. Used before projection writes and immediately before public output. */
export function directoryEligibleSql(d = "d") {
  return `EXISTS(SELECT 1 FROM v2_profiles p WHERE p.id=${d}.profile_id AND p.owner_id=${d}.owner_id
    AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=p.owner_id) OR (target_kind='profile' AND target_id=p.id))
    AND (
      (${d}.source='self'
        AND (EXISTS(SELECT 1 FROM app_metadata WHERE key='account-type:'||p.owner_id AND value='lawyer') OR (NOT EXISTS(SELECT 1 FROM app_metadata WHERE key='account-type:'||p.owner_id AND value IN ('customer','lawyer')) AND EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=p.owner_id AND role IN ('lawyer_applicant','verified_lawyer'))))
        AND EXISTS(SELECT 1 FROM user_consents WHERE user_id=p.owner_id AND terms_version='${CURRENT_POLICY_VERSIONS.termsVersion}' AND privacy_version='${CURRENT_POLICY_VERSIONS.privacyVersion}' AND ai_notice_version='${CURRENT_POLICY_VERSIONS.aiNoticeVersion}' AND over_14_confirmed=1)
        AND EXISTS(SELECT 1 FROM v2_private_snapshots s JOIN v2_consents consent ON consent.id=s.id AND consent.owner_id=s.owner_id WHERE s.id=${d}.source_id AND s.target_id=p.id AND s.owner_id=p.owner_id AND s.purpose='profile_revision' AND s.state='published' AND s.revision=${d}.revision AND consent.kind='profile_publication' AND consent.version='${selfPublicationVersions.public}' AND consent.revision=s.revision AND NOT EXISTS(SELECT 1 FROM v2_private_snapshots newer WHERE newer.purpose='profile_revision' AND newer.target_id=p.id AND newer.revision>s.revision))
        AND NOT EXISTS(SELECT 1 FROM json_each(${d}.refs_json) ref WHERE NOT EXISTS(SELECT 1 FROM v2_assets a JOIN v2_blobs b ON b.id=a.sanitized_blob_id JOIN v2_billing_principals principal ON principal.id=b.principal_id WHERE a.id=json_extract(ref.value,'$.assetId') AND a.profile_id=p.id AND a.owner_id=p.owner_id AND a.state='ready' AND a.revision=json_extract(ref.value,'$.revision') AND a.purpose=json_extract(ref.value,'$.purpose') AND b.id=json_extract(ref.value,'$.blobId') AND b.state='stored' AND b.visibility='staging' AND principal.owner_id=p.owner_id AND ((a.purpose='profile_photo' AND b.kind='profile_photo_sanitized') OR (a.purpose='portfolio' AND b.kind='portfolio_sanitized')) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='asset' AND target_id=a.id))))
      OR
      (${d}.source='verified' AND NOT ${selfExists("p.id")}
        AND EXISTS(SELECT 1 FROM v2_public_profiles pub JOIN v2_profile_revisions r ON r.id=pub.revision_id WHERE pub.profile_id=p.id AND pub.revision_id=${d}.source_id AND pub.approved_revision=${d}.revision AND p.approved_revision_id=r.id AND r.profile_id=p.id AND r.status='approved' AND EXISTS(SELECT 1 FROM v2_applications WHERE id=r.application_id AND owner_id=p.owner_id AND status='approved')
          AND json_array_length(pub.content_json,'$.assets')=(SELECT count(*) FROM v2_public_assets WHERE profile_id=p.id AND revision_id=r.id) AND json_array_length(pub.content_json,'$.assets')=json_array_length(${d}.refs_json) AND NOT EXISTS(SELECT 1 FROM json_each(${d}.refs_json) ref WHERE NOT EXISTS(SELECT 1 FROM v2_public_assets asset JOIN v2_blobs b ON b.id=asset.public_blob_id WHERE asset.profile_id=p.id AND asset.revision_id=r.id AND asset.asset_id=json_extract(ref.value,'$.assetId') AND b.id=json_extract(ref.value,'$.blobId') AND b.state='stored' AND b.visibility='public' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='asset' AND target_id=asset.asset_id))))
        AND EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=p.owner_id AND role='verified_lawyer'))
    ))`;
}

type AssetRef = { assetId: string; blobId: string; revision: number; purpose: string };
export type DirectoryProjection = {
  profileId: string;
  ownerId: string;
  source: DirectorySource;
  sourceId: string;
  revision: number;
  sortKey: string;
  name: string;
  office: string;
  region: string;
  publicJson: string;
  photoData: string | null;
  tokensJson: string;
  facetsJson: string;
  refsJson: string;
  updatedAt: string;
};
async function projection(
  ownerId: string,
  source: DirectorySource,
  sourceId: string,
  item: DirectoryItem,
  photoData: string | null,
  refs: AssetRef[],
  now: string,
): Promise<DirectoryProjection> {
  item = directoryItemSchema.parse(item);
  return {
    profileId: item.id,
    ownerId,
    source,
    sourceId,
    revision: item.revision,
    sortKey: (await runtimeDigest(item.id)).slice(0, 16),
    name: normalizeDirectoryText(item.name),
    office: normalizeDirectoryText(item.officeName),
    region: item.region,
    publicJson: JSON.stringify(item),
    photoData,
    tokensJson: JSON.stringify(directoryTokens(item.name, item.officeName)),
    facetsJson: JSON.stringify(directoryFacets(item.region, item.practiceAreas)),
    refsJson: JSON.stringify(refs),
    updatedAt: now,
  };
}

export async function selfDirectoryProjection(
  core: V2Core,
  ownerId: string,
  sourceId: string,
  profile: SelfProfile,
  now: string,
) {
  const refs = [
    ...new Map(
      [
        ...(profile.photoAssetId ? [{ id: profile.photoAssetId, purpose: "profile_photo" }] : []),
        ...profile.portfolio.flatMap((p) =>
          p.assetId ? [{ id: p.assetId, purpose: "portfolio" }] : [],
        ),
      ].map((r) => [r.id, r]),
    ).values(),
  ];
  const rows = refs.length
    ? (
        await core
          .statement(
            "SELECT id,revision,sanitized_blob_id FROM v2_assets WHERE profile_id=? AND owner_id=? AND id IN (SELECT value FROM json_each(?))",
            [profile.id, ownerId, JSON.stringify(refs.map((r) => r.id))],
          )
          .all<{ id: string; revision: number; sanitized_blob_id: string }>()
      ).results
    : [];
  if (rows.length !== refs.length) throw new Error("DIRECTORY_PUBLIC_ASSET_CHANGED");
  const photoData = profile.photoUrl?.startsWith("data:") ? profile.photoUrl : null;
  return projection(
    ownerId,
    "self",
    sourceId,
    {
      id: profile.id,
      revision: profile.revision,
      name: profile.name,
      officeName: profile.officeName,
      introduction: profile.introduction,
      region: profile.region as DirectoryItem["region"],
      practiceAreas: profile.practiceAreas,
      photoAssetId: profile.photoAssetId ?? null,
      photoUrl: photoData
        ? `/api/v2/lawyers/directory/${encodeURIComponent(profile.id)}/photo?revision=${profile.revision}`
        : profile.photoUrl,
      verificationStatus: "self_declared",
    },
    photoData,
    rows.map((r) => ({
      assetId: r.id,
      revision: r.revision,
      blobId: r.sanitized_blob_id,
      purpose: refs.find((a) => a.id === r.id)?.purpose ?? "invalid",
    })),
    now,
  );
}

export async function verifiedDirectoryProjection(
  ownerId: string,
  sourceId: string,
  profile: V2PublicLawyer,
  publicBlobIds: Readonly<Record<string, string>>,
  now: string,
) {
  if (profile.assets.some((asset) => !publicBlobIds[asset.id]))
    throw new Error("DIRECTORY_PUBLIC_ASSET_CHANGED");
  return projection(
    ownerId,
    "verified",
    sourceId,
    {
      id: profile.id,
      revision: profile.approvedRevision,
      name: profile.content.name,
      officeName: profile.content.office.name,
      introduction: profile.content.introduction,
      region: profile.content.office.region,
      practiceAreas: profile.content.legalFields,
      photoAssetId: null,
      photoUrl: `/api/v2/lawyers/${encodeURIComponent(profile.id)}/assets/${encodeURIComponent(profile.content.photoAssetId)}`,
      verificationStatus: "verified",
    },
    null,
    profile.assets.map((asset) => ({
      assetId: asset.id,
      blobId: publicBlobIds[asset.id] ?? "invalid",
      revision: 1,
      purpose: "public",
    })),
    now,
  );
}

/** Compose after source/consent/pointers are written, before core.finish. */
export function directoryProjectionStatements(
  core: V2Core,
  input: DirectoryProjection,
  claim: string,
) {
  const columns =
    "profile_id,owner_id,source,source_id,revision,sort_key,normalized_name,normalized_office,region,public_json,photo_data,tokens_json,facets_json,refs_json,updated_at";
  const values = [
    input.profileId,
    input.ownerId,
    input.source,
    input.sourceId,
    input.revision,
    input.sortKey,
    input.name,
    input.office,
    input.region,
    input.publicJson,
    input.photoData,
    input.tokensJson,
    input.facetsJson,
    input.refsJson,
    input.updatedAt,
  ];
  return [
    core.statement(
      `WITH d(${columns}) AS (SELECT ${values.map(() => "?").join(",")}) INSERT INTO v2_directory_entries(${columns}) SELECT ${columns} FROM d WHERE ${directoryEligibleSql()} AND ${sqlClaim} ON CONFLICT(profile_id) DO UPDATE SET ${columns
        .split(",")
        .filter((c) => c !== "profile_id")
        .map((c) => `${c}=excluded.${c}`)
        .join(
          ",",
        )} WHERE v2_directory_entries.source_id!=excluded.source_id OR v2_directory_entries.revision!=excluded.revision OR v2_directory_entries.public_json!=excluded.public_json OR v2_directory_entries.refs_json!=excluded.refs_json OR v2_directory_entries.photo_data IS NOT excluded.photo_data`,
      [...values, claim],
    ),
    core.statement(
      `UPDATE v2_mutation_claims SET verified=CASE WHEN EXISTS(SELECT 1 FROM v2_directory_entries WHERE profile_id=? AND source=? AND source_id=? AND revision=? AND public_json=?) ${input.source === "verified" ? `OR ${selfExists("?")}` : ""} THEN 1 ELSE 0 END WHERE id=?`,
      [
        input.profileId,
        input.source,
        input.sourceId,
        input.revision,
        input.publicJson,
        ...(input.source === "verified" ? [input.profileId] : []),
        claim,
      ],
    ),
  ];
}
