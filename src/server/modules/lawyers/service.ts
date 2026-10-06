import { opaqueIdSchema, revisionSchema, timestampSchema } from "../../../contracts";
import {
  type V2LawyerApplication,
  type V2VerificationAsset,
  v2LawyerApplicationDraftRequestSchema,
  v2LawyerApplicationSchema,
  v2ProfileContentSchema,
  v2ProfileEditRequestSchema,
  v2ProfileWithdrawRequestSchema,
  v2SessionRolesSchema,
  v2VerificationAssetSchema,
} from "../../../contracts/v2";
import { type Actor, actorSchema, parse, type V2Core } from "../../db/v2-core";
import { createV2DeletionRepository } from "../../db/v2-deletion";
import { createV2LawyersRepository } from "../../db/v2-lawyers";
import type { LawyerAssetDependencies } from "./assets";
import type { OpenSanitizedAsset } from "./sanitized";

export class LawyerError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "STALE_REVISION"
      | "REVIEW_REQUIRED"
      | "ASSET_NOT_READY"
      | "PROCESSING_UNAVAILABLE",
  ) {
    super(code);
    this.name = "LawyerError";
  }
}
export type LawyerDependencies = Partial<LawyerAssetDependencies> & {
  openSanitized?: OpenSanitizedAsset;
};
export function createLawyersService(core: V2Core, deps: LawyerDependencies = {}) {
  const repository = createV2LawyersRepository(core);
  const deletion = createV2DeletionRepository(core);
  const now = () =>
    new Date(
      timestampSchema.parse((deps.clock ?? (() => new Date().toISOString()))()),
    ).toISOString();
  const actor = (ownerId: string): Actor => parse(actorSchema, { ownerId, now: now() });
  const ownProfile = async (ownerId: string, create = false) => {
    const find = () =>
      core
        .statement(
          "SELECT id,revision,approved_revision_id FROM v2_profiles p WHERE owner_id=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=p.owner_id) OR (target_kind='profile' AND target_id=p.id))",
          [ownerId],
        )
        .first<{ id: string; revision: number; approved_revision_id: string | null }>();
    let row = await find();
    if (!row && create) {
      await repository.createProfile(actor(ownerId), crypto.randomUUID());
      row = await find();
    }
    return row;
  };
  const ownApplication = async (ownerId: string) => {
    const row = await core
      .statement("SELECT id FROM v2_applications WHERE owner_id=? ORDER BY revision DESC LIMIT 1", [
        ownerId,
      ])
      .first<{ id: string }>();
    return row ? repository.readApplication(actor(ownerId), row.id) : null;
  };
  const verification = async (ownerId: string, id: string): Promise<V2VerificationAsset> => {
    parse(opaqueIdSchema, id);
    const result = await repository.readAsset(actor(ownerId), id);
    if (!result) throw new LawyerError("NOT_FOUND");
    if ("request" in result) {
      if (!["identity", "lawyer_license", "office"].includes(result.request.purpose))
        throw new LawyerError("NOT_FOUND");
      return v2VerificationAssetSchema.parse({
        id,
        purpose: result.request.purpose,
        status: "reserved",
        byteLength: result.request.byteLength,
        contentHash: null,
      });
    }
    return v2VerificationAssetSchema.parse(result);
  };
  return {
    async roles(ownerId: string, sessionId: string) {
      const time = await core
        .statement(
          "SELECT oauth_authenticated_at FROM session WHERE id=? AND user_id=? AND expires_at>?",
          [sessionId, ownerId, Date.parse(now())],
        )
        .first<number>("oauth_authenticated_at");
      return v2SessionRolesSchema.parse({
        schemaVersion: "2",
        roles: await repository.roles(actor(ownerId)),
        reauthenticatedAt: time ? new Date(time).toISOString() : null,
      });
    },
    application: ownApplication,
    async createApplication(ownerId: string) {
      const existing = await ownApplication(ownerId);
      if (existing) return existing;
      await ownProfile(ownerId, true);
      const value: V2LawyerApplication = {
        schemaVersion: "2",
        id: crypto.randomUUID(),
        applicantId: ownerId,
        revision: 1,
        createdAt: now(),
        status: "draft",
        content: {},
      };
      if (!(await repository.saveApplication(actor(ownerId), value, null))) {
        const winner = await ownApplication(ownerId);
        if (winner) return winner;
        throw new LawyerError("STALE_REVISION");
      }
      return value;
    },
    async saveApplication(ownerId: string, input: unknown) {
      const body = v2LawyerApplicationDraftRequestSchema.parse(input);
      const current = await ownApplication(ownerId);
      if (!current || current.revision !== body.expectedRevision)
        throw new LawyerError("STALE_REVISION");
      if (current.status === "submitted" || current.status === "approved")
        throw new LawyerError("REVIEW_REQUIRED");
      const { verificationAssetIds, ...fields } = body.content;
      const assets = verificationAssetIds
        ? await Promise.all(verificationAssetIds.map((id) => verification(ownerId, id)))
        : current.content.assets;
      const value = v2LawyerApplicationSchema.parse({
        schemaVersion: "2",
        id: crypto.randomUUID(),
        applicantId: ownerId,
        revision: current.revision + 1,
        createdAt: now(),
        status: "draft",
        content: {
          ...current.content,
          ...fields,
          ...(fields.office ? { office: { ...current.content.office, ...fields.office } } : {}),
          ...(assets ? { assets } : {}),
        },
      });
      if (!(await repository.saveApplication(actor(ownerId), value, current.revision)))
        throw new LawyerError("STALE_REVISION");
      return value;
    },
    async submitApplication(ownerId: string, expectedRevision: number) {
      parse(revisionSchema, expectedRevision);
      const current = await ownApplication(ownerId);
      if (!current || current.revision !== expectedRevision)
        throw new LawyerError("STALE_REVISION");
      if (
        current.status !== "draft" ||
        !v2LawyerApplicationSchema.safeParse({
          ...current,
          status: "submitted",
          submittedAt: now(),
        }).success
      )
        throw new LawyerError("ASSET_NOT_READY");
      if (!(await repository.submitApplication(actor(ownerId), current.id, expectedRevision)))
        throw new LawyerError("ASSET_NOT_READY");
      return repository.readApplication(actor(ownerId), current.id);
    },
    async withdrawApplication(ownerId: string, expectedRevision: number) {
      const current = await ownApplication(ownerId);
      if (
        !current ||
        current.revision !== expectedRevision ||
        !(await repository.withdrawApplication(actor(ownerId), current.id, expectedRevision))
      )
        throw new LawyerError("STALE_REVISION");
      return repository.readApplication(actor(ownerId), current.id);
    },
    async profile(ownerId: string) {
      const row = await ownProfile(ownerId);
      if (!row) return null;
      const current = await repository.readProfileRevision(actor(ownerId), row.id, row.revision);
      const approvedRow = row.approved_revision_id
        ? await core
            .statement(
              "SELECT revision FROM v2_profile_revisions WHERE id=? AND profile_id=? AND status='approved'",
              [row.approved_revision_id, row.id],
            )
            .first<{ revision: number }>()
        : null;
      const approved = approvedRow
        ? await repository.readProfileRevision(actor(ownerId), row.id, approvedRow.revision)
        : null;
      const published = await repository.publicProfile(row.id);
      const final = await ownProfile(ownerId);
      if (
        !final ||
        final.revision !== row.revision ||
        final.approved_revision_id !== row.approved_revision_id
      )
        throw new LawyerError("STALE_REVISION");
      return {
        profileId: row.id,
        revision: row.revision,
        current,
        approved,
        published,
        publicationPending:
          current?.status === "approved" && published?.approvedRevision !== row.revision,
      };
    },
    async saveProfile(ownerId: string, input: unknown) {
      const body = v2ProfileEditRequestSchema.parse(input);
      const row = await ownProfile(ownerId, true);
      if (!row || row.revision !== body.expectedRevision) throw new LawyerError("STALE_REVISION");
      const prior = await repository.readProfileRevision(actor(ownerId), row.id, row.revision);
      if (
        !(await repository.saveProfileDraft(
          actor(ownerId),
          row.id,
          row.revision,
          crypto.randomUUID(),
          { ...prior?.content, ...body.content },
        ))
      )
        throw new LawyerError("STALE_REVISION");
      return repository.readProfileRevision(actor(ownerId), row.id, row.revision + 1);
    },
    async submitProfile(ownerId: string, expectedRevision: number) {
      const row = await ownProfile(ownerId);
      const application = await ownApplication(ownerId);
      if (!row || row.revision !== expectedRevision) throw new LawyerError("STALE_REVISION");
      if (application?.status !== "approved") throw new LawyerError("REVIEW_REQUIRED");
      const current = await repository.readProfileRevision(actor(ownerId), row.id, row.revision);
      if (current?.status !== "draft" || !v2ProfileContentSchema.safeParse(current.content).success)
        throw new LawyerError("ASSET_NOT_READY");
      if (!(await repository.submitProfile(actor(ownerId), row.id, row.revision, application.id)))
        throw new LawyerError("ASSET_NOT_READY");
      return repository.readProfileRevision(actor(ownerId), row.id, row.revision);
    },
    async withdrawProfile(ownerId: string, input: unknown) {
      const body = v2ProfileWithdrawRequestSchema.parse(input);
      const row = await ownProfile(ownerId);
      if (
        !row ||
        row.revision !== body.expectedRevision ||
        !(body.kind === "publication"
          ? await repository.withdrawApprovedProfile(actor(ownerId), row.id, row.revision)
          : await repository.withdrawProfile(actor(ownerId), row.id, row.revision, body.kind))
      )
        throw new LawyerError("STALE_REVISION");
      return {
        status: "withdrawn" as const,
        kind: body.kind,
        cleanupPending: body.kind === "publication",
      };
    },
    async asset(ownerId: string, id: string, purpose: "verification" | "portfolio") {
      const row = await core
        .statement("SELECT purpose FROM v2_assets WHERE id=? AND owner_id=?", [id, ownerId])
        .first<{ purpose: string }>();
      if (
        !row ||
        (purpose === "verification") !==
          ["identity", "lawyer_license", "office"].includes(row.purpose)
      )
        throw new LawyerError("NOT_FOUND");
      const value = await repository.readAsset(actor(ownerId), id);
      if (!value) throw new LawyerError("NOT_FOUND");
      return value;
    },
    async removeAsset(ownerId: string, id: string, expectedRevision: number) {
      if (!(await deletion.asset(actor(ownerId), id, expectedRevision)))
        throw new LawyerError("STALE_REVISION");
      return { assetId: id, status: "deleting" as const };
    },
  };
}
export type LawyersService = ReturnType<typeof createLawyersService>;
