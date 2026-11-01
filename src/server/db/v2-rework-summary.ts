import { type V2Summary, v2SummarySchema } from "../../contracts/v2";
import { fragmentText, sqlClaim, utf8Bytes, type V2Core, type WorkspaceGuard } from "./v2-core";
import { type ReworkWriteGuard, reworkConsentGuard } from "./v2-rework";
import { createV2StagingRepository } from "./v2-staging";
import { createV2SummaryStagingRepository } from "./v2-summary-staging";
import { referenceCommitPredicate, referencesAuthorized } from "./v2-workspace";

/** Stage a reviewed proposal, then expose only statements that must be committed
 * with its immutable confirmation receipt in the caller's final claim. */
export async function prepareReconciledSummary(
  core: V2Core,
  g: WorkspaceGuard,
  input: {
    snapshotId: string;
    beforeRevision: number;
    summary: V2Summary;
    authority: ReworkWriteGuard;
  },
) {
  const summary = v2SummarySchema.parse(input.summary);
  if (summary.revision !== input.beforeRevision + 1) return null;
  const refs = summary.facts.flatMap((fact) => fact.references);
  if (!(await referencesAuthorized(core, g, refs))) return null;
  const references = referenceCommitPredicate(refs);
  const consent = reworkConsentGuard(g.ownerId);
  const base = {
    sql: `((w.status='active' AND w.confirmed_summary_revision=?) OR (w.status='intake' AND w.confirmed_summary_revision IS NULL)) AND EXISTS(SELECT 1 FROM v2_intakes i JOIN v2_summaries s ON s.id=i.summary_id WHERE i.id=w.id AND s.revision=? AND i.status IN ('reviewing_summary','confirmed')) AND w.current_job_id IS NULL AND w.intake_revision=? AND ${consent.sql} AND (${input.authority.sql}) AND (${references.sql})`,
    values: [
      input.beforeRevision,
      input.beforeRevision,
      summary.intakeRevision,
      ...consent.values,
      ...input.authority.values,
      ...references.values,
    ],
  };
  // Only abandoned, unpublished pages from an older workspace CAS may be
  // reclaimed. Published summaries and their history are never changed.
  const cleanup = crypto.randomUUID();
  if (
    !(await core.changed([
      core.claim(g, cleanup, base.sql, base.values),
      core.statement(
        `DELETE FROM v2_private_snapshots AS s WHERE s.workspace_id=? AND s.target_id=? AND s.purpose='summary' AND s.revision=? AND s.state IN ('staging','sealed','abandoned') AND s.workspace_revision!=? AND NOT EXISTS(SELECT 1 FROM v2_summaries WHERE snapshot_id=s.id) AND ${sqlClaim}`,
        [g.workspaceId, g.workspaceId, summary.revision, g.expectedRevision, cleanup],
      ),
      core.finish(cleanup),
    ]))
  )
    return null;
  const stage = createV2StagingRepository(core),
    pages = createV2SummaryStagingRepository(core);
  const text = JSON.stringify(summary),
    parts = fragmentText(text);
  const sealed = await core
    .statement(
      "SELECT id FROM v2_private_snapshots WHERE id=? AND owner_id=? AND workspace_id=? AND workspace_revision=? AND purpose='summary' AND revision=? AND state='sealed'",
      [input.snapshotId, g.ownerId, g.workspaceId, g.expectedRevision, summary.revision],
    )
    .first();
  if (!sealed) {
    if (
      !(await stage.begin(g, {
        id: input.snapshotId,
        purpose: "summary",
        targetId: g.workspaceId,
        revision: summary.revision,
        partCount: parts.length,
        byteLength: utf8Bytes(text),
      }))
    )
      return null;
    let facts: V2Summary["facts"] = [];
    for (const fact of summary.facts) {
      if (
        facts.length &&
        (facts.length === 4 ||
          utf8Bytes(JSON.stringify({ facts: [...facts, fact], parties: [] })) > 98304)
      ) {
        if (!(await pages.stagePage(g, input.snapshotId, { facts, parties: [] }))) return null;
        facts = [];
      }
      facts.push(fact);
    }
    if (facts.length && !(await pages.stagePage(g, input.snapshotId, { facts, parties: [] })))
      return null;
    for (let i = 0; i < summary.parties.length; i += 4)
      if (
        !(await pages.stagePage(g, input.snapshotId, {
          facts: [],
          parties: summary.parties.slice(i, i + 4),
        }))
      )
        return null;
    for (const [index, part] of parts.entries())
      if (!(await stage.append(g, input.snapshotId, index, part))) return null;
    if (
      !(await stage.seal(g, input.snapshotId, {
        schemaVersion: "2",
        purpose: "summary",
        targetId: g.workspaceId,
        revision: summary.revision,
      }))
    )
      return null;
  }
  // A response may be lost after sealing. Reuse that exact candidate only when
  // every encrypted chunk still equals the reviewed proposal, with its pointer
  // frozen again by the final publication claim.
  const header = await core
    .statement(
      "SELECT encrypted_payload FROM v2_private_snapshots WHERE id=? AND owner_id=? AND workspace_id=? AND workspace_revision=? AND purpose='summary' AND target_id=? AND revision=? AND state='sealed' AND part_count=? AND byte_length=?",
      [
        input.snapshotId,
        g.ownerId,
        g.workspaceId,
        g.expectedRevision,
        g.workspaceId,
        summary.revision,
        parts.length,
        utf8Bytes(text),
      ],
    )
    .first<{ encrypted_payload: string }>();
  if (!header) return null;
  for (const [index, expected] of parts.entries()) {
    const row = await core
      .statement(
        "SELECT id,encrypted_payload FROM v2_private_parts WHERE snapshot_id=? AND part_index=?",
        [input.snapshotId, index],
      )
      .first<{ id: string; encrypted_payload: string }>();
    if (
      !row ||
      (await core.cipher.decrypt(row.encrypted_payload, {
        table: "v2_private_parts",
        column: "encrypted_payload",
        rowId: row.id,
        userId: g.ownerId,
        targetId: g.workspaceId,
        purpose: "summary",
        revision: summary.revision,
        part: index,
      })) !== expected
    )
      return null;
  }
  const summaryId = crypto.randomUUID();
  return {
    authority: {
      sql: `${base.sql} AND EXISTS(SELECT 1 FROM v2_private_snapshots s WHERE s.id=? AND s.owner_id=w.owner_id AND s.workspace_id=w.id AND s.target_id=w.id AND s.purpose='summary' AND s.state='sealed' AND s.workspace_revision=w.revision AND s.revision=? AND s.encrypted_payload=? AND (SELECT count(*) FROM v2_facts WHERE snapshot_id=s.id)=? AND (SELECT count(*) FROM v2_parties WHERE snapshot_id=s.id)=?)`,
      values: [
        ...base.values,
        input.snapshotId,
        summary.revision,
        header.encrypted_payload,
        summary.facts.length,
        summary.parties.length,
      ],
    },
    statements: (claimId: string) => [
      core.statement(
        `INSERT INTO v2_summaries(id,workspace_id,revision,intake_revision,snapshot_id,created_at) SELECT ?,?,?,?,?,? WHERE ${sqlClaim}`,
        [
          summaryId,
          g.workspaceId,
          summary.revision,
          summary.intakeRevision,
          input.snapshotId,
          g.now,
          claimId,
        ],
      ),
      core.statement(
        `UPDATE v2_private_snapshots SET state='published' WHERE id=? AND ${sqlClaim}`,
        [input.snapshotId, claimId],
      ),
      core.statement(
        `UPDATE v2_intakes SET status='confirmed',summary_id=?,confirmed_summary_revision=? WHERE id=? AND ${sqlClaim}`,
        [summaryId, summary.revision, g.workspaceId, claimId],
      ),
      core.statement(
        `UPDATE v2_workspaces SET status='active',confirmed_summary_revision=? WHERE id=? AND ${sqlClaim}`,
        [summary.revision, g.workspaceId, claimId],
      ),
    ],
  };
}
