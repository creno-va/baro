import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../contracts";
import {
  type V2SummaryEditRequest,
  v2FactSchema,
  v2SummaryEditRequestSchema,
  v2SummarySchema,
} from "../../contracts/v2";
import {
  aliveWorkspace,
  fragmentText,
  guardSchema,
  hashSchema,
  parse,
  safe,
  snapshotChain,
  sqlClaim,
  utf8Bytes,
  type V2Core,
  V2RepositoryError,
  type WorkspaceGuard,
} from "./v2-core";
import { referenceCommitPredicate } from "./v2-workspace";

const zero = "0".repeat(64);
const fields = [
  "schemaVersion",
  "revision",
  "intakeRevision",
  "createdAt",
  "overview",
  "facts",
  "parties",
  "unknowns",
  "notices",
] as const;
const arrays = new Set(["facts", "parties", "unknowns", "notices"]);
const integritySchema = z.strictObject({
  format: z.literal("chain_v1"),
  digest: hashSchema,
  purpose: z.literal("summary"),
  targetId: opaqueIdSchema,
  partCount: z.number().int().positive(),
});
const cursorSchema = z.strictObject({
  buffer: z.string(),
  output: z.string(),
  sourceIndex: z.number().int().nonnegative(),
  sourceBytes: z.number().int().nonnegative(),
  sourceChain: hashSchema,
  targetIndex: z.number().int().nonnegative(),
  targetBytes: z.number().int().nonnegative(),
  targetChain: hashSchema,
  phase: z.enum([
    "start",
    "key",
    "colon",
    "value",
    "array",
    "array_separator",
    "separator",
    "done",
  ]),
  field: z.string(),
  seen: z.array(z.string()).max(9),
  factCount: z.number().int().min(0).max(300),
  partyCount: z.number().int().min(0).max(30),
  unknownCount: z.number().int().min(0).max(100),
  noticeCount: z.number().int().min(0).max(10),
  edited: z.array(opaqueIdSchema).max(100),
  rootFirst: z.boolean(),
  arrayFirst: z.boolean(),
});
const initial = () =>
  parse(cursorSchema, {
    buffer: "",
    output: "",
    sourceIndex: 0,
    sourceBytes: 0,
    sourceChain: zero,
    targetIndex: 0,
    targetBytes: 0,
    targetChain: zero,
    phase: "start",
    field: "",
    seen: [],
    factCount: 0,
    partyCount: 0,
    unknownCount: 0,
    noticeCount: 0,
    edited: [],
    rootFirst: true,
    arrayFirst: true,
  });
const payloadSchema = z.strictObject({
  request: v2SummaryEditRequestSchema,
  sourceHeader: z.string(),
  sourceIntake: z.string(),
  sourcePartCount: z.number().int().positive(),
  sourceBytes: z.number().int().positive(),
  sourceDigest: hashSchema,
});
type Stage = {
  id: string;
  owner_id: string;
  workspace_id: string;
  source_summary_id: string;
  source_snapshot_id: string;
  target_snapshot_id: string;
  source_revision: number;
  target_revision: number;
  workspace_revision: number;
  intake_revision: number;
  encrypted_payload: string;
  expires_at: string;
  created_at: string;
  cursor_revision: number;
  cursor_payload: string;
};
// A streaming lexical boundary scanner: it holds one bounded field/item, never
// the complete facts array or summary. Escapes and nested reference objects are
// counted before parsing that one typed value.
function tokenLength(text: string): number | null {
  if (!text) return null;
  let quoted = false,
    escaped = false,
    depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? "";
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') {
        quoted = false;
        if (depth === 0) return i + 1;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      if (depth === 0) return i;
      depth--;
      if (depth === 0) return i + 1;
    } else if (depth === 0 && (char === "," || char === ":" || /\s/.test(char))) return i;
  }
  return null;
}
export function createV2SummaryEditsRepository(core: V2Core) {
  const find = (g: WorkspaceGuard, id: string) =>
    core
      .statement(
        `SELECT e.*,c.revision AS cursor_revision,c.encrypted_payload AS cursor_payload FROM v2_summary_edit_stages e JOIN v2_summary_edit_cursors c ON c.id=e.id JOIN v2_workspaces w ON w.id=e.workspace_id JOIN v2_intakes i ON i.id=w.id JOIN v2_summaries s ON s.id=e.source_summary_id JOIN v2_private_snapshots p ON p.id=s.snapshot_id JOIN v2_private_snapshots q ON q.id=e.target_snapshot_id WHERE e.id=? AND e.owner_id=? AND w.id=? AND w.owner_id=e.owner_id AND w.revision=? AND w.revision=e.workspace_revision AND w.status='intake' AND w.current_job_id IS NULL AND i.status='reviewing_summary' AND i.summary_id=s.id AND i.revision=e.intake_revision AND s.revision=e.source_revision AND s.snapshot_id=e.source_snapshot_id AND p.state='published' AND p.owner_id=w.owner_id AND p.workspace_id=w.id AND p.target_id=w.id AND p.purpose='summary' AND p.revision=e.source_revision AND s.workspace_id=w.id AND q.state='staging' AND q.owner_id=w.owner_id AND q.workspace_id=w.id AND q.target_id=w.id AND q.purpose='summary' AND q.revision=e.target_revision AND q.workspace_revision=w.revision AND ${aliveWorkspace} AND e.expires_at>?`,
        [id, g.ownerId, g.workspaceId, g.expectedRevision, g.now],
      )
      .first<Stage>();
  const finalClaim = (
    g: WorkspaceGuard,
    e: Stage,
    id: string,
    payload: z.infer<typeof payloadSchema>,
  ) =>
    core.claim(
      g,
      id,
      `w.status='intake' AND w.current_job_id IS NULL AND EXISTS(SELECT 1 FROM v2_summary_edit_stages e JOIN v2_summary_edit_cursors c ON c.id=e.id JOIN v2_intakes i ON i.id=e.workspace_id JOIN v2_summaries s ON s.id=e.source_summary_id JOIN v2_private_snapshots p ON p.id=e.source_snapshot_id WHERE e.id=? AND e.owner_id=w.owner_id AND e.workspace_id=w.id AND e.workspace_revision=w.revision AND e.encrypted_payload=? AND e.expires_at>? AND c.revision=? AND c.encrypted_payload=? AND i.summary_id=s.id AND i.status='reviewing_summary' AND i.revision=e.intake_revision AND i.encrypted_payload=? AND s.snapshot_id=p.id AND s.revision=e.source_revision AND p.encrypted_payload=? AND p.state='published' AND p.owner_id=w.owner_id AND p.workspace_id=w.id AND p.target_id=w.id AND p.purpose='summary' AND p.revision=e.source_revision AND EXISTS(SELECT 1 FROM v2_private_snapshots q WHERE q.id=e.target_snapshot_id AND q.state='staging' AND q.owner_id=w.owner_id AND q.workspace_id=w.id AND q.target_id=w.id AND q.purpose='summary' AND q.revision=e.target_revision AND q.workspace_revision=w.revision))`,
      [
        e.id,
        e.encrypted_payload,
        g.now,
        e.cursor_revision,
        e.cursor_payload,
        payload.sourceIntake,
        payload.sourceHeader,
      ],
    );
  const receipt = (
    stageId: string,
    kind: string,
    ordinal: number,
    sourceId: string,
    sourcePayload: string,
    targetId: string,
    targetPayload: string,
    claimId: string,
  ) =>
    core.statement(
      `INSERT INTO v2_summary_edit_receipts(stage_id,kind,ordinal,source_id,source_payload,target_id,target_payload) SELECT ?,?,?,?,?,?,? WHERE ${sqlClaim}`,
      [stageId, kind, ordinal, sourceId, sourcePayload, targetId, targetPayload, claimId],
    );
  return {
    begin(
      g: WorkspaceGuard,
      input: {
        id: string;
        summaryId: string;
        targetSnapshotId: string;
        request: V2SummaryEditRequest;
        expiresAt: string;
      },
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        for (const id of [input.id, input.summaryId, input.targetSnapshotId])
          parse(opaqueIdSchema, id);
        const request = parse(v2SummaryEditRequestSchema, input.request);
        const expiresAt = new Date(parse(timestampSchema, input.expiresAt)).toISOString();
        if (
          Date.parse(expiresAt) <= Date.parse(g.now) ||
          Date.parse(expiresAt) - Date.parse(g.now) > 1800000
        )
          return false;
        const old = await find(g, input.id);
        if (old) {
          const value = await core.decrypt(
            "v2_summary_edit_stages",
            old.id,
            g.ownerId,
            1,
            old.encrypted_payload,
            payloadSchema,
          );
          return (
            old.source_summary_id === input.summaryId &&
            old.target_snapshot_id === input.targetSnapshotId &&
            JSON.stringify(value.request) === JSON.stringify(request)
          );
        }
        const source = await core
          .statement(
            `SELECT s.*,p.encrypted_payload AS source_header,p.part_count,p.byte_length,i.encrypted_payload AS intake_payload FROM v2_summaries s JOIN v2_intakes i ON i.summary_id=s.id JOIN v2_workspaces w ON w.id=s.workspace_id JOIN v2_private_snapshots p ON p.id=s.snapshot_id WHERE s.id=? AND w.id=? AND w.owner_id=? AND w.revision=? AND w.status='intake' AND w.current_job_id IS NULL AND i.status='reviewing_summary' AND p.state='published' AND p.owner_id=w.owner_id AND p.workspace_id=w.id AND p.purpose='summary' AND p.target_id=w.id AND p.revision=s.revision AND ${aliveWorkspace}`,
            [input.summaryId, g.workspaceId, g.ownerId, g.expectedRevision],
          )
          .first<{
            revision: number;
            intake_revision: number;
            snapshot_id: string;
            source_header: string;
            part_count: number;
            byte_length: number;
            intake_payload: string;
          }>();
        if (!source || source.revision !== request.expectedRevision) return false;
        if (
          await core
            .statement(
              "SELECT 1 AS invalid FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM v2_facts WHERE workspace_id=? AND summary_revision=? AND entity_id=json_extract(e.value,'$.factId') AND snapshot_id=?) LIMIT 1",
              [
                JSON.stringify(request.factEdits ?? []),
                g.workspaceId,
                source.revision,
                source.snapshot_id,
              ],
            )
            .first()
        )
          return false;
        const integrity = await core.decrypt(
          "v2_private_snapshots",
          source.snapshot_id,
          g.ownerId,
          source.revision,
          source.source_header,
          integritySchema,
        );
        if (integrity.targetId !== g.workspaceId || integrity.partCount !== source.part_count)
          return false;
        const payload = await core.encrypt("v2_summary_edit_stages", input.id, g.ownerId, 1, {
          request,
          sourceHeader: source.source_header,
          sourceIntake: source.intake_payload,
          sourcePartCount: source.part_count,
          sourceBytes: source.byte_length,
          sourceDigest: integrity.digest,
        });
        const cursor = await core.encrypt(
          "v2_summary_edit_cursors",
          input.id,
          g.ownerId,
          1,
          initial(),
        );
        const target = await core.encrypt(
          "v2_private_snapshots",
          input.targetSnapshotId,
          g.ownerId,
          source.revision + 1,
          {
            format: "chain_v1",
            digest: zero,
            purpose: "summary",
            targetId: g.workspaceId,
            partCount: 1,
          },
        );
        const claimId = crypto.randomUUID();
        return core.changed([
          core.claim(
            g,
            claimId,
            `w.status='intake' AND w.current_job_id IS NULL AND EXISTS(SELECT 1 FROM v2_intakes i JOIN v2_summaries s ON s.id=i.summary_id JOIN v2_private_snapshots p ON p.id=s.snapshot_id WHERE i.id=w.id AND i.status='reviewing_summary' AND s.id=? AND s.revision=? AND i.encrypted_payload=? AND p.state='published' AND p.encrypted_payload=?)`,
            [input.summaryId, source.revision, source.intake_payload, source.source_header],
          ),
          core.statement(
            `INSERT INTO v2_private_snapshots(id,owner_id,workspace_id,purpose,target_id,revision,part_count,byte_length,encrypted_payload,created_at,state,workspace_revision) SELECT ?,?,?,'summary',?,?,1,1,?,?,'staging',? WHERE ${sqlClaim}`,
            [
              input.targetSnapshotId,
              g.ownerId,
              g.workspaceId,
              g.workspaceId,
              source.revision + 1,
              target,
              g.now,
              g.expectedRevision,
              claimId,
            ],
          ),
          core.statement(
            `INSERT INTO v2_summary_edit_stages(id,owner_id,workspace_id,source_summary_id,source_snapshot_id,target_snapshot_id,source_revision,target_revision,workspace_revision,intake_revision,encrypted_payload,created_at,expires_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${sqlClaim}`,
            [
              input.id,
              g.ownerId,
              g.workspaceId,
              input.summaryId,
              source.snapshot_id,
              input.targetSnapshotId,
              source.revision,
              source.revision + 1,
              g.expectedRevision,
              source.intake_revision,
              payload,
              g.now,
              expiresAt,
              claimId,
            ],
          ),
          core.statement(
            `INSERT INTO v2_summary_edit_cursors(id,revision,encrypted_payload) SELECT ?,1,? WHERE ${sqlClaim}`,
            [input.id, cursor, claimId],
          ),
          core.finish(claimId),
        ]);
      });
    },
    advance(g: WorkspaceGuard, id: string) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, id);
        const e = await find(g, id);
        if (!e) return null;
        const data = await core.decrypt(
          "v2_summary_edit_stages",
          id,
          g.ownerId,
          1,
          e.encrypted_payload,
          payloadSchema,
        );
        const c = await core.decrypt(
          "v2_summary_edit_cursors",
          id,
          g.ownerId,
          e.cursor_revision,
          e.cursor_payload,
          cursorSchema,
        );
        if (c.phase === "done" && c.output === "") return { done: true };
        const claimId = crypto.randomUUID();
        const writes: D1PreparedStatement[] = [];
        const sourceGuards: { sql: string; values: unknown[] }[] = [];
        let reads = 0,
          items = 0;
        const emit = (value: string) => {
          c.output += value;
        };
        const need = async () => {
          if (c.sourceIndex >= data.sourcePartCount || reads >= 4) return false;
          const row = await core
            .statement(
              "SELECT id,byte_length,encrypted_payload FROM v2_private_parts WHERE snapshot_id=? AND part_index=?",
              [e.source_snapshot_id, c.sourceIndex],
            )
            .first<{ id: string; byte_length: number; encrypted_payload: string }>();
          if (!row) throw new V2RepositoryError("SNAPSHOT_INVALID");
          const text = await core.cipher.decrypt(row.encrypted_payload, {
            table: "v2_private_parts",
            column: "encrypted_payload",
            rowId: row.id,
            userId: g.ownerId,
            revision: e.source_revision,
            targetId: g.workspaceId,
            purpose: "summary",
            part: c.sourceIndex,
          });
          if (utf8Bytes(text) !== row.byte_length) throw new V2RepositoryError("SNAPSHOT_INVALID");
          c.sourceChain = await snapshotChain(c.sourceChain, c.sourceIndex, text);
          c.sourceBytes += row.byte_length;
          c.buffer += text;
          sourceGuards.push({
            sql: "EXISTS(SELECT 1 FROM v2_private_parts WHERE id=? AND snapshot_id=? AND part_index=? AND encrypted_payload=? AND byte_length=?)",
            values: [
              row.id,
              e.source_snapshot_id,
              c.sourceIndex,
              row.encrypted_payload,
              row.byte_length,
            ],
          });
          writes.push(
            receipt(
              id,
              "source_part",
              c.sourceIndex,
              row.id,
              JSON.stringify({ payload: row.encrypted_payload, bytes: row.byte_length }),
              row.id,
              JSON.stringify({ payload: row.encrypted_payload, bytes: row.byte_length }),
              claimId,
            ),
          );
          c.sourceIndex++;
          reads++;
          return true;
        };
        const normalized = async (kind: "fact" | "party", value: unknown) => {
          const schema = kind === "fact" ? v2FactSchema : v2SummarySchema.shape.parties.element;
          const original =
            kind === "fact"
              ? parse(v2FactSchema, value)
              : parse(v2SummarySchema.shape.parties.element, value);
          const row = await core
            .statement(
              `SELECT id,encrypted_payload FROM ${kind === "fact" ? "v2_facts" : "v2_parties"} WHERE snapshot_id=? AND entity_id=? AND summary_revision=?`,
              [
                e.source_snapshot_id,
                parse(z.object({ id: opaqueIdSchema }), original).id,
                e.source_revision,
              ],
            )
            .first<{ id: string; encrypted_payload: string }>();
          if (
            !row ||
            JSON.stringify(
              await core.decrypt(
                kind === "fact" ? "v2_facts" : "v2_parties",
                row.id,
                g.ownerId,
                e.source_revision,
                row.encrypted_payload,
                schema as z.ZodType<unknown>,
              ),
            ) !== JSON.stringify(original)
          )
            throw new V2RepositoryError("SNAPSHOT_INVALID");
          let edited = original;
          if (kind === "fact") {
            const fact = parse(v2FactSchema, original);
            const change = data.request.factEdits?.find((edit) => edit.factId === fact.id);
            if (change) {
              if (fact.attribution === "official_source")
                throw new V2RepositoryError("REPOSITORY_INPUT_INVALID");
              edited = parse(v2FactSchema, {
                ...fact,
                text: change.text,
                userEdited: true,
                certainty: fact.certainty === "observed" ? "uncertain" : fact.certainty,
              });
              c.edited.push(fact.id);
            }
            const refs = referenceCommitPredicate(fact.references);
            sourceGuards.push(refs);
          }
          const table = kind === "fact" ? "v2_facts" : "v2_parties";
          const targetId = crypto.randomUUID();
          const target = await core.encrypt(table, targetId, g.ownerId, e.target_revision, edited);
          const ordinal = kind === "fact" ? c.factCount++ : c.partyCount++;
          sourceGuards.push({
            sql: `EXISTS(SELECT 1 FROM ${table} WHERE id=? AND snapshot_id=? AND encrypted_payload=?)`,
            values: [row.id, e.source_snapshot_id, row.encrypted_payload],
          });
          writes.push(
            core.statement(
              `INSERT INTO ${table}(id,entity_id,workspace_id,revision,summary_revision,snapshot_id,encrypted_payload) SELECT ?,?,?,?,?,?,? WHERE ${sqlClaim}`,
              [
                targetId,
                parse(z.object({ id: opaqueIdSchema }), original).id,
                g.workspaceId,
                e.target_revision,
                e.target_revision,
                e.target_snapshot_id,
                target,
                claimId,
              ],
            ),
            receipt(
              id,
              kind,
              ordinal,
              row.id,
              JSON.stringify({
                payload: row.encrypted_payload,
                entityId: parse(z.object({ id: opaqueIdSchema }), original).id,
                revision: e.source_revision,
                workspaceId: g.workspaceId,
              }),
              targetId,
              JSON.stringify({
                payload: target,
                entityId: parse(z.object({ id: opaqueIdSchema }), original).id,
                revision: e.target_revision,
                workspaceId: g.workspaceId,
              }),
              claimId,
            ),
          );
          if (kind === "fact") {
            const fact = parse(v2FactSchema, edited);
            const refs = fact.references.map((ref, ordinal) => ({
              ordinal,
              kind: ref.kind,
              sourceId:
                ref.kind === "intake_narrative"
                  ? g.workspaceId
                  : ref.kind === "intake_answer"
                    ? ref.questionId
                    : ref.kind === "user_message"
                      ? ref.messageId
                      : ref.kind === "user_material"
                        ? ref.fileId
                        : ref.citationId,
              revision:
                ref.kind === "intake_narrative" || ref.kind === "intake_answer"
                  ? ref.intakeRevision
                  : ref.kind === "user_message"
                    ? ref.workspaceRevision
                    : ref.kind === "user_material"
                      ? ref.fileRevision
                      : null,
            }));
            writes.push(
              core.statement(
                `INSERT INTO v2_fact_references(fact_id,ordinal,kind,source_id,source_revision) SELECT ?,json_extract(value,'$.ordinal'),json_extract(value,'$.kind'),json_extract(value,'$.sourceId'),json_extract(value,'$.revision') FROM json_each(?) WHERE ${sqlClaim}`,
                [targetId, JSON.stringify(refs), claimId],
              ),
            );
          }
          return edited;
        };
        while (items < 4 && utf8Bytes(c.output) < 65536) {
          c.buffer = c.buffer.trimStart();
          if (!c.buffer) {
            if (await need()) continue;
            break;
          }
          if (c.phase === "start") {
            if (c.buffer[0] !== "{") throw new V2RepositoryError("SNAPSHOT_INVALID");
            c.buffer = c.buffer.slice(1);
            emit("{");
            c.phase = "key";
            continue;
          }
          if (c.phase === "key") {
            if (c.buffer[0] === "}") {
              if (c.seen.length !== fields.length) throw new V2RepositoryError("SNAPSHOT_INVALID");
              c.buffer = c.buffer.slice(1);
              emit("}");
              c.phase = "done";
              continue;
            }
            const size = tokenLength(c.buffer);
            if (size === null) {
              if (await need()) continue;
              break;
            }
            const key = parse(z.enum(fields), JSON.parse(c.buffer.slice(0, size)));
            if (c.seen.includes(key)) throw new V2RepositoryError("SNAPSHOT_INVALID");
            c.field = key;
            c.seen.push(key);
            emit(`${c.rootFirst ? "" : ","}${JSON.stringify(key)}:`);
            c.rootFirst = false;
            c.buffer = c.buffer.slice(size);
            c.phase = "colon";
            continue;
          }
          if (c.phase === "colon") {
            if (c.buffer[0] !== ":") throw new V2RepositoryError("SNAPSHOT_INVALID");
            c.buffer = c.buffer.slice(1);
            c.phase = "value";
            continue;
          }
          if (c.phase === "separator") {
            if (c.buffer[0] === ",") {
              c.buffer = c.buffer.slice(1);
              c.phase = "key";
              continue;
            }
            if (c.buffer[0] === "}") {
              c.phase = "key";
              continue;
            }
            throw new V2RepositoryError("SNAPSHOT_INVALID");
          }
          if (c.phase === "array_separator") {
            if (c.buffer[0] === ",") {
              c.buffer = c.buffer.slice(1);
              c.phase = "array";
              continue;
            }
            if (c.buffer[0] === "]") {
              c.phase = "array";
              continue;
            }
            throw new V2RepositoryError("SNAPSHOT_INVALID");
          }
          if (c.phase === "done") {
            if (c.buffer.trim()) throw new V2RepositoryError("SNAPSHOT_INVALID");
            if (c.sourceIndex < data.sourcePartCount) {
              if (await need()) continue;
              break;
            }
            break;
          }
          if (c.phase === "value" && arrays.has(c.field)) {
            if (c.buffer[0] !== "[") throw new V2RepositoryError("SNAPSHOT_INVALID");
            c.buffer = c.buffer.slice(1);
            c.arrayFirst = true;
            emit("[");
            c.phase = "array";
            continue;
          }
          if (c.phase === "array" && c.buffer[0] === "]") {
            if (c.field === "unknowns" && c.arrayFirst && data.request.unknowns !== undefined)
              emit(data.request.unknowns.map((item) => JSON.stringify(item)).join(","));
            if (c.field === "notices" && c.noticeCount < 1)
              throw new V2RepositoryError("SNAPSHOT_INVALID");
            c.buffer = c.buffer.slice(1);
            emit("]");
            c.phase = "separator";
            continue;
          }
          const size = tokenLength(c.buffer);
          if (size === null) {
            if (utf8Bytes(c.buffer) > 98304) throw new V2RepositoryError("SNAPSHOT_INVALID");
            if (await need()) continue;
            break;
          }
          const value: unknown = JSON.parse(c.buffer.slice(0, size));
          c.buffer = c.buffer.slice(size);
          let result: unknown = value;
          if (c.phase === "array") {
            if (c.field === "facts") result = await normalized("fact", value);
            else if (c.field === "parties") result = await normalized("party", value);
            else if (c.field === "unknowns") {
              parse(v2SummarySchema.shape.unknowns.element, value);
              c.unknownCount++;
            } else {
              parse(v2SummarySchema.shape.notices.element, value);
              c.noticeCount++;
            }
            if (c.field === "unknowns" && data.request.unknowns !== undefined) {
              /* emit the replacement array once, preserving bounded tokens */ if (c.arrayFirst) {
                emit(data.request.unknowns.map((item) => JSON.stringify(item)).join(","));
              }
            } else emit(`${c.arrayFirst ? "" : ","}${JSON.stringify(result)}`);
            c.arrayFirst = false;
            c.phase = "array_separator";
          } else {
            const key = parse(z.enum(fields), c.field);
            if (arrays.has(key)) throw new V2RepositoryError("SNAPSHOT_INVALID");
            parse<unknown>(v2SummarySchema.shape[key], value);
            if (key === "revision") {
              if (value !== e.source_revision) throw new V2RepositoryError("SNAPSHOT_INVALID");
              result = e.target_revision;
            } else if (key === "intakeRevision" && value !== e.intake_revision)
              throw new V2RepositoryError("SNAPSHOT_INVALID");
            else if (key === "createdAt") result = e.created_at;
            else if (key === "overview") result = data.request.overview ?? value;
            emit(JSON.stringify(result));
            c.phase = "separator";
          }
          items++;
        }
        if (c.phase === "done" && c.sourceIndex === data.sourcePartCount) {
          if (
            c.buffer.trim() ||
            c.sourceChain !== data.sourceDigest ||
            c.sourceBytes !== data.sourceBytes ||
            c.edited.length !== (data.request.factEdits ?? []).length
          )
            throw new V2RepositoryError("SNAPSHOT_INVALID");
        }
        // A request is at most64KiB; unknowns replacement cannot exceed that cap.
        const output = fragmentText(c.output);
        const flush = output.length > 1 || c.phase === "done" ? output.shift() : undefined;
        if (flush) {
          const targetId = crypto.randomUUID();
          const envelope = await core.cipher.encrypt(flush, {
            table: "v2_private_parts",
            column: "encrypted_payload",
            rowId: targetId,
            userId: g.ownerId,
            revision: e.target_revision,
            targetId: g.workspaceId,
            purpose: "summary",
            part: c.targetIndex,
          });
          writes.push(
            core.statement(
              `INSERT INTO v2_private_parts(id,snapshot_id,part_index,byte_length,encrypted_payload) SELECT ?,?,?,?,? WHERE ${sqlClaim}`,
              [targetId, e.target_snapshot_id, c.targetIndex, utf8Bytes(flush), envelope, claimId],
            ),
            receipt(
              id,
              "target_part",
              c.targetIndex,
              targetId,
              JSON.stringify({ payload: envelope, bytes: utf8Bytes(flush) }),
              targetId,
              JSON.stringify({ payload: envelope, bytes: utf8Bytes(flush) }),
              claimId,
            ),
          );
          c.targetChain = await snapshotChain(c.targetChain, c.targetIndex, flush);
          c.targetIndex++;
          c.targetBytes += utf8Bytes(flush);
          c.output = output.join("");
        }
        const cursor = await core.encrypt(
          "v2_summary_edit_cursors",
          id,
          g.ownerId,
          e.cursor_revision + 1,
          parse(cursorSchema, c),
        );
        const header = await core.encrypt(
          "v2_private_snapshots",
          e.target_snapshot_id,
          g.ownerId,
          e.target_revision,
          {
            format: "chain_v1",
            digest: c.targetChain,
            purpose: "summary",
            targetId: g.workspaceId,
            partCount: Math.max(1, c.targetIndex),
          },
        );
        const claim = finalClaim(g, e, claimId, data);
        const extra = sourceGuards.map((guard) => guard.sql).join(" AND ");
        const guarded = extra
          ? core.statement(
              `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,w.owner_id,w.id,w.revision FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND w.revision=? AND w.status='intake' AND w.current_job_id IS NULL AND ${aliveWorkspace} AND ${extra} AND EXISTS(SELECT 1 FROM v2_summary_edit_stages e JOIN v2_summary_edit_cursors c ON c.id=e.id JOIN v2_intakes i ON i.id=e.workspace_id JOIN v2_private_snapshots p ON p.id=e.source_snapshot_id WHERE e.id=? AND e.owner_id=w.owner_id AND e.workspace_revision=w.revision AND e.expires_at>? AND c.revision=? AND c.encrypted_payload=? AND i.summary_id=e.source_summary_id AND i.status='reviewing_summary' AND i.revision=e.intake_revision AND i.encrypted_payload=? AND p.encrypted_payload=? AND p.state='published' AND p.owner_id=w.owner_id AND p.workspace_id=w.id AND p.target_id=w.id AND p.purpose='summary' AND p.revision=e.source_revision AND EXISTS(SELECT 1 FROM v2_private_snapshots q WHERE q.id=e.target_snapshot_id AND q.state='staging' AND q.owner_id=w.owner_id AND q.workspace_id=w.id AND q.target_id=w.id AND q.purpose='summary' AND q.revision=e.target_revision AND q.workspace_revision=w.revision))`,
              [
                claimId,
                g.workspaceId,
                g.ownerId,
                g.expectedRevision,
                ...sourceGuards.flatMap((guard) => guard.values),
                id,
                g.now,
                e.cursor_revision,
                e.cursor_payload,
                data.sourceIntake,
                data.sourceHeader,
              ],
            )
          : claim;
        const changed = await core.changed([
          guarded,
          ...writes,
          core.statement(
            `UPDATE v2_summary_edit_cursors SET revision=revision+1,encrypted_payload=? WHERE id=? AND ${sqlClaim}`,
            [cursor, id, claimId],
          ),
          core.statement(
            `UPDATE v2_private_snapshots SET part_count=?,byte_length=?,written_parts=?,written_bytes=?,encrypted_payload=? WHERE id=? AND state='staging' AND ${sqlClaim}`,
            [
              Math.max(1, c.targetIndex),
              Math.max(1, c.targetBytes),
              c.targetIndex,
              c.targetBytes,
              header,
              e.target_snapshot_id,
              claimId,
            ],
          ),
          core.finish(claimId),
        ]);
        return changed ? { done: c.phase === "done" && c.output === "" } : null;
      });
    },
    publish(g: WorkspaceGuard, id: string, summaryId: string) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, summaryId);
        const e = await find(g, id);
        if (!e) return false;
        const data = await core.decrypt(
          "v2_summary_edit_stages",
          id,
          g.ownerId,
          1,
          e.encrypted_payload,
          payloadSchema,
        );
        const cursor = await core.decrypt(
          "v2_summary_edit_cursors",
          id,
          g.ownerId,
          e.cursor_revision,
          e.cursor_payload,
          cursorSchema,
        );
        if (
          cursor.phase !== "done" ||
          cursor.output ||
          cursor.sourceIndex !== data.sourcePartCount ||
          cursor.sourceChain !== data.sourceDigest ||
          cursor.targetIndex < 1
        )
          return false;
        const target = await core
          .statement(
            "SELECT encrypted_payload,part_count,byte_length,written_parts,written_bytes FROM v2_private_snapshots WHERE id=? AND owner_id=? AND state='staging'",
            [e.target_snapshot_id, g.ownerId],
          )
          .first<{
            encrypted_payload: string;
            part_count: number;
            byte_length: number;
            written_parts: number;
            written_bytes: number;
          }>();
        if (
          !target ||
          target.part_count !== cursor.targetIndex ||
          target.byte_length !== cursor.targetBytes ||
          target.written_parts !== cursor.targetIndex ||
          target.written_bytes !== cursor.targetBytes
        )
          return false;
        const integrity = await core.decrypt(
          "v2_private_snapshots",
          e.target_snapshot_id,
          g.ownerId,
          e.target_revision,
          target.encrypted_payload,
          integritySchema,
        );
        if (
          integrity.digest !== cursor.targetChain ||
          integrity.partCount !== cursor.targetIndex ||
          integrity.targetId !== g.workspaceId
        )
          return false;
        const claimId = crypto.randomUUID();
        const base = finalClaim(g, e, claimId, data);
        const check = core.statement(
          `UPDATE v2_mutation_claims SET verified=CASE WHEN
 EXISTS(SELECT 1 FROM v2_private_snapshots WHERE id=? AND encrypted_payload=? AND state='staging') AND
 NOT EXISTS(SELECT 1 FROM v2_fact_references r JOIN v2_facts f ON f.id=r.fact_id JOIN v2_workspaces w ON w.id=f.workspace_id WHERE f.snapshot_id=? AND NOT ((r.kind='intake_narrative' AND r.source_revision=w.intake_revision) OR (r.kind='intake_answer' AND r.source_revision=w.intake_revision AND EXISTS(SELECT 1 FROM v2_answers a JOIN v2_question_batches b ON b.id=a.batch_id WHERE b.workspace_id=w.id AND a.question_id=r.source_id AND a.status='answered')) OR (r.kind='user_message' AND EXISTS(SELECT 1 FROM v2_messages m WHERE m.id=r.source_id AND m.workspace_id=w.id AND m.role='user' AND m.workspace_revision=r.source_revision)) OR (r.kind='user_material' AND EXISTS(SELECT 1 FROM v2_files f WHERE f.id=r.source_id AND f.workspace_id=w.id AND f.revision=r.source_revision AND f.state='ready' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id))) OR (r.kind='official_source' AND EXISTS(SELECT 1 FROM v2_citation_bindings c WHERE c.id=r.source_id AND c.workspace_id=w.id)))) AND
 (SELECT count(*) FROM v2_private_parts WHERE snapshot_id=?)=? AND (SELECT count(*) FROM v2_summary_edit_receipts WHERE stage_id=? AND kind='source_part')=? AND
 (SELECT count(*) FROM v2_private_parts WHERE snapshot_id=?)=? AND (SELECT count(*) FROM v2_summary_edit_receipts WHERE stage_id=? AND kind='target_part')=? AND
 (SELECT count(*) FROM v2_facts WHERE snapshot_id=?)=? AND (SELECT count(*) FROM v2_parties WHERE snapshot_id=?)=? AND
 (SELECT count(*) FROM v2_facts WHERE snapshot_id=?)=? AND (SELECT count(*) FROM v2_parties WHERE snapshot_id=?)=? AND
 NOT EXISTS(SELECT 1 FROM v2_summary_edit_receipts r WHERE r.stage_id=? AND CASE r.kind WHEN 'source_part' THEN NOT EXISTS(SELECT 1 FROM v2_private_parts p WHERE p.id=r.source_id AND p.snapshot_id=? AND p.part_index=r.ordinal AND p.encrypted_payload=json_extract(r.source_payload,'$.payload') AND p.byte_length=json_extract(r.source_payload,'$.bytes')) WHEN 'target_part' THEN NOT EXISTS(SELECT 1 FROM v2_private_parts p WHERE p.id=r.target_id AND p.snapshot_id=? AND p.part_index=r.ordinal AND p.encrypted_payload=json_extract(r.target_payload,'$.payload') AND p.byte_length=json_extract(r.target_payload,'$.bytes')) WHEN 'fact' THEN NOT EXISTS(SELECT 1 FROM v2_facts s JOIN v2_facts t ON t.id=r.target_id WHERE s.id=r.source_id AND s.snapshot_id=? AND s.encrypted_payload=json_extract(r.source_payload,'$.payload') AND s.entity_id=json_extract(r.source_payload,'$.entityId') AND s.revision=json_extract(r.source_payload,'$.revision') AND s.summary_revision=s.revision AND s.workspace_id=json_extract(r.source_payload,'$.workspaceId') AND t.snapshot_id=? AND t.encrypted_payload=json_extract(r.target_payload,'$.payload') AND t.entity_id=json_extract(r.target_payload,'$.entityId') AND t.revision=json_extract(r.target_payload,'$.revision') AND t.summary_revision=t.revision AND t.workspace_id=json_extract(r.target_payload,'$.workspaceId')) WHEN 'party' THEN NOT EXISTS(SELECT 1 FROM v2_parties s JOIN v2_parties t ON t.id=r.target_id WHERE s.id=r.source_id AND s.snapshot_id=? AND s.encrypted_payload=json_extract(r.source_payload,'$.payload') AND s.entity_id=json_extract(r.source_payload,'$.entityId') AND s.revision=json_extract(r.source_payload,'$.revision') AND s.summary_revision=s.revision AND s.workspace_id=json_extract(r.source_payload,'$.workspaceId') AND t.snapshot_id=? AND t.encrypted_payload=json_extract(r.target_payload,'$.payload') AND t.entity_id=json_extract(r.target_payload,'$.entityId') AND t.revision=json_extract(r.target_payload,'$.revision') AND t.summary_revision=t.revision AND t.workspace_id=json_extract(r.target_payload,'$.workspaceId')) END)
 THEN 1 ELSE 0 END WHERE id=?`,
          [
            e.target_snapshot_id,
            target.encrypted_payload,
            e.target_snapshot_id,
            e.source_snapshot_id,
            data.sourcePartCount,
            id,
            data.sourcePartCount,
            e.target_snapshot_id,
            cursor.targetIndex,
            id,
            cursor.targetIndex,
            e.source_snapshot_id,
            cursor.factCount,
            e.source_snapshot_id,
            cursor.partyCount,
            e.target_snapshot_id,
            cursor.factCount,
            e.target_snapshot_id,
            cursor.partyCount,
            id,
            e.source_snapshot_id,
            e.target_snapshot_id,
            e.source_snapshot_id,
            e.target_snapshot_id,
            e.source_snapshot_id,
            e.target_snapshot_id,
            claimId,
          ],
        );
        const changed = await core.changed([
          base,
          check,
          core.statement(
            `INSERT INTO v2_summaries(id,workspace_id,revision,intake_revision,snapshot_id,created_at) SELECT ?,?,?,?,?,? WHERE ${sqlClaim}`,
            [
              summaryId,
              g.workspaceId,
              e.target_revision,
              e.intake_revision,
              e.target_snapshot_id,
              g.now,
              claimId,
            ],
          ),
          core.statement(
            `UPDATE v2_private_snapshots SET state='published' WHERE id=? AND state='staging' AND ${sqlClaim}`,
            [e.target_snapshot_id, claimId],
          ),
          core.statement(`UPDATE v2_intakes SET summary_id=? WHERE id=? AND ${sqlClaim}`, [
            summaryId,
            g.workspaceId,
            claimId,
          ]),
          core.bump(g, claimId),
          core.statement(`DELETE FROM v2_summary_edit_stages WHERE id=? AND ${sqlClaim}`, [
            id,
            claimId,
          ]),
          core.finish(claimId),
        ]);
        return changed;
      });
    },
    abandon(g: WorkspaceGuard, id: string) {
      return safe(async () => {
        g = parse(guardSchema, g);
        return Boolean(
          await core
            .statement(
              `DELETE FROM v2_private_snapshots WHERE id=(SELECT target_snapshot_id FROM v2_summary_edit_stages WHERE id=? AND owner_id=? AND workspace_id=?) AND state='staging' AND EXISTS(SELECT 1 FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND w.revision=? AND ${aliveWorkspace}) RETURNING id`,
              [id, g.ownerId, g.workspaceId, g.workspaceId, g.ownerId, g.expectedRevision],
            )
            .first(),
        );
      });
    },
  };
}
