import { z } from "zod";
import {
  type V2Intake,
  type V2UserMessage,
  v2FileObservationSchema,
  v2MessageSchema,
  v2SummarySchema,
  v2UserMessageSchema,
} from "../../../contracts/v2";
import type { Actor, V2Core } from "../../db/v2-core";
import { createV2FilesRepository } from "../../db/v2-files";
import { createV2SummaryStagingRepository } from "../../db/v2-summary-staging";
import { createV2WorkspaceRepository } from "../../db/v2-workspace";
import { textHash } from "../legal-retrieval/service";
import { readBoundSource } from "../legal-retrieval/v2/bound-sources";
import { EXTRACTOR_VERSION, type SourceChunk } from "../legal-retrieval/v2/contracts";
import { projectWorkspaceSources } from "../legal-retrieval/v2/workspace-sources";
import type { WorkspaceContext } from "./pipeline";

/** Bounded context retains every saved row; the model is told which rows are included. */
export async function readWorkspaceContext(
  core: V2Core,
  actor: Actor,
  id: string,
  latest?: V2UserMessage,
  guideHosts: readonly string[] = [],
): Promise<WorkspaceContext> {
  const repo = createV2WorkspaceRepository(core.binding, core.cipher, guideHosts);
  const metadata = await repo.metadata(actor, id);
  if (!metadata) throw new Error("Workspace unavailable");
  const pages = createV2SummaryStagingRepository(core);
  const revision = metadata.summary?.revision;
  const factPage = revision
    ? await pages.factsPage(actor, id, revision, undefined, 8)
    : { facts: [], nextId: null };
  const partyPage = revision
    ? await pages.partiesPage(actor, id, revision, undefined, 8)
    : { parties: [], nextId: null };
  let summary: V2Intake["summary"] = null;
  if (metadata.summary) {
    // The fixed overview precedes large fact arrays in server-authored snapshots.
    let overview = "";
    const stream = repo.summaryFragments(actor, id)[Symbol.asyncIterator]();
    try {
      const first = await stream.next();
      if (!first.done) {
        const match = /"overview"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(first.value.text);
        if (match) overview = v2SummarySchema.shape.overview.parse(JSON.parse(match[1] ?? "null"));
      }
    } finally {
      await stream.return?.();
    }
    summary = {
      schemaVersion: "2",
      revision: v2SummarySchema.shape.revision.parse(metadata.summary.revision),
      intakeRevision: metadata.revision,
      createdAt: "1970-01-01T00:00:00.000Z",
      overview: overview || "확인된 요약의 선택된 사실을 참고합니다.",
      facts: factPage.facts,
      parties: partyPage.parties,
      unknowns: [
        "대화 맥락은 저장된 자료의 일부입니다. 포함되지 않은 사실은 없다고 단정하지 않습니다.",
      ],
      notices: ["확인된 사건 사실을 준비하는 대화이며 법률 판단이 아닙니다."],
    };
    if ((metadata.summary.byteLength ?? Number.MAX_SAFE_INTEGER) <= 1048576) {
      const full = await repo.readIntake(actor, id);
      if (!full?.summary) throw new Error("Summary unavailable");
      summary = { ...full.summary, facts: factPage.facts };
    }
  }
  const messageRows = (
    await core
      .statement(
        "SELECT id,revision,encrypted_payload FROM v2_messages WHERE workspace_id=? AND role='user' AND id<>? ORDER BY created_at DESC,id DESC LIMIT 20",
        [id, latest?.id ?? ""],
      )
      .all<{ id: string; revision: number; encrypted_payload: string }>()
  ).results;
  const messages = await Promise.all(
    messageRows.map((row) =>
      core.decrypt(
        "v2_messages",
        row.id,
        actor.ownerId,
        row.revision,
        row.encrypted_payload,
        v2UserMessageSchema,
      ),
    ),
  );
  const historyRows = (
    await core
      .statement(
        "SELECT id,revision,encrypted_payload FROM v2_messages WHERE workspace_id=? AND id<>? ORDER BY created_at DESC,id DESC LIMIT 20",
        [id, latest?.id ?? ""],
      )
      .all<{ id: string; revision: number; encrypted_payload: string }>()
  ).results;
  const history = await Promise.all(
    historyRows.map((row) =>
      core.decrypt(
        "v2_messages",
        row.id,
        actor.ownerId,
        row.revision,
        row.encrypted_payload,
        v2MessageSchema(guideHosts),
      ),
    ),
  );
  const sourceRows = (
    await core
      .statement(
        "SELECT b.id FROM v2_citation_bindings b LEFT JOIN v2_official_sources s ON s.source_id=b.source_id WHERE b.workspace_id=? ORDER BY CASE WHEN s.extractor_version=? THEN 0 ELSE 1 END,json_extract(b.citation_json,'$.verifiedAt') DESC,b.snapshot_revision DESC,b.id LIMIT 11",
        [id, EXTRACTOR_VERSION],
      )
      .all<{ id: string }>()
  ).results;
  const chunks: SourceChunk[] = [];
  let rejectedSources = 0;
  for (const row of sourceRows.slice(0, 10)) {
    const chunk = await readBoundSource(core, id, row.id, actor.now, guideHosts);
    if (chunk) chunks.push(chunk);
    else rejectedSources++;
  }
  const sources = await projectWorkspaceSources(
    {
      schemaVersion: "2",
      asOfDate: new Date(Date.parse(actor.now) + 9 * 3600000).toISOString().slice(0, 10),
      chunks,
      outcomes: chunks.map((chunk) => ({
        kind: chunk.citation.kind,
        availability: "verified",
        reason: null,
        chunks: [chunk],
      })),
      retrievalHash: await textHash(JSON.stringify(chunks.map((chunk) => chunk.citation.sourceId))),
      legalSourceStatus: chunks.length
        ? "verified"
        : sourceRows.length
          ? "unavailable"
          : "not_requested",
      factualPreparationAvailable: true,
    },
    rejectedSources,
  );
  sources.sourceCoverage.sourcesPartial ||= sourceRows.length > 10;
  const intake: V2Intake = {
    ...metadata,
    status: z
      .enum(["collecting", "generating_questions", "reviewing_summary", "confirmed"])
      .parse(metadata.status),
    summary,
    currentJobId: null,
  };
  if (intake.status === "generating_questions") intake.status = "collecting";
  const files = createV2FilesRepository(core),
    materials: WorkspaceContext["materials"] = [],
    fileReferences: WorkspaceContext["references"]["files"][number][] = [];
  for (const fileId of latest?.selectedFileIds ?? []) {
    const file = await files.metadata(actor, fileId);
    const belongs = await core
      .statement("SELECT id FROM v2_files WHERE id=? AND workspace_id=?", [fileId, id])
      .first();
    if (!file || file.status !== "ready" || !belongs || !file.probe)
      throw new Error("Selected material unavailable");
    const probe = file.probe;
    fileReferences.push({
      id: file.id,
      revision: file.revision,
      category: probe.category,
      ...("pageCount" in probe ? { pageCount: probe.pageCount } : {}),
      ...("durationSeconds" in probe ? { durationSeconds: probe.durationSeconds } : {}),
      ...("hasAudio" in probe ? { hasAudio: probe.hasAudio } : {}),
    });
    const rows = (
      await core
        .statement(
          "SELECT id,revision,encrypted_payload FROM v2_file_observations WHERE file_id=? AND file_revision=? ORDER BY ordinal LIMIT 8",
          [file.id, file.revision],
        )
        .all<{ id: string; revision: number; encrypted_payload: string }>()
    ).results;
    for (const row of rows) {
      const value = await core.decrypt(
        "v2_file_observations",
        row.id,
        actor.ownerId,
        row.revision,
        row.encrypted_payload,
        v2FileObservationSchema,
      );
      materials.push({
        reference: {
          kind: "user_material",
          fileId: file.id,
          fileRevision: file.revision,
          position: value.position,
        },
        text: value.text,
        coverage: {
          limitedTo: "first_eight_observations",
          fullCoverageSnapshotId: file.coverageSnapshotId,
          observationCertainty: value.certainty,
          userEdited: value.userEdited,
        },
      });
    }
  }
  if (!(await repo.findWorkspace(actor, id))) throw new Error("Workspace unavailable");
  const normalized = (message: V2UserMessage) => ({
    ...message,
    createdAt: "1970-01-01T00:00:00.000Z",
  });
  return {
    intake,
    confirmedSummary: intake.status === "confirmed" ? summary : null,
    facts: factPage.facts,
    messages: messages.map(normalized),
    latestMessage: latest ? normalized(latest) : null,
    history: history.map((message) => ({ ...message, createdAt: "1970-01-01T00:00:00.000Z" })),
    ...sources,
    sourceLookupPerformed: false,
    contextCoverage: {
      factsPartial: factPage.nextId !== null,
      partiesPartial: partyPage.nextId !== null,
      summaryPartial: (metadata.summary?.byteLength ?? 0) > 1048576,
      messagesPartial: history.length === 20,
      materialsPartial: materials.length > 0,
      sourcesPartial: sources.sourceCoverage.sourcesPartial,
    },
    references: {
      intakeRevision: metadata.revision,
      answeredQuestionIds: metadata.batches.flatMap((batch) =>
        batch.answers
          .filter((answer) => answer.status === "answered")
          .map((answer) => answer.questionId),
      ),
      messages: [...messages, ...(latest ? [latest] : [])].map((m) => ({
        id: m.id,
        workspaceRevision: m.workspaceRevision,
      })),
      files: fileReferences,
      verifiedCitationIds: sources.citations.map((citation) => citation.id),
    },
    materials,
  };
}
