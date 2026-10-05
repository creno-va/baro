import { z } from "zod";
import { displayText, opaqueIdSchema, revisionSchema } from "../../contracts";
import {
  type V2ApplicationDecisionRequest,
  type V2LawyerApplication,
  type V2LawyerAssetUploadRequest,
  type V2ModerationReport,
  type V2ProfileDecisionRequest,
  type V2ProfileDraftContent,
  type V2ProfileRevision,
  type V2PublicLawyer,
  v2LawyerApplicationSchema,
  v2LawyerAssetUploadRequestSchema,
  v2ModerationDecisionSchema,
  v2ModerationReportSchema,
  v2PortfolioAssetSchema,
  v2ProfileContentSchema,
  v2ProfileDraftContentSchema,
  v2ProfileRevisionSchema,
  v2ProfileSubmitForAssetsSchema,
  v2PublicLawyerSchema,
  v2VerificationAssetSchema,
} from "../../contracts/v2";
import { createV2AccountingRepository, operationStatements } from "./v2-accounting";
import { type Actor, actorSchema, parse, safe, sqlClaim, type V2Core } from "./v2-core";
import { storagePredicate, storageReservationStatements } from "./v2-storage";
import {
  type Admission,
  admissionSchema,
  completeLeaseStatements,
  type JobLease,
  leasePredicate,
} from "./v2-workspace";

const moderatorSql = `EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=? AND role='moderator') AND EXISTS(SELECT 1 FROM session WHERE id=? AND user_id=? AND expires_at>? AND oauth_authenticated_at BETWEEN ? AND ?) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=?)`;
function moderatorValues(actor: Actor, sessionId: string) {
  parse(opaqueIdSchema, sessionId);
  const time = Date.parse(actor.now);
  return [actor.ownerId, sessionId, actor.ownerId, time, time - 600000, time, actor.ownerId];
}
const ownerAlive = `NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=?)`;
const verifiedProfile = `EXISTS(SELECT 1 FROM v2_role_bindings vb WHERE vb.owner_id=p.owner_id AND vb.role='verified_lawyer') AND EXISTS(SELECT 1 FROM v2_applications app WHERE app.id=r.application_id AND app.owner_id=p.owner_id AND app.status='approved') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='profile' AND target_id=p.id)`;
type AssetRow = {
  id: string;
  purpose: string;
  profile_id: string;
  revision: number;
  state: string;
  encrypted_payload: string;
  original_blob_id: string | null;
  sanitized_blob_id: string | null;
};
type ApplicationRow = {
  id: string;
  owner_id: string;
  revision: number;
  status: V2LawyerApplication["status"];
  encrypted_payload: string;
  submitted_at: string | null;
  decided_at: string | null;
  withdrawn_at: string | null;
  reviewer_id: string | null;
  created_at: string;
};
type ProfileRevisionRow = {
  id: string;
  profile_id: string;
  owner_id: string;
  revision: number;
  status: V2ProfileRevision["status"];
  encrypted_payload: string;
  submitted_at: string | null;
  decided_at: string | null;
  withdrawn_at: string | null;
  reviewer_id: string | null;
  created_at: string;
};
const decisionPayloadSchema = z.strictObject({
  reason: displayText(2000),
  checklist: z.record(z.string(), z.boolean()).optional(),
});
export function createV2LawyersRepository(core: V2Core) {
  const accounting = createV2AccountingRepository(core);
  const decisionPayload = async (
    ownerId: string,
    kind: "application" | "profile",
    targetId: string,
    revision: number,
  ) => {
    const row = await core
      .statement(
        "SELECT id,encrypted_payload FROM v2_moderation_decisions WHERE target_kind=? AND target_id=? AND target_revision=?",
        [kind, targetId, revision],
      )
      .first<{ id: string; encrypted_payload: string }>();
    return row
      ? core.decrypt(
          "v2_moderation_decisions",
          row.id,
          ownerId,
          revision,
          row.encrypted_payload,
          decisionPayloadSchema,
        )
      : null;
  };
  const decodeApplication = async (row: ApplicationRow): Promise<V2LawyerApplication> => {
    const base = await core.decrypt(
      "v2_applications",
      row.id,
      row.owner_id,
      row.revision,
      row.encrypted_payload,
      v2LawyerApplicationSchema,
    );
    const decision =
      row.status === "approved" || row.status === "rejected"
        ? await decisionPayload(row.owner_id, "application", row.id, row.revision)
        : null;
    return parse(v2LawyerApplicationSchema, {
      ...base,
      status: row.status,
      ...(row.submitted_at ? { submittedAt: row.submitted_at } : {}),
      ...(decision
        ? {
            reviewerId: row.reviewer_id,
            reviewedAt: row.decided_at,
            reason: decision.reason,
            ...(row.status === "approved" ? { checklist: decision.checklist } : {}),
          }
        : {}),
      ...(row.status === "withdrawn" ? { withdrawnAt: row.withdrawn_at } : {}),
    });
  };
  const decodeRevision = async (row: ProfileRevisionRow): Promise<V2ProfileRevision> => {
    const base = await core.decrypt(
      "v2_profile_revisions",
      row.id,
      row.owner_id,
      row.revision,
      row.encrypted_payload,
      v2ProfileRevisionSchema,
    );
    const decision =
      row.status === "approved" || row.status === "rejected"
        ? await decisionPayload(row.owner_id, "profile", row.id, row.revision)
        : null;
    return parse(v2ProfileRevisionSchema, {
      ...base,
      status: row.status,
      ...(row.submitted_at ? { submittedAt: row.submitted_at } : {}),
      ...(decision
        ? { reviewerId: row.reviewer_id, reviewedAt: row.decided_at, reason: decision.reason }
        : {}),
      ...(row.status === "withdrawn" ? { withdrawnAt: row.withdrawn_at } : {}),
    });
  };
  return {
    roles(actor: Actor) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        if (
          !(await core
            .statement(`SELECT id FROM user WHERE id=? AND ${ownerAlive}`, [
              actor.ownerId,
              actor.ownerId,
            ])
            .first())
        )
          return [];
        return [
          "user",
          ...(
            await core
              .statement("SELECT role FROM v2_role_bindings WHERE owner_id=? AND role!='user'", [
                actor.ownerId,
              ])
              .all<{ role: string }>()
          ).results.map((r) => r.role),
        ];
      });
    },
    createProfile(actor: Actor, id: string) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, id);
        return (
          (
            await core
              .statement(
                `INSERT INTO v2_profiles(id,owner_id,created_at,updated_at) SELECT ?,id,?,? FROM user WHERE id=? AND ${ownerAlive} ON CONFLICT(owner_id) DO NOTHING`,
                [id, actor.now, actor.now, actor.ownerId, actor.ownerId],
              )
              .run()
          ).meta.changes === 1
        );
      });
    },
    saveApplication(actor: Actor, value: V2LawyerApplication, expectedRevision: number | null) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const application = parse(v2LawyerApplicationSchema, value);
        if (
          application.status !== "draft" ||
          application.applicantId !== actor.ownerId ||
          application.revision !== (expectedRevision ?? 0) + 1
        )
          return false;
        const envelope = await core.encrypt(
          "v2_applications",
          application.id,
          actor.ownerId,
          application.revision,
          application,
        );
        const claimId = crypto.randomUUID();
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,id,?,? FROM user WHERE id=? AND ${ownerAlive} AND coalesce((SELECT max(revision) FROM v2_applications WHERE owner_id=?),0)=? AND NOT EXISTS(SELECT 1 FROM v2_applications WHERE owner_id=? AND status='submitted')`,
            [
              claimId,
              application.id,
              application.revision,
              actor.ownerId,
              actor.ownerId,
              actor.ownerId,
              expectedRevision ?? 0,
              actor.ownerId,
            ],
          ),
          core.statement(
            `INSERT INTO v2_applications(id,owner_id,revision,status,encrypted_payload,created_at) SELECT ?,?,?,'draft',?,? WHERE ${sqlClaim}`,
            [application.id, actor.ownerId, application.revision, envelope, actor.now, claimId],
          ),
          core.statement(
            `INSERT INTO v2_role_bindings(owner_id,role,granted_at) SELECT ?,'lawyer_applicant',? WHERE ${sqlClaim} AND NOT EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=? AND role='verified_lawyer') ON CONFLICT(owner_id,role) DO NOTHING`,
            [actor.ownerId, actor.now, claimId, actor.ownerId],
          ),
          core.finish(claimId),
        ]);
      });
    },
    readApplication(actor: Actor, id: string) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const row = await core
          .statement(`SELECT * FROM v2_applications WHERE id=? AND owner_id=? AND ${ownerAlive}`, [
            id,
            actor.ownerId,
            actor.ownerId,
          ])
          .first<ApplicationRow>();
        if (!row) return null;
        const value = await decodeApplication(row);
        return (await core
          .statement(
            `SELECT id FROM v2_applications WHERE id=? AND owner_id=? AND revision=? AND status=? AND encrypted_payload=? AND ${ownerAlive}`,
            [id, actor.ownerId, row.revision, row.status, row.encrypted_payload, actor.ownerId],
          )
          .first())
          ? value
          : null;
      });
    },
    withdrawApplication(actor: Actor, id: string, expectedRevision: number) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, id);
        parse(revisionSchema, expectedRevision);
        const claimId = crypto.randomUUID();
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,owner_id,id,revision FROM v2_applications WHERE id=? AND owner_id=? AND revision=? AND status IN ('submitted','approved','rejected') AND ${ownerAlive}`,
            [claimId, id, actor.ownerId, expectedRevision, actor.ownerId],
          ),
          core.statement(
            `UPDATE v2_applications SET status='withdrawn',withdrawn_at=? WHERE id=? AND ${sqlClaim}`,
            [actor.now, id, claimId],
          ),
          core.statement(
            `DELETE FROM v2_role_bindings WHERE owner_id=? AND role='verified_lawyer' AND ${sqlClaim}`,
            [actor.ownerId, claimId],
          ),
          core.finish(claimId),
        ]);
      });
    },
    revokeVerification(
      reviewer: Actor,
      sessionId: string,
      ownerId: string,
      applicationId: string,
      expectedRevision: number,
    ) {
      return safe(async () => {
        reviewer = parse(actorSchema, reviewer);
        parse(opaqueIdSchema, ownerId);
        parse(opaqueIdSchema, applicationId);
        parse(revisionSchema, expectedRevision);
        if (reviewer.ownerId === ownerId) return false;
        const claimId = crypto.randomUUID();
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,owner_id,id,revision FROM v2_applications WHERE id=? AND owner_id=? AND revision=? AND status='approved' AND ${moderatorSql}`,
            [
              claimId,
              applicationId,
              ownerId,
              expectedRevision,
              ...moderatorValues(reviewer, sessionId),
            ],
          ),
          core.statement(
            `UPDATE v2_applications SET status='withdrawn',withdrawn_at=? WHERE id=? AND ${sqlClaim}`,
            [reviewer.now, applicationId, claimId],
          ),
          core.statement(
            `DELETE FROM v2_role_bindings WHERE owner_id=? AND role='verified_lawyer' AND ${sqlClaim}`,
            [ownerId, claimId],
          ),
          core.statement(
            `INSERT INTO v2_role_audit(id,subject_token,role,action,actor_token,created_at) SELECT ?,?,'verified_lawyer','revoke',?,? WHERE ${sqlClaim}`,
            [crypto.randomUUID(), ownerId, reviewer.ownerId, reviewer.now, claimId],
          ),
          core.finish(claimId),
        ]);
      });
    },
    readAsset(actor: Actor, id: string) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, id);
        const row = await core
          .statement(
            `SELECT a.* FROM v2_assets a JOIN v2_profiles p ON p.id=a.profile_id WHERE a.id=? AND a.owner_id=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=a.owner_id) OR (target_kind='profile' AND target_id=p.id) OR (target_kind='asset' AND target_id=a.id))`,
            [id, actor.ownerId],
          )
          .first<AssetRow>();
        if (!row) return null;
        const value = await core.decrypt(
          "v2_assets",
          id,
          actor.ownerId,
          row.revision,
          row.encrypted_payload,
          z.union([
            z.strictObject({ request: v2LawyerAssetUploadRequestSchema }),
            v2VerificationAssetSchema,
            v2PortfolioAssetSchema,
          ]),
        );
        return (await core
          .statement(
            `SELECT a.id FROM v2_assets a JOIN v2_profiles p ON p.id=a.profile_id WHERE a.id=? AND a.owner_id=? AND a.revision=? AND a.encrypted_payload=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=a.owner_id) OR (target_kind='profile' AND target_id=p.id) OR (target_kind='asset' AND target_id=a.id))`,
            [id, actor.ownerId, row.revision, row.encrypted_payload],
          )
          .first())
          ? value
          : null;
      });
    },
    readSubmittedVerification(
      reviewer: Actor,
      sessionId: string,
      applicationId: string,
      assetId: string,
    ) {
      return safe(async () => {
        reviewer = parse(actorSchema, reviewer);
        for (const id of [applicationId, assetId]) parse(opaqueIdSchema, id);
        const sql = `SELECT a.* FROM v2_assets a JOIN v2_application_assets link ON link.asset_id=a.id JOIN v2_applications app ON app.id=link.application_id WHERE app.id=? AND a.id=? AND app.status='submitted' AND app.owner_id=a.owner_id AND app.owner_id!=? AND a.purpose IN ('identity','lawyer_license','office') AND a.state='ready' AND ${moderatorSql} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=a.owner_id) OR (target_kind='asset' AND target_id=a.id) OR (target_kind='profile' AND target_id=a.profile_id))`;
        const values = [
          applicationId,
          assetId,
          reviewer.ownerId,
          ...moderatorValues(reviewer, sessionId),
        ];
        const row = await core.statement(sql, values).first<AssetRow & { owner_id: string }>();
        if (!row) return null;
        const value = await core.decrypt(
          "v2_assets",
          assetId,
          row.owner_id,
          row.revision,
          row.encrypted_payload,
          v2VerificationAssetSchema,
        );
        const final = await core.statement(sql, values).first<AssetRow>();
        return final?.revision === row.revision && final.encrypted_payload === row.encrypted_payload
          ? value
          : null;
      });
    },
    submitApplication(actor: Actor, id: string, expectedRevision: number) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const row = await core
          .statement(
            "SELECT * FROM v2_applications WHERE id=? AND owner_id=? AND revision=? AND status='draft'",
            [id, actor.ownerId, expectedRevision],
          )
          .first<ApplicationRow>();
        if (!row) return false;
        const draft = await decodeApplication(row);
        const submitted = parse(v2LawyerApplicationSchema, {
          ...draft,
          status: "submitted",
          submittedAt: actor.now,
        });
        if (submitted.status !== "submitted") return false;
        const actualAssets = await core
          .statement(
            "SELECT id,revision,encrypted_payload FROM v2_assets WHERE owner_id=? AND state='ready' AND id IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='asset' AND target_id=v2_assets.id)",
            [actor.ownerId, JSON.stringify(submitted.content.assets.map((a) => a.id))],
          )
          .all<{ id: string; revision: number; encrypted_payload: string }>();
        if (actualAssets.results.length !== submitted.content.assets.length) return false;
        for (const actual of actualAssets.results) {
          const dto = await core.decrypt(
            "v2_assets",
            actual.id,
            actor.ownerId,
            actual.revision,
            actual.encrypted_payload,
            v2VerificationAssetSchema,
          );
          if (
            JSON.stringify(dto) !==
            JSON.stringify(submitted.content.assets.find((a) => a.id === actual.id))
          )
            return false;
        }
        const assetIds = submitted.content.assets.map((a) => a.id);
        const envelope = await core.encrypt(
          "v2_applications",
          id,
          actor.ownerId,
          row.revision,
          submitted,
        );
        const claimId = crypto.randomUUID();
        const statements = [
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,owner_id,id,revision FROM v2_applications WHERE id=? AND owner_id=? AND revision=? AND status='draft' AND revision=(SELECT max(revision) FROM v2_applications WHERE owner_id=?) AND ${ownerAlive}`,
            [claimId, id, actor.ownerId, expectedRevision, actor.ownerId, actor.ownerId],
          ),
        ];
        for (const asset of submitted.content.assets)
          statements.push(
            core.statement(
              `INSERT INTO v2_application_assets(application_id,asset_id) SELECT ?,id FROM v2_assets WHERE id=? AND owner_id=? AND purpose=? AND state='ready' AND revision=? AND encrypted_payload=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='asset' AND target_id=v2_assets.id) OR (target_kind='profile' AND target_id=v2_assets.profile_id)) AND ${sqlClaim}`,
              [
                id,
                asset.id,
                actor.ownerId,
                asset.purpose,
                actualAssets.results.find((a) => a.id === asset.id)?.revision,
                actualAssets.results.find((a) => a.id === asset.id)?.encrypted_payload,
                claimId,
              ],
            ),
          );
        statements.push(
          core.statement(
            "UPDATE v2_mutation_claims SET verified=CASE WHEN (SELECT count(*) FROM v2_application_assets WHERE application_id=?)=? THEN 1 ELSE 0 END WHERE id=?",
            [id, assetIds.length, claimId],
          ),
          core.statement(
            `UPDATE v2_applications SET status='submitted',submitted_at=?,encrypted_payload=? WHERE id=? AND ${sqlClaim}`,
            [actor.now, envelope, id, claimId],
          ),
          core.finish(claimId),
        );
        return core.changed(statements);
      });
    },
    decideApplication(
      reviewer: Actor,
      sessionId: string,
      id: string,
      request: V2ApplicationDecisionRequest,
    ) {
      return safe(async () => {
        reviewer = parse(actorSchema, reviewer);
        const row = await core
          .statement("SELECT * FROM v2_applications WHERE id=?", [id])
          .first<ApplicationRow>();
        if (!row) return false;
        const oauth = await core
          .statement("SELECT oauth_authenticated_at FROM session WHERE id=? AND user_id=?", [
            sessionId,
            reviewer.ownerId,
          ])
          .first<number>("oauth_authenticated_at");
        const roles = await core
          .statement("SELECT role FROM v2_role_bindings WHERE owner_id=?", [reviewer.ownerId])
          .all<{ role: string }>();
        const decision = parse<V2ApplicationDecisionRequest | V2ProfileDecisionRequest>(
          v2ModerationDecisionSchema(
            {
              applicantId: row.owner_id,
              reviewerId: reviewer.ownerId,
              roles: roles.results.map((r) => r.role),
              reauthenticatedAt: new Date(oauth ?? 0).toISOString(),
              now: reviewer.now,
              expectedRevision: row.revision,
              state: row.status,
            },
            "application",
          ),
          request,
        );
        const claimId = crypto.randomUUID();
        const decisionId = crypto.randomUUID();
        const payload = await core.encrypt(
          "v2_moderation_decisions",
          decisionId,
          row.owner_id,
          row.revision,
          {
            reason: decision.reason,
            ...("checklist" in decision ? { checklist: decision.checklist } : {}),
          },
        );
        const statements = [
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,owner_id,id,revision FROM v2_applications WHERE id=? AND revision=? AND status='submitted' AND owner_id!=? AND ${ownerAlive} AND ${moderatorSql}`,
            [
              claimId,
              id,
              decision.expectedRevision,
              reviewer.ownerId,
              row.owner_id,
              ...moderatorValues(reviewer, sessionId),
            ],
          ),
          core.statement(
            `INSERT INTO v2_moderation_decisions(id,target_kind,target_id,target_revision,reviewer_id,owner_id,decision,encrypted_payload,oauth_authenticated_at,created_at) SELECT ?,'application',?,?,?,?,?,?,?,? WHERE ${sqlClaim}`,
            [
              decisionId,
              id,
              row.revision,
              reviewer.ownerId,
              row.owner_id,
              decision.decision === "approved" ? "approve" : "reject",
              payload,
              new Date(oauth ?? 0).toISOString(),
              reviewer.now,
              claimId,
            ],
          ),
          core.statement(
            `UPDATE v2_applications SET status=?,reviewer_id=?,decided_at=? WHERE id=? AND ${sqlClaim}`,
            [decision.decision, reviewer.ownerId, reviewer.now, id, claimId],
          ),
        ];
        if (decision.decision === "approved")
          statements.push(
            core.statement(
              `DELETE FROM v2_role_bindings WHERE owner_id=? AND role='lawyer_applicant' AND ${sqlClaim}`,
              [row.owner_id, claimId],
            ),
            core.statement(
              `INSERT INTO v2_role_bindings(owner_id,role,granted_at,granted_by) SELECT ?,'verified_lawyer',?,? WHERE ${sqlClaim} ON CONFLICT(owner_id,role) DO NOTHING`,
              [row.owner_id, reviewer.now, reviewer.ownerId, claimId],
            ),
          );
        statements.push(core.finish(claimId));
        return core.changed(statements);
      });
    },
    saveProfileDraft(
      actor: Actor,
      profileId: string,
      expectedRevision: number,
      id: string,
      content: V2ProfileDraftContent,
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, id);
        parse(revisionSchema, expectedRevision);
        const body = parse(v2ProfileDraftContentSchema, content);
        const revision = expectedRevision + 1;
        const value = parse(v2ProfileRevisionSchema, {
          schemaVersion: "2",
          id,
          profileId,
          revision,
          createdAt: actor.now,
          status: "draft",
          content: body,
        });
        const envelope = await core.encrypt(
          "v2_profile_revisions",
          id,
          actor.ownerId,
          revision,
          value,
        );
        const claimId = crypto.randomUUID();
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,owner_id,id,revision FROM v2_profiles p WHERE id=? AND owner_id=? AND revision=? AND ${ownerAlive} AND NOT EXISTS(SELECT 1 FROM v2_profile_revisions WHERE profile_id=p.id AND status='submitted') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='profile' AND target_id=p.id)`,
            [claimId, profileId, actor.ownerId, expectedRevision, actor.ownerId],
          ),
          core.statement(
            `INSERT INTO v2_profile_revisions(id,profile_id,revision,status,encrypted_payload,created_at) SELECT ?,?,?,'draft',?,? WHERE ${sqlClaim}`,
            [id, profileId, revision, envelope, actor.now, claimId],
          ),
          core.statement(
            `UPDATE v2_profiles SET revision=?,updated_at=? WHERE id=? AND ${sqlClaim}`,
            [revision, actor.now, profileId, claimId],
          ),
          core.finish(claimId),
        ]);
      });
    },
    readProfileRevision(actor: Actor, profileId: string, revision: number) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const row = await core
          .statement(
            `SELECT r.*,p.owner_id FROM v2_profile_revisions r JOIN v2_profiles p ON p.id=r.profile_id WHERE p.id=? AND p.owner_id=? AND r.revision=? AND ${ownerAlive} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='profile' AND target_id=p.id)`,
            [profileId, actor.ownerId, revision, actor.ownerId],
          )
          .first<ProfileRevisionRow>();
        if (!row) return null;
        const value = await decodeRevision(row);
        return (await core
          .statement(
            `SELECT r.id FROM v2_profile_revisions r JOIN v2_profiles p ON p.id=r.profile_id WHERE p.id=? AND p.owner_id=? AND r.id=? AND r.revision=? AND r.status=? AND ${ownerAlive} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='profile' AND target_id=p.id)`,
            [profileId, actor.ownerId, row.id, row.revision, row.status, actor.ownerId],
          )
          .first())
          ? value
          : null;
      });
    },
    submitProfile(
      actor: Actor,
      profileId: string,
      expectedRevision: number,
      applicationId: string,
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const row = await core
          .statement(
            "SELECT r.*,p.owner_id FROM v2_profile_revisions r JOIN v2_profiles p ON p.id=r.profile_id WHERE p.id=? AND p.owner_id=? AND p.revision=? AND r.revision=p.revision AND r.status='draft'",
            [profileId, actor.ownerId, expectedRevision],
          )
          .first<ProfileRevisionRow>();
        if (!row) return false;
        const draft = await decodeRevision(row);
        const content = parse(v2ProfileContentSchema, draft.content);
        const assets = [
          content.photoAssetId,
          ...content.portfolio.flatMap((item) => (item.kind === "text" ? [] : [item.assetId])),
        ];
        const unique = [...new Set(assets)];
        const submitted = parse(v2ProfileRevisionSchema, {
          ...draft,
          status: "submitted",
          content,
          submittedAt: actor.now,
        });
        const envelope = await core.encrypt(
          "v2_profile_revisions",
          row.id,
          actor.ownerId,
          row.revision,
          submitted,
        );
        const claimId = crypto.randomUUID();
        const ownedAssets: AssetRow[] = [];
        const assetDtos = [];
        for (const id of unique) {
          const asset = await core
            .statement(
              "SELECT * FROM v2_assets WHERE id=? AND owner_id=? AND profile_id=? AND state='ready'",
              [id, actor.ownerId, profileId],
            )
            .first<AssetRow>();
          if (
            !asset ||
            asset.purpose !== (id === content.photoAssetId ? "profile_photo" : "portfolio")
          )
            return false;
          ownedAssets.push(asset);
          assetDtos.push(
            await core.decrypt(
              "v2_assets",
              id,
              actor.ownerId,
              asset.revision,
              asset.encrypted_payload,
              v2PortfolioAssetSchema,
            ),
          );
        }
        const application = await core
          .statement("SELECT status FROM v2_applications WHERE id=? AND owner_id=?", [
            applicationId,
            actor.ownerId,
          ])
          .first<{ status: V2LawyerApplication["status"] }>();
        if (!application) return false;
        parse(
          v2ProfileSubmitForAssetsSchema({
            applicationState: application.status,
            revision: row.revision,
            content,
            assets: assetDtos,
          }),
          { expectedRevision },
        );
        const statements = [
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,p.owner_id,p.id,p.revision FROM v2_profiles p JOIN v2_profile_revisions r ON r.profile_id=p.id AND r.revision=p.revision WHERE p.id=? AND p.owner_id=? AND p.revision=? AND r.status='draft' AND EXISTS(SELECT 1 FROM v2_applications WHERE id=? AND owner_id=p.owner_id AND status='approved') AND EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=p.owner_id AND role='verified_lawyer') AND ${ownerAlive}`,
            [claimId, profileId, actor.ownerId, expectedRevision, applicationId, actor.ownerId],
          ),
        ];
        for (const [ordinal, asset] of ownedAssets.entries())
          statements.push(
            core.statement(
              `INSERT INTO v2_profile_revision_assets(revision_id,asset_id,asset_revision,ordinal) SELECT ?,a.id,a.revision,? FROM v2_assets a JOIN v2_blobs b ON b.id=a.sanitized_blob_id JOIN v2_storage_reservations sr ON sr.id=b.reservation_id JOIN v2_billing_principals principal ON principal.id=b.principal_id WHERE a.id=? AND a.owner_id=? AND a.profile_id=? AND a.revision=? AND a.purpose=? AND a.encrypted_payload=? AND a.state='ready' AND b.state='stored' AND b.visibility='staging' AND sr.entity_id=a.id AND sr.kind='lawyer_asset' AND principal.owner_id=a.owner_id AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='asset' AND target_id=a.id) AND ${sqlClaim}`,
              [
                row.id,
                ordinal,
                asset.id,
                actor.ownerId,
                profileId,
                asset.revision,
                asset.purpose,
                asset.encrypted_payload,
                claimId,
              ],
            ),
          );
        statements.push(
          core.statement(
            "UPDATE v2_mutation_claims SET verified=CASE WHEN (SELECT count(*) FROM v2_profile_revision_assets WHERE revision_id=?)=? THEN 1 ELSE 0 END WHERE id=?",
            [row.id, unique.length, claimId],
          ),
          core.statement(
            `UPDATE v2_profile_revisions SET status='submitted',submitted_at=?,application_id=?,encrypted_payload=? WHERE id=? AND ${sqlClaim}`,
            [actor.now, applicationId, envelope, row.id, claimId],
          ),
          core.finish(claimId),
        );
        return core.changed(statements);
      });
    },
    decideProfile(
      reviewer: Actor,
      sessionId: string,
      profileId: string,
      request: V2ProfileDecisionRequest,
      admission: Admission,
    ) {
      return safe(async () => {
        reviewer = parse(actorSchema, reviewer);
        parse(admissionSchema, admission);
        const row = await core
          .statement(
            "SELECT r.*,p.owner_id FROM v2_profile_revisions r JOIN v2_profiles p ON p.id=r.profile_id WHERE p.id=? AND r.revision=p.revision",
            [profileId],
          )
          .first<ProfileRevisionRow>();
        if (!row) return false;
        const oauth = await core
          .statement("SELECT oauth_authenticated_at FROM session WHERE id=? AND user_id=?", [
            sessionId,
            reviewer.ownerId,
          ])
          .first<number>("oauth_authenticated_at");
        const roles = await core
          .statement("SELECT role FROM v2_role_bindings WHERE owner_id=?", [reviewer.ownerId])
          .all<{ role: string }>();
        const decision = parse<V2ApplicationDecisionRequest | V2ProfileDecisionRequest>(
          v2ModerationDecisionSchema(
            {
              applicantId: row.owner_id,
              reviewerId: reviewer.ownerId,
              roles: roles.results.map((r) => r.role),
              reauthenticatedAt: new Date(oauth ?? 0).toISOString(),
              now: reviewer.now,
              expectedRevision: row.revision,
              state: row.status,
            },
            "profile",
          ),
          request,
        );
        const claimId = crypto.randomUUID();
        const decisionId = crypto.randomUUID();
        const envelope = await core.encrypt(
          "v2_moderation_decisions",
          decisionId,
          row.owner_id,
          row.revision,
          {
            reason: decision.reason,
            ...("checklist" in decision ? { checklist: decision.checklist } : {}),
          },
        );
        const ownerActor = { ownerId: row.owner_id, now: reviewer.now };
        const statements = [
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,p.owner_id,p.id,p.revision FROM v2_profiles p JOIN v2_profile_revisions r ON r.profile_id=p.id AND r.revision=p.revision WHERE p.id=? AND p.revision=? AND r.status='submitted' AND p.owner_id!=? AND ${verifiedProfile} AND ${ownerAlive} AND ${moderatorSql}`,
            [
              claimId,
              profileId,
              decision.expectedRevision,
              reviewer.ownerId,
              row.owner_id,
              ...moderatorValues(reviewer, sessionId),
            ],
          ),
          core.statement(
            `INSERT INTO v2_moderation_decisions(id,target_kind,target_id,target_revision,reviewer_id,owner_id,decision,encrypted_payload,oauth_authenticated_at,created_at) SELECT ?,'profile',?,?,?,?,?,?,?,? WHERE ${sqlClaim}`,
            [
              decisionId,
              row.id,
              row.revision,
              reviewer.ownerId,
              row.owner_id,
              decision.decision === "approved" ? "approve" : "reject",
              envelope,
              new Date(oauth ?? 0).toISOString(),
              reviewer.now,
              claimId,
            ],
          ),
          core.statement(
            `UPDATE v2_profile_revisions SET status=?,reviewer_id=?,decided_at=? WHERE id=? AND ${sqlClaim}`,
            [decision.decision, reviewer.ownerId, reviewer.now, row.id, claimId],
          ),
        ];
        if (decision.decision === "approved")
          statements.push(
            ...operationStatements(
              core,
              ownerActor,
              {
                id: admission.operationId,
                workspaceId: null,
                kind: "profile_revision",
                revision: row.revision,
                route: `/internal/profiles/${profileId}/publication`,
                key: admission.key,
                requestHash: admission.requestHash,
              },
              claimId,
            ),
            core.statement(
              `INSERT INTO v2_outbox(id,operation_id,kind,target_id,revision,next_attempt_at,created_at) SELECT ?,?,'profile_publish',?,?,?,? WHERE ${sqlClaim}`,
              [
                crypto.randomUUID(),
                admission.operationId,
                profileId,
                row.revision,
                reviewer.now,
                reviewer.now,
                claimId,
              ],
            ),
          );
        statements.push(core.finish(claimId));
        return core.changed(statements);
      });
    },
    withdrawProfile(
      actor: Actor,
      profileId: string,
      expectedRevision: number,
      kind: "submission" | "publication",
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, profileId);
        parse(revisionSchema, expectedRevision);
        parse(z.enum(["submission", "publication"]), kind);
        const claimId = crypto.randomUUID();
        const row = await core
          .statement(
            "SELECT r.id FROM v2_profile_revisions r JOIN v2_profiles p ON p.id=r.profile_id WHERE p.id=? AND p.owner_id=? AND r.revision=? AND ((?='submission' AND r.status='submitted') OR (?='publication' AND r.status='approved' AND p.approved_revision_id=r.id))",
            [profileId, actor.ownerId, expectedRevision, kind, kind],
          )
          .first<{ id: string }>();
        if (!row) return false;
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,p.owner_id,p.id,p.revision FROM v2_profiles p JOIN v2_profile_revisions r ON r.profile_id=p.id WHERE p.id=? AND p.owner_id=? AND r.id=? AND r.revision=? AND ((?='submission' AND r.status='submitted') OR (?='publication' AND r.status='approved' AND p.approved_revision_id=r.id)) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=p.owner_id) OR (target_kind='profile' AND target_id=p.id))`,
            [claimId, profileId, actor.ownerId, row.id, expectedRevision, kind, kind],
          ),
          core.statement(
            `UPDATE v2_profile_revisions SET status='withdrawn',withdrawn_at=? WHERE id=? AND ${sqlClaim}`,
            [actor.now, row.id, claimId],
          ),
          core.statement(
            `DELETE FROM v2_public_profiles WHERE profile_id=? AND revision_id=? AND ?='publication' AND ${sqlClaim}`,
            [profileId, row.id, kind, claimId],
          ),
          core.statement(
            `UPDATE v2_profiles SET approved_revision_id=CASE WHEN approved_revision_id=? THEN NULL ELSE approved_revision_id END,updated_at=? WHERE id=? AND ${sqlClaim}`,
            [row.id, actor.now, profileId, claimId],
          ),
          core.finish(claimId),
        ]);
      });
    },
    publishApproved(
      actor: Actor,
      lawyer: V2PublicLawyer,
      publicBlobIds: Readonly<Record<string, string>>,
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const publicDto = parse(v2PublicLawyerSchema, lawyer);
        const row = await core
          .statement(
            "SELECT r.*,p.owner_id FROM v2_profile_revisions r JOIN v2_profiles p ON p.id=r.profile_id WHERE p.id=? AND p.owner_id=? AND r.revision=? AND r.status='approved'",
            [lawyer.id, actor.ownerId, lawyer.approvedRevision],
          )
          .first<ProfileRevisionRow>();
        if (!row) return false;
        const approved = await decodeRevision(row);
        if (JSON.stringify(approved.content) !== JSON.stringify(publicDto.content)) return false;
        const claimId = crypto.randomUUID();
        const statements = [
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,p.owner_id,p.id,p.revision FROM v2_profiles p JOIN v2_profile_revisions r ON r.profile_id=p.id WHERE p.id=? AND p.owner_id=? AND r.id=? AND r.status='approved' AND ${verifiedProfile} AND ${ownerAlive} AND (p.approved_revision_id IS NULL OR (SELECT revision FROM v2_profile_revisions WHERE id=p.approved_revision_id)<r.revision)`,
            [claimId, lawyer.id, actor.ownerId, row.id, actor.ownerId],
          ),
          core.statement(
            `INSERT INTO v2_public_profiles(profile_id,revision_id,approved_revision,content_json,published_at) SELECT ?,?,?,?,? WHERE ${sqlClaim} ON CONFLICT(profile_id) DO UPDATE SET revision_id=excluded.revision_id,approved_revision=excluded.approved_revision,content_json=excluded.content_json,published_at=excluded.published_at`,
            [lawyer.id, row.id, row.revision, JSON.stringify(publicDto), actor.now, claimId],
          ),
          core.statement(`DELETE FROM v2_public_assets WHERE profile_id=? AND ${sqlClaim}`, [
            lawyer.id,
            claimId,
          ]),
        ];
        for (const asset of publicDto.assets) {
          const blobId = parse(opaqueIdSchema, publicBlobIds[asset.id]);
          const source = await core
            .statement(
              "SELECT a.revision,a.encrypted_payload AS asset_payload,s.encrypted_payload AS source_payload,b.encrypted_payload AS public_payload,a.sanitized_blob_id FROM v2_assets a JOIN v2_blobs s ON s.id=a.sanitized_blob_id JOIN v2_blobs b ON b.id=? JOIN v2_profile_revision_assets ra ON ra.asset_id=a.id AND ra.asset_revision=a.revision WHERE a.id=? AND a.owner_id=? AND ra.revision_id=? AND a.state='ready' AND s.state='stored' AND b.state='stored'",
              [blobId, asset.id, actor.ownerId, row.id],
            )
            .first<{
              revision: number;
              asset_payload: string;
              source_payload: string;
              public_payload: string;
              sanitized_blob_id: string;
            }>();
          if (!source) return false;
          const sourceAsset = await core.decrypt(
            "v2_assets",
            asset.id,
            actor.ownerId,
            source.revision,
            source.asset_payload,
            v2PortfolioAssetSchema,
          );
          const sourceHash = await core.decrypt(
            "v2_blobs",
            source.sanitized_blob_id,
            actor.ownerId,
            1,
            source.source_payload,
            z.strictObject({ contentHash: z.string().regex(/^[a-f0-9]{64}$/) }),
          );
          const publicHash = await core.decrypt(
            "v2_blobs",
            blobId,
            actor.ownerId,
            1,
            source.public_payload,
            z.strictObject({ contentHash: z.string().regex(/^[a-f0-9]{64}$/) }),
          );
          if (
            sourceHash.contentHash !== asset.contentHash ||
            publicHash.contentHash !== asset.contentHash ||
            sourceAsset.kind !== asset.kind ||
            sourceAsset.sanitizedDerivative?.contentHash !== asset.contentHash ||
            sourceAsset.sanitizedDerivative?.byteLength !== asset.byteLength
          )
            return false;
          statements.push(
            core.statement(
              `INSERT INTO v2_public_assets(profile_id,revision_id,asset_id,sanitized_blob_id,public_blob_id) SELECT ?,?,a.id,a.sanitized_blob_id,b.id FROM v2_assets a JOIN v2_profile_revision_assets ra ON ra.asset_id=a.id AND ra.asset_revision=a.revision JOIN v2_blobs b ON b.id=? WHERE a.id=? AND a.owner_id=? AND ra.revision_id=? AND a.state='ready' AND a.encrypted_payload=? AND b.encrypted_payload=? AND b.kind='public_copy' AND b.visibility='public' AND b.state='stored' AND b.logical_bytes=? AND b.source_blob_id=a.sanitized_blob_id AND b.source_asset_revision=ra.asset_revision AND b.approved_revision_id=ra.revision_id AND EXISTS(SELECT 1 FROM v2_billing_principals principal JOIN v2_storage_reservations reservation ON reservation.principal_id=principal.id WHERE principal.id=b.principal_id AND principal.owner_id=a.owner_id AND reservation.id=b.reservation_id AND reservation.kind='lawyer_asset' AND reservation.entity_id=a.id) AND EXISTS(SELECT 1 FROM v2_blobs s WHERE s.id=b.source_blob_id AND s.state='stored' AND s.visibility='staging' AND s.encrypted_payload=?) AND ${sqlClaim}`,
              [
                lawyer.id,
                row.id,
                blobId,
                asset.id,
                actor.ownerId,
                row.id,
                source.asset_payload,
                source.public_payload,
                asset.byteLength,
                source.source_payload,
                claimId,
              ],
            ),
          );
        }
        statements.push(
          core.statement(
            "UPDATE v2_mutation_claims SET verified=CASE WHEN (SELECT count(*) FROM v2_public_assets WHERE profile_id=?)=? THEN 1 ELSE 0 END WHERE id=?",
            [lawyer.id, publicDto.assets.length, claimId],
          ),
          core.statement(
            `UPDATE v2_profiles SET approved_revision_id=?,updated_at=? WHERE id=? AND ${sqlClaim}`,
            [row.id, actor.now, lawyer.id, claimId],
          ),
          core.finish(claimId),
        );
        return core.changed(statements);
      });
    },
    publicProfile(id: string) {
      return safe(async () => {
        parse(opaqueIdSchema, id);
        const row = await core
          .statement(
            "SELECT pub.content_json FROM v2_public_profiles pub JOIN v2_profiles p ON p.id=pub.profile_id JOIN v2_profile_revisions r ON r.id=pub.revision_id WHERE pub.profile_id=? AND p.approved_revision_id=pub.revision_id AND r.status='approved' AND EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=p.owner_id AND role='verified_lawyer') AND EXISTS(SELECT 1 FROM v2_applications WHERE id=r.application_id AND owner_id=p.owner_id AND status='approved') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=p.owner_id) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='profile' AND target_id=p.id)",
            [id],
          )
          .first<{ content_json: string }>();
        return row ? parse(v2PublicLawyerSchema, JSON.parse(row.content_json)) : null;
      });
    },
    reserveAsset(
      actor: Actor,
      profileId: string,
      expectedRevision: number,
      id: string,
      request: V2LawyerAssetUploadRequest,
      reservationId: string,
      admission: Admission,
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const body = parse(v2LawyerAssetUploadRequestSchema, request);
        parse(admissionSchema, admission);
        parse(opaqueIdSchema, id);
        parse(opaqueIdSchema, reservationId);
        if (!(await accounting.ensurePrincipal(actor))) return false;
        const claimId = crypto.randomUUID();
        const predicate = storagePredicate(actor.ownerId, body.byteLength);
        const envelope = await core.encrypt("v2_assets", id, actor.ownerId, 1, { request: body });
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,owner_id,id,revision FROM v2_profiles WHERE id=? AND owner_id=? AND revision=? AND ${ownerAlive} AND ${predicate.sql} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='profile' AND target_id=?)`,
            [
              claimId,
              profileId,
              actor.ownerId,
              expectedRevision,
              actor.ownerId,
              ...predicate.values,
              profileId,
            ],
          ),
          ...operationStatements(
            core,
            actor,
            {
              id: admission.operationId,
              workspaceId: null,
              kind: "profile_asset",
              revision: 1,
              route: `/api/v2/lawyers/${profileId}/assets`,
              key: admission.key,
              requestHash: admission.requestHash,
            },
            claimId,
          ),
          ...storageReservationStatements(
            core,
            actor,
            {
              id: reservationId,
              kind: "lawyer_asset",
              profileId,
              assetId: id,
              byteLength: body.byteLength,
              state: "reserved",
            },
            admission.operationId,
            claimId,
          ),
          core.statement(
            `INSERT INTO v2_assets(id,owner_id,profile_id,purpose,state,encrypted_payload,created_at) SELECT ?,?,?,?,'reserved',?,? WHERE ${sqlClaim}`,
            [id, actor.ownerId, profileId, body.purpose, envelope, actor.now, claimId],
          ),
          core.finish(claimId),
        ]);
      });
    },
    saveAsset(
      actor: Actor,
      id: string,
      expectedRevision: number,
      value: unknown,
      originalBlobId: string,
      sanitizedBlobId: string | null,
      lease?: JobLease,
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const parsed = v2VerificationAssetSchema.safeParse(value);
        const asset = parsed.success ? parsed.data : parse(v2PortfolioAssetSchema, value);
        if (asset.id !== id) return false;
        const row = await core
          .statement(
            "SELECT purpose,profile_id,encrypted_payload,current_job_id,state FROM v2_assets WHERE id=? AND owner_id=? AND revision=?",
            [id, actor.ownerId, expectedRevision],
          )
          .first<{
            purpose: string;
            profile_id: string;
            encrypted_payload: string;
            current_job_id: string | null;
            state: string;
          }>();
        if (!row) return false;
        if (
          (row.current_job_id !== null && (!lease || lease.jobId !== row.current_job_id)) ||
          (lease && row.current_job_id !== lease.jobId) ||
          (!lease && !["reserved", "uploaded"].includes(row.state))
        )
          return false;
        if (
          ("purpose" in asset
            ? asset.purpose !== row.purpose
            : asset.revision !== expectedRevision + 1 ||
              !["portfolio", "profile_photo"].includes(row.purpose)) ||
          (row.purpose === "profile_photo" && "kind" in asset && asset.kind !== "image")
        )
          return false;
        const originalKind =
          row.purpose === "portfolio"
            ? "portfolio_original"
            : row.purpose === "profile_photo"
              ? "profile_photo_original"
              : "verification";
        const original = await core
          .statement(
            "SELECT b.encrypted_payload,b.logical_bytes FROM v2_blobs b JOIN v2_storage_reservations r ON r.id=b.reservation_id JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=? AND r.kind='lawyer_asset' AND r.entity_id=? AND b.kind=? AND b.visibility='private' AND b.state='stored'",
            [originalBlobId, actor.ownerId, id, originalKind],
          )
          .first<{ encrypted_payload: string; logical_bytes: number }>();
        if (!original || original.logical_bytes !== asset.byteLength) return false;
        const originalHash = await core.decrypt(
          "v2_blobs",
          originalBlobId,
          actor.ownerId,
          1,
          original.encrypted_payload,
          z.strictObject({ contentHash: z.string().regex(/^[a-f0-9]{64}$/) }),
        );
        if (
          originalHash.contentHash !==
          ("contentHash" in asset ? asset.contentHash : asset.originalHash)
        )
          return false;
        let sanitized: { encrypted_payload: string; logical_bytes: number } | null = null;
        if ("sanitizedDerivative" in asset && asset.sanitizedDerivative) {
          if (!sanitizedBlobId) return false;
          sanitized = await core
            .statement(
              "SELECT b.encrypted_payload,b.logical_bytes FROM v2_blobs b JOIN v2_storage_reservations r ON r.id=b.reservation_id JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=? AND r.kind='lawyer_asset' AND r.entity_id=? AND b.kind=? AND b.visibility='staging' AND b.state='stored'",
              [
                sanitizedBlobId,
                actor.ownerId,
                id,
                row.purpose === "profile_photo" ? "profile_photo_sanitized" : "portfolio_sanitized",
              ],
            )
            .first();
          if (!sanitized || sanitized.logical_bytes !== asset.sanitizedDerivative.byteLength)
            return false;
          const hash = await core.decrypt(
            "v2_blobs",
            sanitizedBlobId,
            actor.ownerId,
            1,
            sanitized.encrypted_payload,
            z.strictObject({ contentHash: z.string().regex(/^[a-f0-9]{64}$/) }),
          );
          if (hash.contentHash !== asset.sanitizedDerivative.contentHash) return false;
        } else if (sanitizedBlobId !== null) return false;
        const envelope = await core.encrypt(
          "v2_assets",
          id,
          actor.ownerId,
          expectedRevision + 1,
          asset,
        );
        const claimId = crypto.randomUUID();
        const baseLease = lease ? leasePredicate(lease, id, expectedRevision, actor.now) : null;
        const execution =
          lease && baseLease
            ? {
                sql: `a.current_job_id=? AND ${baseLease.sql}`,
                values: [lease.jobId, ...baseLease.values],
              }
            : {
                sql: "a.current_job_id IS NULL AND a.state IN ('reserved','uploaded') AND NOT EXISTS(SELECT 1 FROM v2_jobs WHERE target_kind='profile_asset' AND target_id=a.id)",
                values: [],
              };
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,a.owner_id,a.id,a.revision FROM v2_assets a JOIN v2_profiles p ON p.id=a.profile_id JOIN v2_blobs b ON b.id=? JOIN v2_storage_reservations br ON br.id=b.reservation_id JOIN v2_billing_principals principal ON principal.id=b.principal_id WHERE a.id=? AND a.owner_id=? AND a.revision=? AND a.state IN ('reserved','uploaded','sanitizing','failed') AND a.encrypted_payload=? AND ${execution.sql} AND principal.owner_id=a.owner_id AND br.kind='lawyer_asset' AND br.entity_id=a.id AND b.kind=? AND b.state='stored' AND b.visibility='private' AND b.encrypted_payload=? AND ${ownerAlive} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='asset' AND target_id=a.id) OR (target_kind='profile' AND target_id=p.id)) AND (? IS NULL OR EXISTS(SELECT 1 FROM v2_blobs s JOIN v2_billing_principals sp ON sp.id=s.principal_id JOIN v2_storage_reservations sr ON sr.id=s.reservation_id WHERE s.id=? AND s.state='stored' AND s.visibility='staging' AND sp.owner_id=a.owner_id AND sr.kind='lawyer_asset' AND sr.entity_id=a.id AND s.kind=? AND s.encrypted_payload=?))`,
            [
              claimId,
              originalBlobId,
              id,
              actor.ownerId,
              expectedRevision,
              row.encrypted_payload,
              ...execution.values,
              originalKind,
              original.encrypted_payload,
              actor.ownerId,
              sanitizedBlobId,
              sanitizedBlobId,
              row.purpose === "profile_photo" ? "profile_photo_sanitized" : "portfolio_sanitized",
              sanitized?.encrypted_payload ?? null,
            ],
          ),
          core.statement(
            `UPDATE v2_assets SET revision=revision+1,state=?,original_blob_id=?,sanitized_blob_id=?,current_job_id=?,failure_code=?,encrypted_payload=? WHERE id=? AND ${sqlClaim}`,
            [
              asset.status,
              originalBlobId,
              sanitizedBlobId,
              "currentJobId" in asset ? asset.currentJobId : null,
              "failure" in asset ? asset.failure : null,
              envelope,
              id,
              claimId,
            ],
          ),
          ...(lease ? completeLeaseStatements(core, lease, claimId, actor.now) : []),
          core.finish(claimId),
        ]);
      });
    },
    saveModerationReport(
      actor: Actor,
      report: V2ModerationReport,
      expectedRevision: number | null,
      sessionId?: string,
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const value = parse(v2ModerationReportSchema, report);
        if (value.revision !== (expectedRevision ?? 0) + 1) return false;
        const profile = await core
          .statement(
            "SELECT p.owner_id FROM v2_public_profiles pub JOIN v2_profiles p ON p.id=pub.profile_id WHERE pub.profile_id=? AND pub.approved_revision=?",
            [value.profileId, value.profileRevision],
          )
          .first<{ owner_id: string }>();
        if (!profile) return false;
        if (
          expectedRevision === null &&
          (value.status !== "open" || value.resolution !== null || value.createdAt !== actor.now)
        )
          return false;
        if (expectedRevision !== null && !sessionId) return false;
        const previous =
          expectedRevision === null
            ? null
            : await core
                .statement(
                  "SELECT * FROM v2_moderation_reports WHERE id=? AND profile_id=? AND revision=?",
                  [value.id, value.profileId, expectedRevision],
                )
                .first<{ encrypted_payload: string; created_at: string; kind: string }>();
        if (expectedRevision !== null) {
          if (!previous) return false;
          const prior = await core.decrypt(
            "v2_moderation_reports",
            value.id,
            profile.owner_id,
            expectedRevision,
            previous.encrypted_payload,
            v2ModerationReportSchema,
          );
          if (
            prior.profileRevision !== value.profileRevision ||
            prior.kind !== value.kind ||
            prior.createdAt !== value.createdAt ||
            value.status === "open" ||
            ["resolved", "dismissed"].includes(prior.status)
          )
            return false;
        }
        const claimId = crypto.randomUUID();
        const envelope = await core.encrypt(
          "v2_moderation_reports",
          value.id,
          profile.owner_id,
          value.revision,
          value,
        );
        const guard =
          expectedRevision === null
            ? `EXISTS(SELECT 1 FROM user WHERE id=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=?)) AND NOT EXISTS(SELECT 1 FROM v2_moderation_reports WHERE id=?)`
            : `${moderatorSql} AND EXISTS(SELECT 1 FROM v2_moderation_reports WHERE id=? AND profile_id=p.id AND revision=? AND encrypted_payload=?)`;
        const values =
          expectedRevision === null
            ? [actor.ownerId, actor.ownerId, value.id]
            : [
                ...moderatorValues(actor, sessionId ?? ""),
                value.id,
                expectedRevision,
                previous?.encrypted_payload,
              ];
        const statements = [
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,p.owner_id,p.id,p.revision FROM v2_profiles p JOIN v2_public_profiles pub ON pub.profile_id=p.id WHERE p.id=? AND pub.approved_revision=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=p.owner_id) OR (target_kind='profile' AND target_id=p.id)) AND ${guard}`,
            [claimId, value.profileId, value.profileRevision, ...values],
          ),
        ];
        if (expectedRevision === null)
          statements.push(
            core.statement(
              `INSERT INTO v2_moderation_reports(id,profile_id,reporter_id,kind,state,revision,resolution,encrypted_payload,created_at) SELECT ?,?,?,?,'open',1,NULL,?,? WHERE ${sqlClaim}`,
              [
                value.id,
                value.profileId,
                actor.ownerId,
                value.kind,
                envelope,
                value.createdAt,
                claimId,
              ],
            ),
          );
        else
          statements.push(
            core.statement(
              `UPDATE v2_moderation_reports SET state=?,revision=?,resolution=?,encrypted_payload=? WHERE id=? AND revision=? AND ${sqlClaim}`,
              [
                value.status,
                value.revision,
                value.resolution === null ? null : "recorded",
                envelope,
                value.id,
                expectedRevision,
                claimId,
              ],
            ),
          );
        statements.push(core.finish(claimId));
        return core.changed(statements);
      });
    },
  };
}
