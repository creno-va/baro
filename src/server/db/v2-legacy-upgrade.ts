import { z } from "zod";
import {
  answersForQuestionsSchema,
  citationSchema,
  createCaseRequestSchema,
  opaqueIdSchema,
  questionsSchema,
  timestampSchema,
} from "../../contracts";
import { v2UpgradeRequestSchema } from "../../contracts/v2";
import { MAX_ENVELOPE_CHARACTERS } from "../crypto";
import { createV2AccountingRepository, operationStatements } from "./v2-accounting";
import {
  type Actor,
  actorSchema,
  fragmentText,
  hashSchema,
  parse,
  readSnapshot,
  safe,
  snapshotChain,
  sqlClaim,
  utf8Bytes,
  type V2Core,
} from "./v2-core";
import { type Admission, admissionSchema } from "./v2-workspace";

const sourceSchema = z.strictObject({
  caseId: opaqueIdSchema,
  inputRevision: z.number().int().positive(),
  status: z.enum(["completed", "failed"]),
  updatedAt: timestampSchema,
  encryptedInput: z.string().max(MAX_ENVELOPE_CHARACTERS),
  analysis: z
    .strictObject({
      id: opaqueIdSchema,
      input_revision: z.number().int().positive(),
      attempt: z.number().int().positive(),
      status: z.enum(["completed", "failed"]),
      updated_at: timestampSchema,
      encrypted_context: z.string().max(MAX_ENVELOPE_CHARACTERS).nullable(),
      encrypted_answers: z.string().max(MAX_ENVELOPE_CHARACTERS).nullable(),
      encrypted_result: z.string().max(MAX_ENVELOPE_CHARACTERS).nullable(),
    })
    .nullable(),
  citations: z
    .array(
      z.strictObject({
        id: opaqueIdSchema,
        source_type: z.literal("statute"),
        source_id: citationSchema.shape.sourceId,
        law_name: citationSchema.shape.lawName,
        article: citationSchema.shape.article,
        effective_date: citationSchema.shape.effectiveDate,
        verified_at: citationSchema.shape.verifiedAt,
        source_url: citationSchema.shape.url,
        content_hash: hashSchema,
      }),
    )
    .max(50),
});
type Source = z.infer<typeof sourceSchema>;
type Stage = {
  snapshot_id: string;
  owner_id: string;
  legacy_case_id: string;
  workspace_target_id: string;
  source_revision: number;
  source_digest: string;
  encrypted_payload: string;
  expires_at: string;
};
const stageSchema = z.strictObject({
  narrative: createCaseRequestSchema.shape.narrative,
  admission: admissionSchema,
});
const digest = async (text: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
// v1 initially stores {narrative}; each answer revision wraps the previous JSON
// string alongside that revision's validated answers/questions. Keep all original
// ciphertext in the immutable snapshot and extract only the user's initial text.
const legacyNarrative = (text: string) => {
  if (utf8Bytes(text) > 256 * 1024) throw new Error("REPOSITORY_INPUT_INVALID");
  for (let depth = 0; depth < 32; depth++) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return parse(createCaseRequestSchema.shape.narrative, text);
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || !("narrative" in value))
      return parse(createCaseRequestSchema.shape.narrative, text);
    const wrapper = parse(
      z.strictObject({
        narrative: z.string(),
        answers: z.unknown().optional(),
        questions: z.unknown().optional(),
      }),
      value,
    );
    if (wrapper.answers !== undefined || wrapper.questions !== undefined) {
      const questions = parse(questionsSchema, wrapper.questions);
      parse(answersForQuestionsSchema(questions), { inputRevision: 2, answers: wrapper.answers });
      text = wrapper.narrative;
      continue;
    }
    return parse(createCaseRequestSchema.shape.narrative, wrapper.narrative);
  }
  throw new Error("REPOSITORY_INPUT_INVALID");
};
export function createV2LegacyUpgradeRepository(core: V2Core) {
  const capture = async (actor: Actor, caseId: string, revision: number) => {
    const row = await core
      .statement(
        "SELECT id,input_revision,status,updated_at,encrypted_input,current_analysis_id FROM cases WHERE id=? AND user_id=? AND input_revision=? AND status IN ('completed','failed') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=user_id)",
        [caseId, actor.ownerId, revision],
      )
      .first<{
        id: string;
        input_revision: number;
        status: "completed" | "failed";
        updated_at: string;
        encrypted_input: string;
        current_analysis_id: string | null;
      }>();
    if (!row) return null;
    const analysis = row.current_analysis_id
      ? await core
          .statement(
            "SELECT id,input_revision,attempt,status,updated_at,encrypted_context,encrypted_answers,encrypted_result FROM analyses WHERE id=? AND case_id=? AND status IN ('completed','failed')",
            [row.current_analysis_id, caseId],
          )
          .first<Source["analysis"]>()
      : null;
    if (row.current_analysis_id && (!analysis || analysis.input_revision !== row.input_revision))
      return null;
    const citations = analysis
      ? (
          await core
            .statement(
              "SELECT id,source_type,source_id,law_name,article,effective_date,verified_at,source_url,content_hash FROM citations WHERE analysis_id=? ORDER BY id",
              [analysis.id],
            )
            .all<Source["citations"][number]>()
        ).results
      : [];
    const source = parse(sourceSchema, {
      caseId,
      inputRevision: row.input_revision,
      status: row.status,
      updatedAt: row.updated_at,
      encryptedInput: row.encrypted_input,
      analysis,
      citations,
    });
    const text = JSON.stringify(source);
    const fragments = fragmentText(text);
    return { source, fragments, textHash: await digest(text), bytes: utf8Bytes(text) };
  };
  const sourceGuard = (s: Source) => ({
    sql: "EXISTS(SELECT 1 FROM cases c WHERE c.id=? AND c.user_id=? AND c.input_revision=? AND c.status=? AND c.updated_at=? AND c.encrypted_input=? AND c.current_analysis_id IS ? AND (? IS NULL OR EXISTS(SELECT 1 FROM analyses a WHERE a.id=c.current_analysis_id AND a.case_id=c.id AND a.input_revision=? AND a.attempt=? AND a.status=? AND a.updated_at=? AND a.encrypted_context IS ? AND a.encrypted_answers IS ? AND a.encrypted_result IS ?))) AND (SELECT count(*) FROM citations WHERE analysis_id IS ?) = ? AND NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM citations c WHERE c.id=json_extract(e.value,'$.id') AND c.analysis_id=? AND c.source_type=json_extract(e.value,'$.source_type') AND c.source_id=json_extract(e.value,'$.source_id') AND c.law_name=json_extract(e.value,'$.law_name') AND c.article=json_extract(e.value,'$.article') AND c.effective_date=json_extract(e.value,'$.effective_date') AND c.verified_at=json_extract(e.value,'$.verified_at') AND c.source_url=json_extract(e.value,'$.source_url') AND c.content_hash=json_extract(e.value,'$.content_hash')))",
    values: (ownerId: string) => [
      s.caseId,
      ownerId,
      s.inputRevision,
      s.status,
      s.updatedAt,
      s.encryptedInput,
      s.analysis?.id ?? null,
      s.analysis?.id ?? null,
      s.analysis?.input_revision ?? null,
      s.analysis?.attempt ?? null,
      s.analysis?.status ?? null,
      s.analysis?.updated_at ?? null,
      s.analysis?.encrypted_context ?? null,
      s.analysis?.encrypted_answers ?? null,
      s.analysis?.encrypted_result ?? null,
      s.analysis?.id ?? null,
      s.citations.length,
      JSON.stringify(s.citations),
      s.analysis?.id ?? null,
    ],
  });
  const stageFor = (actor: Actor, id: string) =>
    core
      .statement(
        "SELECT u.* FROM v2_upgrade_stages u JOIN v2_private_snapshots s ON s.id=u.snapshot_id WHERE u.snapshot_id=? AND u.owner_id=? AND u.expires_at>? AND s.state IN ('staging','sealed') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=u.owner_id) OR (target_kind='workspace' AND target_id=u.workspace_target_id))",
        [id, actor.ownerId, actor.now],
      )
      .first<Stage>();
  return {
    begin(
      actor: Actor,
      input: {
        snapshotId: string;
        workspaceId: string;
        legacyCaseId: string;
        request: unknown;
        admission: Admission;
        expiresAt: string;
      },
    ) {
      return safe(async () => {
        actor = parse(actorSchema, actor);
        for (const id of [input.snapshotId, input.workspaceId, input.legacyCaseId])
          parse(opaqueIdSchema, id);
        const request = parse(v2UpgradeRequestSchema, input.request);
        parse(admissionSchema, input.admission);
        const expiresAt = new Date(parse(timestampSchema, input.expiresAt)).toISOString();
        if (
          Date.parse(expiresAt) <= Date.parse(actor.now) ||
          Date.parse(expiresAt) - Date.parse(actor.now) > 86400000
        )
          return null;
        const source = await capture(actor, input.legacyCaseId, request.expectedRevision);
        if (!source) return null;
        const old = await stageFor(actor, input.snapshotId);
        if (old)
          return old.workspace_target_id === input.workspaceId &&
            old.source_digest === source.textHash
            ? {
                snapshotId: input.snapshotId,
                partCount: source.fragments.length,
                byteLength: source.bytes,
              }
            : null;
        const narrative = legacyNarrative(
          await core.cipher.decrypt(source.source.encryptedInput, {
            table: "cases",
            column: "encrypted_input",
            rowId: input.legacyCaseId,
            userId: actor.ownerId,
          }),
        );
        const payload = await core.encrypt(
          "v2_upgrade_stages",
          input.snapshotId,
          actor.ownerId,
          1,
          { narrative, admission: input.admission },
        );
        const integrity = await core.encrypt(
          "v2_private_snapshots",
          input.snapshotId,
          actor.ownerId,
          1,
          {
            format: "chain_v1",
            digest: "0".repeat(64),
            purpose: "legacy_snapshot",
            targetId: input.workspaceId,
            partCount: source.fragments.length,
          },
        );
        const claimId = crypto.randomUUID();
        const condition = sourceGuard(source.source);
        const changed = await core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,id,?,1 FROM user WHERE id=? AND ${condition.sql} AND NOT EXISTS(SELECT 1 FROM v2_workspaces WHERE legacy_case_id=?) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=user.id) OR (target_kind='workspace' AND target_id=?))`,
            [
              claimId,
              input.workspaceId,
              actor.ownerId,
              ...condition.values(actor.ownerId),
              input.legacyCaseId,
              input.workspaceId,
            ],
          ),
          core.statement(
            `INSERT INTO v2_private_snapshots(id,owner_id,purpose,target_id,revision,part_count,byte_length,encrypted_payload,created_at,state) SELECT ?,?,'legacy_snapshot',?,1,?,?,?,?,'staging' WHERE ${sqlClaim}`,
            [
              input.snapshotId,
              actor.ownerId,
              input.workspaceId,
              source.fragments.length,
              source.bytes,
              integrity,
              actor.now,
              claimId,
            ],
          ),
          core.statement(
            `INSERT INTO v2_upgrade_stages(snapshot_id,owner_id,legacy_case_id,workspace_target_id,source_revision,source_digest,encrypted_payload,expires_at,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${sqlClaim}`,
            [
              input.snapshotId,
              actor.ownerId,
              input.legacyCaseId,
              input.workspaceId,
              request.expectedRevision,
              source.textHash,
              payload,
              expiresAt,
              actor.now,
              claimId,
            ],
          ),
          core.finish(claimId),
        ]);
        return changed
          ? {
              snapshotId: input.snapshotId,
              partCount: source.fragments.length,
              byteLength: source.bytes,
            }
          : null;
      });
    },
    append(actor: Actor, snapshotId: string, index: number) {
      return safe(async () => {
        actor = parse(actorSchema, actor);
        parse(z.number().int().min(0).max(99999), index);
        const stage = await stageFor(actor, snapshotId);
        if (!stage) return false;
        const source = await capture(actor, stage.legacy_case_id, stage.source_revision);
        if (!source || source.textHash !== stage.source_digest) return false;
        const text = source.fragments[index];
        if (!text) return false;
        const header = await core
          .statement(
            "SELECT written_parts,written_bytes,encrypted_payload FROM v2_private_snapshots WHERE id=? AND state='staging'",
            [snapshotId],
          )
          .first<{ written_parts: number; written_bytes: number; encrypted_payload: string }>();
        if (!header) return false;
        if (index < header.written_parts) {
          const part = await core
            .statement(
              "SELECT id,encrypted_payload FROM v2_private_parts WHERE snapshot_id=? AND part_index=?",
              [snapshotId, index],
            )
            .first<{ id: string; encrypted_payload: string }>();
          return part
            ? (await core.cipher.decrypt(part.encrypted_payload, {
                table: "v2_private_parts",
                column: "encrypted_payload",
                rowId: part.id,
                userId: actor.ownerId,
                revision: 1,
                targetId: stage.workspace_target_id,
                purpose: "legacy_snapshot",
                part: index,
              })) === text
            : false;
        }
        if (index !== header.written_parts) return false;
        const integrity = await core.decrypt(
          "v2_private_snapshots",
          snapshotId,
          actor.ownerId,
          1,
          header.encrypted_payload,
          z.strictObject({
            format: z.literal("chain_v1"),
            digest: hashSchema,
            purpose: z.literal("legacy_snapshot"),
            targetId: opaqueIdSchema,
            partCount: z.number().int().positive(),
          }),
        );
        const id = crypto.randomUUID();
        const envelope = await core.cipher.encrypt(text, {
          table: "v2_private_parts",
          column: "encrypted_payload",
          rowId: id,
          userId: actor.ownerId,
          revision: 1,
          targetId: stage.workspace_target_id,
          purpose: "legacy_snapshot",
          part: index,
        });
        const next = await core.encrypt("v2_private_snapshots", snapshotId, actor.ownerId, 1, {
          ...integrity,
          digest: await snapshotChain(integrity.digest, index, text),
        });
        const condition = sourceGuard(source.source);
        const claimId = crypto.randomUUID();
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,u.owner_id,u.workspace_target_id,1 FROM v2_upgrade_stages u JOIN v2_private_snapshots s ON s.id=u.snapshot_id WHERE u.snapshot_id=? AND u.owner_id=? AND u.source_digest=? AND u.expires_at>? AND s.state='staging' AND s.written_parts=? AND s.encrypted_payload=? AND ${condition.sql} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=u.owner_id) OR (target_kind='workspace' AND target_id=u.workspace_target_id))`,
            [
              claimId,
              snapshotId,
              actor.ownerId,
              source.textHash,
              actor.now,
              index,
              header.encrypted_payload,
              ...condition.values(actor.ownerId),
            ],
          ),
          core.statement(
            `INSERT INTO v2_private_parts(id,snapshot_id,part_index,byte_length,encrypted_payload) SELECT ?,?,?,?,? WHERE ${sqlClaim}`,
            [id, snapshotId, index, utf8Bytes(text), envelope, claimId],
          ),
          core.statement(
            `UPDATE v2_private_snapshots SET written_parts=written_parts+1,written_bytes=written_bytes+?,encrypted_payload=? WHERE id=? AND ${sqlClaim}`,
            [utf8Bytes(text), next, snapshotId, claimId],
          ),
          core.finish(claimId),
        ]);
      });
    },
    complete(actor: Actor, snapshotId: string) {
      return safe(async () => {
        actor = parse(actorSchema, actor);
        const stage = await stageFor(actor, snapshotId);
        if (!stage) return false;
        const source = await capture(actor, stage.legacy_case_id, stage.source_revision);
        if (!source || source.textHash !== stage.source_digest) return false;
        const header = await core
          .statement(
            "SELECT state,encrypted_payload,part_count,byte_length FROM v2_private_snapshots WHERE id=?",
            [snapshotId],
          )
          .first<{
            state: string;
            encrypted_payload: string;
            part_count: number;
            byte_length: number;
          }>();
        if (!header) return false;
        const integrity = await core.decrypt(
          "v2_private_snapshots",
          snapshotId,
          actor.ownerId,
          1,
          header.encrypted_payload,
          z.strictObject({
            format: z.literal("chain_v1"),
            digest: hashSchema,
            purpose: z.literal("legacy_snapshot"),
            targetId: opaqueIdSchema,
            partCount: z.number().int().positive(),
          }),
        );
        let chain = "0".repeat(64);
        const verifiedParts = [];
        for (const [index, expected] of source.fragments.entries()) {
          const part = await core
            .statement(
              "SELECT id,byte_length,encrypted_payload FROM v2_private_parts WHERE snapshot_id=? AND part_index=?",
              [snapshotId, index],
            )
            .first<{ id: string; byte_length: number; encrypted_payload: string }>();
          if (!part || part.byte_length !== utf8Bytes(expected)) return false;
          const actual = await core.cipher.decrypt(part.encrypted_payload, {
            table: "v2_private_parts",
            column: "encrypted_payload",
            rowId: part.id,
            userId: actor.ownerId,
            revision: 1,
            targetId: stage.workspace_target_id,
            purpose: "legacy_snapshot",
            part: index,
          });
          if (actual !== expected) return false;
          chain = await snapshotChain(chain, index, actual);
          verifiedParts.push({
            id: part.id,
            index,
            bytes: part.byte_length,
            payload: part.encrypted_payload,
          });
        }
        if (
          integrity.digest !== chain ||
          integrity.targetId !== stage.workspace_target_id ||
          integrity.partCount !== source.fragments.length ||
          header.part_count !== source.fragments.length ||
          header.byte_length !== source.bytes
        )
          return false;
        if (header.state === "staging") {
          const sealing = await core
            .statement(
              "UPDATE v2_private_snapshots AS s SET state='sealed' WHERE s.id=? AND s.owner_id=? AND s.state='staging' AND s.encrypted_payload=? AND (SELECT count(*) FROM v2_private_parts WHERE snapshot_id=s.id)=part_count AND (SELECT count(*) FROM json_each(?) expected JOIN v2_private_parts p ON p.id=json_extract(expected.value,'$.id') WHERE p.snapshot_id=s.id AND p.part_index=json_extract(expected.value,'$.index') AND p.byte_length=json_extract(expected.value,'$.bytes') AND p.encrypted_payload=json_extract(expected.value,'$.payload'))=part_count AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=s.owner_id) OR (target_kind='workspace' AND target_id=s.target_id))",
              [snapshotId, actor.ownerId, header.encrypted_payload, JSON.stringify(verifiedParts)],
            )
            .run();
          if (sealing.meta.changes !== 1) return false;
        }
        const data = await core.decrypt(
          "v2_upgrade_stages",
          snapshotId,
          actor.ownerId,
          1,
          stage.encrypted_payload,
          stageSchema,
        );
        const workspace = await core.encrypt(
          "v2_workspaces",
          stage.workspace_target_id,
          actor.ownerId,
          1,
          { subjectContext: "individual", jurisdiction: "KR" },
        );
        const intake = await core.encrypt(
          "v2_intakes",
          stage.workspace_target_id,
          actor.ownerId,
          1,
          { narrative: data.narrative },
        );
        const condition = sourceGuard(source.source);
        const claimId = crypto.randomUUID();
        if (!(await createV2AccountingRepository(core).ensurePrincipal(actor))) return false;
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,u.owner_id,u.workspace_target_id,1 FROM v2_upgrade_stages u JOIN v2_private_snapshots s ON s.id=u.snapshot_id WHERE u.snapshot_id=? AND u.owner_id=? AND u.source_digest=? AND u.expires_at>? AND u.encrypted_payload=? AND s.state='sealed' AND s.encrypted_payload=? AND s.written_parts=s.part_count AND s.written_bytes=s.byte_length AND (SELECT count(*) FROM v2_private_parts WHERE snapshot_id=s.id)=s.part_count AND ${condition.sql} AND NOT EXISTS(SELECT 1 FROM v2_workspaces WHERE legacy_case_id=u.legacy_case_id) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=u.owner_id) OR (target_kind='workspace' AND target_id=u.workspace_target_id))`,
            [
              claimId,
              snapshotId,
              actor.ownerId,
              source.textHash,
              actor.now,
              stage.encrypted_payload,
              header.encrypted_payload,
              ...condition.values(actor.ownerId),
            ],
          ),
          core.statement(
            `INSERT INTO v2_workspaces(id,owner_id,legacy_case_id,legacy_snapshot_id,encrypted_payload,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${sqlClaim}`,
            [
              stage.workspace_target_id,
              actor.ownerId,
              stage.legacy_case_id,
              snapshotId,
              workspace,
              actor.now,
              actor.now,
              claimId,
            ],
          ),
          core.statement(
            `INSERT INTO v2_intakes(id,status,encrypted_payload,updated_at) SELECT ?,'collecting',?,? WHERE ${sqlClaim}`,
            [stage.workspace_target_id, intake, actor.now, claimId],
          ),
          core.statement(
            `INSERT INTO v2_case_original_usage(workspace_id) SELECT ? WHERE ${sqlClaim}`,
            [stage.workspace_target_id, claimId],
          ),
          ...operationStatements(
            core,
            actor,
            {
              id: data.admission.operationId,
              workspaceId: stage.workspace_target_id,
              kind: "legacy_upgrade",
              revision: 1,
              route: `/api/v2/cases/${stage.legacy_case_id}/upgrade`,
              key: data.admission.key,
              requestHash: data.admission.requestHash,
            },
            claimId,
          ),
          core.statement(
            `UPDATE v2_private_snapshots SET state='published',workspace_id=? WHERE id=? AND ${sqlClaim}`,
            [stage.workspace_target_id, snapshotId, claimId],
          ),
          core.finish(claimId),
        ]);
      });
    },
    read(actor: Actor, workspaceId: string) {
      return safe(async () => {
        actor = parse(actorSchema, actor);
        const row = await core
          .statement(
            "SELECT legacy_snapshot_id FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=w.owner_id) OR (target_kind='workspace' AND target_id=w.id))",
            [workspaceId, actor.ownerId],
          )
          .first<{ legacy_snapshot_id: string | null }>();
        return row?.legacy_snapshot_id
          ? readSnapshot(
              core,
              actor,
              row.legacy_snapshot_id,
              "legacy_snapshot",
              workspaceId,
              1,
              sourceSchema,
            )
          : null;
      });
    },
    abandon(actor: Actor, snapshotId: string) {
      return safe(async () => {
        actor = parse(actorSchema, actor);
        return Boolean(
          await core
            .statement(
              "DELETE FROM v2_private_snapshots WHERE id=? AND owner_id=? AND state IN ('staging','sealed') AND purpose='legacy_snapshot' RETURNING id",
              [snapshotId, actor.ownerId],
            )
            .first(),
        );
      });
    },
  };
}
