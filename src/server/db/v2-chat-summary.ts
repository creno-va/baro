import { type V2Fact, type V2Summary, v2FactSchema, v2SummarySchema } from "../../contracts/v2";
import {
  fragmentText,
  sqlClaim,
  utf8Bytes,
  type V2Core,
  V2RepositoryError,
  type WorkspaceGuard,
} from "./v2-core";
import { createV2StagingRepository } from "./v2-staging";
import { createV2WorkspaceRepository, type JobLease, leasePredicate } from "./v2-workspace";

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
type Field = (typeof fields)[number];
const arrays = new Set<Field>(["facts", "parties", "unknowns", "notices"]);
type Event =
  | { field: Field; kind: "start" | "end" }
  | { field: Field; kind: "value"; value: unknown };
const invalid = () => new V2RepositoryError("SNAPSHOT_INVALID");

// Consume one bounded JSON scalar/array item, including escaped strings and nested references.
function tokenLength(text: string): number | null {
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') {
        quoted = false;
        if (depth === 0) return i + 1;
      }
    } else if (ch === '"') quoted = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      if (depth === 0) return i;
      if (--depth === 0) return i + 1;
    } else if (depth === 0 && (ch === "," || ch === ":" || /\s/.test(ch ?? ""))) return i;
  }
  return null;
}
async function* values(source: AsyncIterable<{ text: string }>): AsyncGenerator<Event> {
  const iterator = source[Symbol.asyncIterator]();
  let buffer = "",
    ended = false;
  const fill = async () => {
    const part = await iterator.next();
    if (part.done) ended = true;
    else buffer += part.value.text;
    if (utf8Bytes(buffer) > 196608) throw invalid();
  };
  const peek = async () => {
    buffer = buffer.trimStart();
    while (!buffer && !ended) {
      await fill();
      buffer = buffer.trimStart();
    }
    return buffer[0];
  };
  const take = async (ch: string) => {
    if ((await peek()) !== ch) throw invalid();
    buffer = buffer.slice(1);
  };
  const token = async () => {
    await peek();
    let size = tokenLength(buffer);
    while (size === null && !ended) {
      await fill();
      size = tokenLength(buffer);
    }
    if (!size) throw invalid();
    const value = JSON.parse(buffer.slice(0, size));
    buffer = buffer.slice(size);
    return value as unknown;
  };
  const seen = new Set<Field>();
  try {
    await take("{");
    while ((await peek()) !== "}") {
      const raw = await token();
      if (typeof raw !== "string" || !fields.includes(raw as Field) || seen.has(raw as Field))
        throw invalid();
      const field = raw as Field;
      seen.add(field);
      await take(":");
      yield { field, kind: "start" };
      if (arrays.has(field)) {
        await take("[");
        while ((await peek()) !== "]") {
          yield { field, kind: "value", value: await token() };
          if ((await peek()) === "]") break;
          await take(",");
          if ((await peek()) === "]") throw invalid();
        }
        await take("]");
      } else yield { field, kind: "value", value: await token() };
      yield { field, kind: "end" };
      if ((await peek()) === "}") break;
      await take(",");
      if ((await peek()) === "}") throw invalid();
    }
    await take("}");
    if ((await peek()) !== undefined || seen.size !== fields.length) throw invalid();
  } finally {
    await iterator.return?.();
  }
}

/** Copy the complete current summary in bounded fragments. Old facts and snapshots stay immutable. */
export async function prepareChatSummary(
  core: V2Core,
  g: WorkspaceGuard,
  lease: JobLease,
  sourceRevision: number,
  additions: { facts: V2Fact[]; parties: V2Summary["parties"] },
  guideHosts: readonly string[],
) {
  const workspace = createV2WorkspaceRepository(core.binding, core.cipher, guideHosts);
  const metadata = await workspace.metadata(g, g.workspaceId);
  if (!metadata?.summary || metadata.summary.revision !== sourceRevision) throw invalid();
  const revision = (
    await core
      .statement(
        "SELECT coalesce(max(revision),0)+1 revision FROM v2_private_snapshots WHERE workspace_id=? AND purpose='summary'",
        [g.workspaceId],
      )
      .first<{ revision: number }>()
  )?.revision;
  if (!revision || revision <= sourceRevision) throw invalid();
  const snapshotId = crypto.randomUUID(),
    staging = createV2StagingRepository(core);
  const counts = { facts: 0, parties: 0, unknowns: 0, notices: 0 };
  const build = async function* (
    stage?: (field: "facts" | "parties", value: unknown) => Promise<void>,
  ) {
    const ids = { facts: new Set<string>(), parties: new Set<string>() },
      conflicts: string[] = [];
    let firstField = true,
      firstItem = true;
    counts.facts = counts.parties = counts.unknowns = counts.notices = 0;
    const item = async (field: Field, raw: unknown) => {
      let value: unknown;
      if (field === "facts") {
        const fact = v2FactSchema.parse(raw);
        if (ids.facts.has(fact.id)) throw invalid();
        ids.facts.add(fact.id);
        conflicts.push(...fact.conflictingFactIds);
        value = fact;
      } else if (field === "parties") {
        const party = v2SummarySchema.shape.parties.element.parse(raw);
        if (ids.parties.has(party.id)) throw invalid();
        ids.parties.add(party.id);
        value = party;
      } else if (field === "unknowns" || field === "notices")
        value = v2SummarySchema.shape[field].element.parse(raw);
      else {
        value = v2SummarySchema.shape[field].parse(raw);
        if (field === "revision") {
          if (value !== sourceRevision) throw invalid();
          value = revision;
        }
        if (field === "intakeRevision" && value !== metadata.revision) throw invalid();
        if (field === "createdAt") value = g.now;
      }
      if (arrays.has(field)) {
        const name = field as keyof typeof counts;
        if (++counts[name] > { facts: 300, parties: 30, unknowns: 100, notices: 10 }[name])
          throw invalid();
        if (stage && (field === "facts" || field === "parties")) await stage(field, value);
      }
      const output = `${arrays.has(field) && !firstItem ? "," : ""}${JSON.stringify(value)}`;
      firstItem = false;
      return output;
    };
    yield "{";
    for await (const event of values(workspace.summaryFragments(g, g.workspaceId))) {
      if (event.kind === "start") {
        yield `${firstField ? "" : ","}${JSON.stringify(event.field)}:${arrays.has(event.field) ? "[" : ""}`;
        firstField = false;
        firstItem = true;
      } else if (event.kind === "value") yield await item(event.field, event.value);
      else if (arrays.has(event.field)) {
        if (event.field === "facts" || event.field === "parties")
          for (const value of additions[event.field]) yield await item(event.field, value);
        yield "]";
      }
    }
    if (!counts.notices || conflicts.some((id) => !ids.facts.has(id))) throw invalid();
    yield "}";
  };
  const packed = async function* (source: AsyncIterable<string>) {
    let buffer = "";
    for await (const text of source) {
      const parts = fragmentText(buffer + text);
      buffer = parts.pop() ?? "";
      yield* parts;
    }
    if (buffer) yield buffer;
  };
  let partCount = 0,
    byteLength = 0;
  for await (const text of packed(build())) {
    partCount++;
    byteLength += utf8Bytes(text);
  }
  if (
    !(await staging.begin(
      g,
      {
        id: snapshotId,
        purpose: "summary",
        targetId: g.workspaceId,
        revision,
        partCount,
        byteLength,
      },
      lease,
    ))
  )
    throw invalid();
  const stage = async (field: "facts" | "parties", raw: unknown) => {
    const value = raw as V2Fact | V2Summary["parties"][number],
      id = crypto.randomUUID();
    const table = field === "facts" ? "v2_facts" : "v2_parties";
    const payload = await core.encrypt(table, id, g.ownerId, revision, value);
    const claimId = crypto.randomUUID(),
      execution = leasePredicate(lease, g.workspaceId, g.expectedRevision, g.now);
    const statements = [
      core.claim(
        g,
        claimId,
        `${execution.sql} AND w.current_job_id=? AND w.confirmed_summary_revision=? AND EXISTS(SELECT 1 FROM v2_private_snapshots WHERE id=? AND state='staging' AND workspace_revision=w.revision)`,
        [...execution.values, lease.jobId, sourceRevision, snapshotId],
      ),
      core.statement(
        `INSERT INTO ${table}(id,entity_id,workspace_id,revision,summary_revision,snapshot_id,encrypted_payload) SELECT ?,?,?,?,?,?,? WHERE ${sqlClaim}`,
        [id, value.id, g.workspaceId, revision, revision, snapshotId, payload, claimId],
      ),
    ];
    if (field === "facts") {
      const refs = (value as V2Fact).references.map((ref, ordinal) => ({
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
      statements.push(
        core.statement(
          `INSERT INTO v2_fact_references(fact_id,ordinal,kind,source_id,source_revision) SELECT ?,json_extract(value,'$.ordinal'),json_extract(value,'$.kind'),json_extract(value,'$.sourceId'),json_extract(value,'$.revision') FROM json_each(?) WHERE ${sqlClaim}`,
          [id, JSON.stringify(refs), claimId],
        ),
      );
    }
    statements.push(core.finish(claimId));
    if (!(await core.changed(statements))) throw invalid();
  };
  let index = 0;
  for await (const text of packed(build(stage)))
    if (!(await staging.append(g, snapshotId, index++, text, lease))) throw invalid();
  if (
    !(await staging.seal(
      g,
      snapshotId,
      { schemaVersion: "2", purpose: "summary", targetId: g.workspaceId, revision },
      lease,
    ))
  )
    throw invalid();
  return {
    snapshotId,
    summaryId: crypto.randomUUID(),
    revision,
    intakeRevision: metadata.revision,
    factCount: counts.facts,
    partyCount: counts.parties,
  };
}
