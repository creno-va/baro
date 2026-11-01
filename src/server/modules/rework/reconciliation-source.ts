import {
  type V2Summary,
  type V2UserMessage,
  v2SummarySchema,
  v2UserMessageSchema,
} from "../../../contracts/v2";
import { readCustomerConsentSnapshot } from "../../auth/account-type";
import { aliveWorkspace, MAX_REHYDRATE_BYTES, utf8Bytes, type V2Core } from "../../db/v2-core";
import { createV2FilesRepository } from "../../db/v2-files";
import { createV2WorkspaceRepository } from "../../db/v2-workspace";
import type { SummaryReconciliationActor } from "../intake/summary-reconciliation";
import { textHash } from "../legal-retrieval/service";
import { GUIDE_HOSTS } from "../legal-retrieval/v2/registry";
import { readWorkspaceContext } from "../workspace/context";
import { MATERIAL_CONTEXT_BYTES, readMaterialWindow } from "../workspace/materials";
import type { ReconciliationAuthority } from "../workspace/summary-reconciliation-storage";
import { createReworkCaseService, ReworkError } from "./case-context";

// These authenticated correction messages are durable inputs, but their own
// immutable admission record must not invalidate its own source digest. Do not
// rely on expiring idempotency rows to identify this durable message provenance.
const messages = `(SELECT json_group_array(json_object('id',id,'revision',revision,'encrypted_payload',encrypted_payload)) FROM (SELECT m.id,m.revision,m.encrypted_payload FROM v2_messages m WHERE m.workspace_id=w.id AND m.role='user' AND NOT EXISTS(SELECT 1 FROM v2_rework_records rr WHERE rr.workspace_id=w.id AND rr.owner_id=w.owner_id AND rr.entity_id=w.id AND rr.kind='reconciliation' AND rr.state='published' AND rr.workspace_revision=m.workspace_revision) ORDER BY m.id))`;
const files = `(SELECT json_group_array(json_object('id',id,'revision',revision,'state',state,'encrypted_payload',encrypted_payload,'manifest_snapshot_id',manifest_snapshot_id,'coverage_snapshot_id',coverage_snapshot_id)) FROM (SELECT f.id,f.revision,f.state,f.encrypted_payload,f.manifest_snapshot_id,f.coverage_snapshot_id FROM v2_files f WHERE f.workspace_id=w.id AND f.state!='deleting' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id) ORDER BY f.id))`;
const sources = `(SELECT json_group_array(json_object('id',id,'citation_json',citation_json,'content_hash',content_hash,'extractor_version',extractor_version,'expires_at',expires_at,'rights_provenance',rights_provenance)) FROM (SELECT b.id,b.citation_json,s.content_hash,s.extractor_version,s.expires_at,s.rights_provenance FROM v2_citation_bindings b JOIN v2_official_sources s ON s.source_id=b.source_id WHERE b.workspace_id=w.id ORDER BY b.id))`;

/** Full canonical summary with honest bounded history/source coverage. This is
 * separate from the eight-fact conversational projection and performs no external IO. */
export async function loadReconciliationSource(
  core: V2Core,
  actor: SummaryReconciliationActor,
  options: { write: boolean; requestMessage?: V2UserMessage; admittingMessage?: true },
): Promise<ReconciliationAuthority> {
  const access = await readCustomerConsentSnapshot(core.binding, actor.ownerId);
  if (!["customer", "lawyer"].includes(access.accountType)) throw new ReworkError("NOT_FOUND");
  if (options.write && !access.currentConsent) throw new ReworkError("CONSENT_REQUIRED");
  const row = await core
    .statement(
      `SELECT w.revision,w.encrypted_payload,i.summary_id,s.snapshot_id,${files} files,${messages} messages,${sources} sources FROM v2_workspaces w JOIN user u ON u.id=w.owner_id JOIN v2_intakes i ON i.id=w.id JOIN v2_summaries s ON s.id=i.summary_id WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace}`,
      [actor.caseId, actor.ownerId],
    )
    .first<{
      revision: number;
      encrypted_payload: string;
      summary_id: string;
      snapshot_id: string;
      files: string;
      messages: string;
      sources: string;
    }>();
  if (!row) {
    const owned = await core
      .statement(
        `SELECT w.id FROM v2_workspaces w JOIN user u ON u.id=w.owner_id WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace}`,
        [actor.caseId, actor.ownerId],
      )
      .first();
    throw new ReworkError(owned ? "REVIEW_REQUIRED" : "NOT_FOUND");
  }
  const workspace = createV2WorkspaceRepository(core.binding, core.cipher, GUIDE_HOSTS);
  let text = "",
    bytes = 0;
  for await (const part of workspace.summaryFragments(actor, actor.caseId)) {
    bytes += utf8Bytes(part.text);
    if (bytes > MAX_REHYDRATE_BYTES) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
    text += part.text;
  }
  const currentSummary = async () =>
    !!(await core
      .statement(
        `SELECT w.id FROM v2_workspaces w JOIN v2_intakes i ON i.id=w.id JOIN v2_summaries s ON s.id=i.summary_id WHERE w.id=? AND w.owner_id=? AND w.revision=? AND w.encrypted_payload=? AND i.summary_id=? AND s.snapshot_id=? AND ${aliveWorkspace}`,
        [
          actor.caseId,
          actor.ownerId,
          row.revision,
          row.encrypted_payload,
          row.summary_id,
          row.snapshot_id,
        ],
      )
      .first());
  if (!(await currentSummary())) throw new ReworkError("STALE_REVISION");
  const summary: V2Summary = v2SummarySchema.parse(JSON.parse(text));
  let issued = options.requestMessage;
  let issuedProof: { sql: string; values: unknown[] } = { sql: "1", values: [] };
  if (issued && !options.admittingMessage) {
    const current = await core
      .statement(
        "SELECT m.revision,m.encrypted_payload FROM v2_messages m JOIN v2_operations o ON o.id=m.operation_id WHERE m.id=? AND m.workspace_id=? AND m.operation_id=? AND m.role='user' AND o.owner_id=? AND o.workspace_id=m.workspace_id",
        [issued.id, actor.caseId, issued.operationId, actor.ownerId],
      )
      .first<{ revision: number; encrypted_payload: string }>();
    if (!current) throw new ReworkError("STALE_REVISION");
    const fresh = await core.decrypt(
      "v2_messages",
      issued.id,
      actor.ownerId,
      current.revision,
      current.encrypted_payload,
      v2UserMessageSchema,
    );
    if (JSON.stringify(fresh) !== JSON.stringify(v2UserMessageSchema.parse(issued)))
      throw new ReworkError("STALE_REVISION");
    issued = fresh;
    issuedProof = {
      sql: "EXISTS(SELECT 1 FROM v2_messages m JOIN v2_operations o ON o.id=m.operation_id WHERE m.id=? AND m.workspace_id=w.id AND m.operation_id=? AND m.revision=? AND m.encrypted_payload=? AND m.workspace_revision=? AND m.role='user' AND o.owner_id=w.owner_id AND o.workspace_id=w.id)",
      values: [
        fresh.id,
        fresh.operationId,
        current.revision,
        current.encrypted_payload,
        fresh.workspaceRevision,
      ],
    };
  }
  // Only initial paid-plan preparation projects a not-yet-committed message.
  // Admission inserts it atomically; execution always verifies the actual row.
  if (issued && options.admittingMessage && issued.workspaceRevision !== row.revision + 1)
    throw new ReworkError("STALE_REVISION");
  let context: Awaited<ReturnType<typeof readWorkspaceContext>>;
  try {
    context = await readWorkspaceContext(core, actor, actor.caseId, issued, GUIDE_HOSTS);
  } catch (error) {
    // Its independently fenced intake read can disappear during publication.
    // Reclassify only a proven source change; keep genuine unchanged-source errors.
    if (!(await currentSummary())) throw new ReworkError("STALE_REVISION");
    throw error;
  }
  const caseContext = await createReworkCaseService(core, { clock: () => actor.now }).get(
    actor.ownerId,
    actor.caseId,
  );
  context.conversation = {
    caseContext: caseContext.context,
    preparation: {
      status: "not_started",
      basis: null,
      currentJobId: null,
      failure: null,
      missingItems: [],
    },
  };
  context.intake.summary = summary;
  context.confirmedSummary = context.intake.status === "confirmed" ? summary : null;
  context.facts = summary.facts;
  if (context.contextCoverage) {
    context.contextCoverage.factsPartial = false;
    context.contextCoverage.partiesPartial = false;
    context.contextCoverage.summaryPartial = false;
  }
  const ready = await core
    .statement(
      "SELECT id,revision FROM v2_files WHERE workspace_id=? AND state='ready' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=v2_files.id) ORDER BY id LIMIT 101",
      [actor.caseId],
    )
    .all<{ id: string; revision: number }>();
  if (ready.results.length > 100) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
  const fileRepo = createV2FilesRepository(core);
  context.materials = [];
  context.materialWindows = [];
  context.references.files = [];
  let materialBytes = 0;
  for (const file of ready.results) {
    const meta = await fileRepo.metadata(actor, file.id),
      probe = meta?.probe;
    if (!meta || !probe || meta.revision !== file.revision) throw new ReworkError("STALE_REVISION");
    context.references.files = [
      ...context.references.files,
      {
        id: file.id,
        revision: file.revision,
        category: probe.category,
        ...("pageCount" in probe ? { pageCount: probe.pageCount } : {}),
        ...("durationSeconds" in probe ? { durationSeconds: probe.durationSeconds } : {}),
        ...("hasAudio" in probe ? { hasAudio: probe.hasAudio } : {}),
      },
    ];
    let ordinal = 0;
    while (true) {
      const window = await readMaterialWindow(
        core,
        actor,
        actor.caseId,
        { fileId: file.id, fileRevision: file.revision, startOrdinal: ordinal, count: 32 },
        MATERIAL_CONTEXT_BYTES - materialBytes,
      );
      const { materials, ...metadata } = window;
      context.materials.push(...materials);
      context.materialWindows.push(metadata);
      materialBytes += utf8Bytes(JSON.stringify(materials));
      if (materialBytes > MATERIAL_CONTEXT_BYTES) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
      if (window.nextOrdinal === null) break;
      if (window.nextOrdinal <= ordinal) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
      ordinal = window.nextOrdinal;
    }
  }
  // Do not clear other contextCoverage flags: messages, official sources and
  // preparation lists still use the existing explicitly bounded projection.
  const authority = {
    sql: `w.encrypted_payload=? AND EXISTS(SELECT 1 FROM v2_intakes WHERE id=w.id AND summary_id=?) AND ${files}=? AND ${messages}=? AND ${sources}=? AND (${issuedProof.sql})`,
    values: [
      row.encrypted_payload,
      row.summary_id,
      row.files,
      row.messages,
      row.sources,
      ...issuedProof.values,
    ],
  };
  if (
    !(await core
      .statement(
        `SELECT w.id FROM v2_workspaces w JOIN user u ON u.id=w.owner_id WHERE w.id=? AND w.owner_id=? AND w.revision=? AND ${aliveWorkspace} AND (${authority.sql})`,
        [actor.caseId, actor.ownerId, row.revision, ...authority.values],
      )
      .first())
  )
    throw new ReworkError("STALE_REVISION");
  return {
    workspaceRevision: row.revision,
    summaryId: row.summary_id,
    summarySnapshotId: row.snapshot_id,
    summary,
    context,
    sourceDigest: await textHash(
      JSON.stringify({
        workspaceContent: row.encrypted_payload,
        files: row.files,
        messages: row.messages,
        sources: row.sources,
      }),
    ),
    authority,
  };
}
