import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import { CURRENT_POLICY_VERSIONS } from "../../../contracts/consent";
import { readSnapshot, snapshotStatements, sqlClaim, type V2Core } from "../../db/v2-core";
import { createV2LawyersRepository } from "../../db/v2-lawyers";
import { requireSelfAssets, selfAssetClaim } from "./self-assets";
import {
  emptySelfProfile,
  isDuplicateProfileSave,
  profileReady,
  type SelfProfile,
  selfProfileSchema,
} from "./self-profile-contract";
import { LawyerError } from "./service";

const publicVersion = "mvp-self-profile-public-v1";
const privateVersion = "mvp-self-profile-private-v1";
const alive = `NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=p.owner_id) OR (target_kind='profile' AND target_id=p.id))`;
// Match account-type selection without granting a qualification or moderation role.
// Existing lawyer roles remain a fallback only when no valid preference is saved.
const role = `(EXISTS(SELECT 1 FROM app_metadata WHERE key='account-type:'||p.owner_id AND value='lawyer') OR (NOT EXISTS(SELECT 1 FROM app_metadata WHERE key='account-type:'||p.owner_id AND value IN ('customer','lawyer')) AND EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=p.owner_id AND role IN ('lawyer_applicant','verified_lawyer'))))`;
const currentConsentSql = `EXISTS(SELECT 1 FROM user_consents WHERE user_id=p.owner_id AND terms_version='${CURRENT_POLICY_VERSIONS.termsVersion}' AND privacy_version='${CURRENT_POLICY_VERSIONS.privacyVersion}' AND ai_notice_version='${CURRENT_POLICY_VERSIONS.aiNoticeVersion}' AND over_14_confirmed=1)`;
type Row = { id: string; owner_id: string; snapshot_id: string; revision: number };
const latest = `SELECT p.id,p.owner_id,s.id AS snapshot_id,s.revision FROM v2_profiles p JOIN v2_private_snapshots s ON s.target_id=p.id AND s.owner_id=p.owner_id AND s.purpose='profile_revision' JOIN v2_consents c ON c.id=s.id AND c.owner_id=p.owner_id AND c.kind='profile_publication' WHERE c.version IN ('${publicVersion}','${privateVersion}') AND s.state='published' AND s.revision=(SELECT max(revision) FROM v2_private_snapshots WHERE target_id=p.id AND purpose='profile_revision') AND ${alive}`;
export function createSelfProfileService(core: V2Core, clock = () => new Date().toISOString()) {
  const actor = (ownerId: string) => ({ ownerId, now: clock() });
  const decode = (row: Row) =>
    readSnapshot(
      core,
      actor(row.owner_id),
      row.snapshot_id,
      "profile_revision",
      row.id,
      row.revision,
      selfProfileSchema,
    );
  const ownRow = (ownerId: string) =>
    core.statement(`${latest} AND p.owner_id=?`, [ownerId]).first<Row>();
  const service = {
    async getMine(ownerId: string): Promise<SelfProfile> {
      const row = await ownRow(ownerId);
      if (row) {
        const profile = await decode(row);
        if (!profile) throw new LawyerError("NOT_FOUND");
        return profile;
      }
      await createV2LawyersRepository(core).createProfile(actor(ownerId), crypto.randomUUID());
      const p = await core
        .statement(`SELECT p.id FROM v2_profiles p WHERE p.owner_id=? AND ${alive}`, [ownerId])
        .first<{ id: string }>();
      if (!p) throw new LawyerError("NOT_FOUND");
      return emptySelfProfile(p.id);
    },
    async saveMine(ownerId: string, input: unknown, publish?: boolean): Promise<SelfProfile> {
      const current = await service.getMine(ownerId);
      const incoming = selfProfileSchema.parse(input);
      if (current.id !== incoming.id) throw new LawyerError("NOT_FOUND");
      if (publish === undefined && isDuplicateProfileSave(current, incoming)) return current;
      if (current.revision !== incoming.revision) throw new LawyerError("STALE_REVISION");
      const next = selfProfileSchema.parse({
        ...incoming,
        revision: current.revision + 1,
        published: publish ?? current.published,
        verificationStatus: "self_declared",
      });
      if (next.published && !profileReady(next))
        throw new z.ZodError([
          { code: "custom", path: [], message: "Complete public profile required" },
        ]);
      if (next.photoUrl?.startsWith("data:")) validateSelfPhoto(next.photoUrl);
      await requireSelfAssets(core, ownerId, next);
      const snapshotId = crypto.randomUUID();
      const claimId = crypto.randomUUID();
      const now = clock();
      const consent = await core.encrypt("v2_consents", snapshotId, ownerId, next.revision, {
        profileId: next.id,
        published: next.published,
        scope: "photo/introduction/practice/office/contact/portfolio",
        acceptedAt: now,
      });
      const assets = selfAssetClaim(ownerId, next);
      const claim = core.statement(
        `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,p.owner_id,p.id,? FROM v2_profiles p WHERE p.id=? AND p.owner_id=? AND ${alive} AND ${role} AND ${currentConsentSql} AND coalesce((SELECT max(revision) FROM v2_private_snapshots WHERE target_id=p.id AND purpose='profile_revision'),1)=?${assets.sql}`,
        [claimId, next.revision, next.id, ownerId, current.revision, ...assets.args],
      );
      const changed = await core.changed([
        claim,
        ...(await snapshotStatements(
          core,
          {
            id: snapshotId,
            ownerId,
            workspaceId: null,
            purpose: "profile_revision",
            targetId: next.id,
            revision: next.revision,
            now,
          },
          next,
          claimId,
        )),
        core.statement(
          `INSERT INTO v2_consents(id,owner_id,kind,version,revision,encrypted_payload,created_at) SELECT ?,?,'profile_publication',?,?,?,? WHERE ${sqlClaim}`,
          [
            snapshotId,
            ownerId,
            next.published ? publicVersion : privateVersion,
            next.revision,
            consent,
            now,
            claimId,
          ],
        ),
        core.statement(
          `DELETE FROM v2_consents WHERE owner_id=? AND id IN (SELECT id FROM v2_private_snapshots WHERE target_id=? AND purpose='profile_revision' AND revision<?) AND version IN (?,?) AND ${sqlClaim}`,
          [ownerId, next.id, next.revision, publicVersion, privateVersion, claimId],
        ),
        core.statement(
          `DELETE FROM v2_private_snapshots WHERE target_id=? AND purpose='profile_revision' AND revision<? AND ${sqlClaim}`,
          [next.id, next.revision, claimId],
        ),
        core.finish(claimId),
      ]);
      if (!changed) throw new LawyerError("STALE_REVISION");
      return next;
    },
    async publishMine(
      ownerId: string,
      published: boolean,
      expectedRevision: number,
      profileId?: string,
    ) {
      const current = await service.getMine(ownerId);
      if (profileId && current.id !== profileId) throw new LawyerError("NOT_FOUND");
      if (current.revision === expectedRevision + 1 && current.published === published)
        return current;
      if (current.revision !== expectedRevision) throw new LawyerError("STALE_REVISION");
      return service.saveMine(ownerId, current, published);
    },
    async get(id: string) {
      opaqueIdSchema.parse(id);
      const row = await core
        .statement(`${latest} AND c.version=? AND ${role} AND ${currentConsentSql} AND p.id=?`, [
          publicVersion,
          id,
        ])
        .first<Row>();
      if (!row) throw new LawyerError("NOT_FOUND");
      const profile = await decode(row);
      if (!profile?.published) throw new LawyerError("NOT_FOUND");
      try {
        await requireSelfAssets(core, row.owner_id, profile);
      } catch {
        throw new LawyerError("NOT_FOUND");
      }
      const current = await core
        .statement(
          `${latest} AND c.version=? AND ${role} AND ${currentConsentSql} AND p.id=? AND s.id=?`,
          [publicVersion, id, row.snapshot_id],
        )
        .first<Row>();
      if (!current) throw new LawyerError("NOT_FOUND");
      return profile;
    },
    async list(filters: {
      name?: string | undefined;
      region?: string | undefined;
      legalField?: string | undefined;
      cursor?: string | undefined;
      limit?: number | undefined;
    }) {
      const limit = filters.limit ?? 20;
      const rows = await core
        .statement(
          `${latest} AND c.version=? AND ${role} AND ${currentConsentSql} AND p.id>? ORDER BY p.id LIMIT ?`,
          [publicVersion, filters.cursor ?? "", limit + 1],
        )
        .all<Row>();
      const items: SelfProfile[] = [];
      const page = rows.results.slice(0, limit);
      for (const row of page) {
        let p: SelfProfile;
        try {
          p = await service.get(row.id);
        } catch (error) {
          if (error instanceof LawyerError && error.code === "NOT_FOUND") continue;
          throw error;
        }
        if (
          p?.published &&
          (!filters.name || `${p.name} ${p.officeName}`.includes(filters.name)) &&
          (!filters.region || p.region === filters.region) &&
          (!filters.legalField ||
            p.practiceAreas.includes(filters.legalField as SelfProfile["practiceAreas"][number]))
        )
          items.push(p);
      }
      return {
        items,
        nextCursor: rows.results.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    },
  };
  return service;
}
/** Small browser-reencoded JPEG only. Reject APP/COM metadata at the server boundary. */
export function validateSelfPhoto(data: string) {
  const bytes = Uint8Array.from(atob(data.slice(data.indexOf(",") + 1)), (c) => c.charCodeAt(0));
  if (
    bytes.length > 33000 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  )
    throw new z.ZodError([{ code: "custom", path: ["photoUrl"], message: "Invalid JPEG" }]);
  let offset = 2;
  let sized = false;
  let scan = false;
  const view = new DataView(bytes.buffer);
  while (offset + 4 <= bytes.length - 2) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1] ?? 0;
    const length = view.getUint16(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)
      throw new z.ZodError([
        { code: "custom", path: ["photoUrl"], message: "Metadata is not allowed" },
      ]);
    if (marker === 0xc0 || marker === 0xc2) {
      if (length < 8) break;
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      if (width !== 240 || height !== 240) break;
      sized = true;
    }
    if (marker === 0xda) {
      scan = true;
      break;
    }
    offset += 2 + length;
  }
  if (!sized || !scan)
    throw new z.ZodError([
      { code: "custom", path: ["photoUrl"], message: "Expected a reencoded profile image" },
    ]);
}
