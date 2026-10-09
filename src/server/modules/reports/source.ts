import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import {
  type V2Coverage,
  type V2ReportBody,
  type V2SourcePosition,
  v2CoverageSchema,
  v2OfficialCitationSchema,
  v2OriginalManifestSchema,
  v2ReportBodySchema,
} from "../../../contracts/v2";
import { type Actor, aliveWorkspace, readSnapshot, type V2Core } from "../../db/v2-core";
import { createV2FileStagingRepository } from "../../db/v2-file-staging";
import { createV2FilesRepository } from "../../db/v2-files";
import {
  createV2OfficialSourceRepository,
  type OfficialSourceWrite,
} from "../../db/v2-official-sources";
import { createV2WorkspaceRepository, referencesAuthorized } from "../../db/v2-workspace";
import { digest } from "../files/binary";
import type { ZipSource } from "./zip";

export class ReportError extends Error {
  constructor(
    readonly code:
      | "CONSENT_REQUIRED"
      | "NOT_FOUND"
      | "STALE_REVISION"
      | "REVIEW_REQUIRED"
      | "VALIDATION_ERROR"
      | "STORAGE_UNAVAILABLE"
      | "BUDGET_UNAVAILABLE"
      | "USER_QUOTA_EXCEEDED"
      | "IDEMPOTENCY_CONFLICT"
      | "LEGAL_SOURCE_UNAVAILABLE"
      | "EXPORT_LIMIT_EXCEEDED",
  ) {
    super(code);
  }
}
export const reportReviewSchema = z.strictObject({
  format: z.literal("client_review_v1"),
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(30000),
  excludedFileIds: z.array(opaqueIdSchema).max(100),
  maskIdentifiers: z.boolean(),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  parentReportId: opaqueIdSchema.nullable(),
});
export type ReportReviewData = z.infer<typeof reportReviewSchema>;
function coverageText(value: V2Coverage | null) {
  if (!value) return "처리 범위를 확인하지 못함 · 원본에서 직접 확인 필요";
  const labels = {
    processed: "처리됨",
    low_quality: "품질 낮음",
    silent: "무음",
    missing: "누락",
    failed: "실패",
  };
  const audio = (v: import("../../../contracts/v2").V2AudioCoverage) => {
    const gaps = v.intervals.filter((i) => i.status !== "processed" && i.status !== "silent");
    return `${v.durationSeconds}초 중 ${v.status === "complete" ? "전체 구간 처리" : `${gaps.length}개 구간 확인 필요`}${
      gaps.length
        ? ` (${gaps
            .slice(0, 20)
            .map((i) => `${i.startSeconds}–${i.endSeconds}초 ${labels[i.status]}`)
            .join(
              ", ",
            )}${gaps.length > 20 ? `, 추가 ${gaps.length - 20}개 구간은 자료 화면에서 확인` : ""})`
        : ""
    }`;
  };
  if (value.category === "audio") return audio(value.audio);
  if (value.category === "image") return `이미지 관찰 ${labels[value.observation]}`;
  if (value.category === "document") {
    const gaps = value.pages.filter((p) => p.status !== "processed");
    return `${value.pageCount}쪽 중 ${value.pageCount - gaps.length}쪽 처리${
      gaps.length
        ? ` · 확인 필요: ${gaps
            .slice(0, 20)
            .map((p) => `${p.page}쪽 ${labels[p.status]}`)
            .join(
              ", ",
            )}${gaps.length > 20 ? `, 추가 ${gaps.length - 20}쪽은 자료 화면에서 확인` : ""}`
        : ""
    }`;
  }
  return `${value.durationSeconds}초 영상 · ${value.frames.filter((f) => f.status === "processed").length}/${value.frames.length}개 표본 처리 · 장면 감지 ${value.sceneDetection === "complete" ? "완료" : "실패"} · ${value.audio ? audio(value.audio) : "오디오 없음"} · 표본 사이 구간은 원본에서 확인 필요`;
}
export async function ownedWorkspace(core: V2Core, actor: Actor, id: string) {
  opaqueIdSchema.parse(id);
  const row = await core
    .statement(
      `SELECT w.revision,w.confirmed_summary_revision,w.status FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace}`,
      [id, actor.ownerId],
    )
    .first<{ revision: number; confirmed_summary_revision: number | null; status: string }>();
  if (!row) throw new ReportError("NOT_FOUND");
  return row;
}
/** Internal report/storage revisions do not make the source stale. Track the
 * actual summary, messages, material coverage, actions and timeline identities. */
export const REPORT_SOURCE_SQL = `SELECT 'summary' AS kind,s.id,s.revision AS revision,s.snapshot_id AS snapshot FROM v2_summaries s JOIN v2_intakes i ON i.summary_id=s.id WHERE i.id=?
    UNION ALL SELECT 'fact',id,revision,encrypted_payload FROM v2_facts WHERE workspace_id=? AND summary_revision=(SELECT confirmed_summary_revision FROM v2_workspaces WHERE id=v2_facts.workspace_id) AND (snapshot_id IS NULL OR EXISTS(SELECT 1 FROM v2_private_snapshots s WHERE s.id=v2_facts.snapshot_id AND s.state='published'))
    UNION ALL SELECT 'party',id,revision,encrypted_payload FROM v2_parties WHERE workspace_id=? AND summary_revision=(SELECT confirmed_summary_revision FROM v2_workspaces WHERE id=v2_parties.workspace_id) AND (snapshot_id IS NULL OR EXISTS(SELECT 1 FROM v2_private_snapshots s WHERE s.id=v2_parties.snapshot_id AND s.state='published'))
    UNION ALL SELECT 'file',f.id,f.revision,f.state || ':' || coalesce(f.manifest_snapshot_id,'') || ':' || coalesce(f.coverage_snapshot_id,'') || ':' || f.encrypted_payload FROM v2_files f WHERE f.workspace_id=? AND f.state!='deleting'
    UNION ALL SELECT 'message',id,revision,created_at FROM v2_messages WHERE workspace_id=?
    UNION ALL SELECT 'action',id,revision,'' FROM v2_actions WHERE workspace_id=?
    UNION ALL SELECT 'timeline',id,revision,'' FROM v2_timeline WHERE workspace_id=?
    UNION ALL SELECT 'citation',c.id,c.snapshot_revision,c.citation_json || ':' || coalesce(s.content_hash,'') || ':' || coalesce(s.canonical_url,'') || ':' || coalesce(s.verified_at,'') || ':' || coalesce(s.expires_at,'') || ':' || CASE WHEN s.fetched_at<=? AND s.verified_at<=? AND s.expires_at>? THEN 'fresh' ELSE 'unavailable' END FROM v2_citation_bindings c LEFT JOIN v2_official_sources s ON s.source_id=c.source_id WHERE c.workspace_id=? ORDER BY kind,id`;
export async function reportSourceRows(core: V2Core, actor: Actor, id: string) {
  return (
    await core
      .statement(REPORT_SOURCE_SQL, [
        id,
        id,
        id,
        id,
        id,
        id,
        id,
        actor.now,
        actor.now,
        actor.now,
        id,
      ])
      .all<{ kind: string; id: string; revision: number; snapshot: string }>()
  ).results;
}
export async function sourceDigest(core: V2Core, actor: Actor, id: string) {
  const workspace = await ownedWorkspace(core, actor, id);
  const rows = await reportSourceRows(core, actor, id);
  return reportSourceDigest(workspace.confirmed_summary_revision, workspace.status, rows);
}
export function reportSourceDigest(
  summary: number | null,
  status: string,
  rows: { id: string; kind: string; revision: number; snapshot: string }[],
) {
  // Preserve runtimeDigest's alphabetical canonical key order for existing reports,
  // while source identities may exceed its unrelated 64 KiB paid-proof limit.
  return digest(
    new TextEncoder().encode(
      JSON.stringify({
        rows: rows.map(({ id, kind, revision, snapshot }) => ({ id, kind, revision, snapshot })),
        status,
        summary,
      }),
    ),
  );
}
/** Only reuse citations already bound by legal-retrieval. No discovery, model
 * call or legal API request belongs in the export path. */
async function verifiedCitations(
  core: V2Core,
  actor: Actor,
  id: string,
  refs: V2ReportBody["facts"][number]["references"],
  guideHosts: readonly string[],
) {
  const ids = [
    ...new Set(refs.flatMap((ref) => (ref.kind === "official_source" ? [ref.citationId] : []))),
  ];
  if (ids.length > 50) throw new ReportError("VALIDATION_ERROR");
  const repository = createV2OfficialSourceRepository(core, guideHosts),
    citations: V2ReportBody["citations"] = [];
  for (const citationId of ids) {
    const row = await core
      .statement(
        "SELECT c.citation_json,s.source_id,s.source_type,s.official_id,s.version,s.section,s.content_hash,s.extractor_version FROM v2_citation_bindings c JOIN v2_official_sources s ON s.source_id=c.source_id WHERE c.id=? AND c.workspace_id=?",
        [citationId, id],
      )
      .first<{
        citation_json: string;
        source_id: string;
        source_type: OfficialSourceWrite["sourceType"];
        official_id: string;
        version: string;
        section: string;
        content_hash: string;
        extractor_version: string;
      }>();
    if (!row) throw new ReportError("LEGAL_SOURCE_UNAVAILABLE");
    const parsed = v2OfficialCitationSchema(guideHosts).safeParse(JSON.parse(row.citation_json));
    if (!parsed.success || parsed.data.id !== citationId)
      throw new ReportError("LEGAL_SOURCE_UNAVAILABLE");
    const c = parsed.data,
      source = await repository.find(
        {
          sourceId: row.source_id,
          sourceType: row.source_type,
          officialId: row.official_id,
          version: row.version,
          section: row.section,
          contentHash: row.content_hash,
          extractorVersion: row.extractor_version,
        },
        actor.now,
      );
    if (
      !source ||
      source.sourceId !== c.sourceId ||
      source.sourceType !== c.kind ||
      source.contentHash !== c.contentHash ||
      source.canonicalUrl !== c.url ||
      source.title !== c.title ||
      Date.parse(source.verifiedAt) !== Date.parse(c.verifiedAt) ||
      (c.kind === "statute"
        ? source.officialId !== c.officialId ||
          source.section !== c.article ||
          source.sourceDate !== c.effectiveDate
        : c.kind === "precedent"
          ? source.officialId !== c.officialId ||
            source.court !== c.court ||
            source.caseNumber !== c.caseNumber ||
            source.sourceDate !== c.decisionDate
          : source.institutionId !== c.institutionId ||
            source.endpointId !== c.endpointId ||
            source.section !== c.section ||
            source.sourceDate !== c.publishedDate)
    )
      throw new ReportError("LEGAL_SOURCE_UNAVAILABLE");
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source.body))),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    if (hash !== source.contentHash) throw new ReportError("LEGAL_SOURCE_UNAVAILABLE");
    citations.push(c);
  }
  return citations;
}
export async function reportFile(core: V2Core, actor: Actor, fileId: string) {
  const metadata = await createV2FilesRepository(core).metadata(actor, fileId);
  if (!metadata) throw new ReportError("STALE_REVISION");
  const manifestRevision = metadata.manifestSnapshotId
    ? await core
        .statement("SELECT revision FROM v2_private_snapshots WHERE id=?", [
          metadata.manifestSnapshotId,
        ])
        .first<number>("revision")
    : null;
  return {
    ...metadata,
    manifest:
      metadata.manifestSnapshotId && manifestRevision
        ? await readSnapshot(
            core,
            actor,
            metadata.manifestSnapshotId,
            "file_manifest",
            fileId,
            manifestRevision,
            v2OriginalManifestSchema,
          )
        : null,
    coverage: metadata.coverageSnapshotId
      ? await readSnapshot(
          core,
          actor,
          metadata.coverageSnapshotId,
          "file_coverage",
          fileId,
          metadata.revision,
          v2CoverageSchema,
        )
      : null,
  };
}

export async function buildReportSource(
  core: V2Core,
  actor: Actor,
  id: string,
  excluded: readonly string[],
  guideHosts: readonly string[] = [],
) {
  const current = await ownedWorkspace(core, actor, id);
  if (current.status !== "active" || !current.confirmed_summary_revision)
    throw new ReportError("REVIEW_REQUIRED");
  const digest = await sourceDigest(core, actor, id);
  const workspace = createV2WorkspaceRepository(core.binding, core.cipher, guideHosts);
  const summary = (await workspace.readIntake(actor, id))?.summary;
  if (!summary || summary.revision !== current.confirmed_summary_revision)
    throw new ReportError("REVIEW_REQUIRED");
  const fileRows = await core
    .statement(
      "SELECT id,revision,state FROM v2_files WHERE workspace_id=? AND state!='deleting' ORDER BY id LIMIT 101",
      [id],
    )
    .all<{ id: string; revision: number; state: string }>();
  if (
    fileRows.results.length > 100 ||
    excluded.some((fileId) => !fileRows.results.some((f) => f.id === fileId))
  )
    throw new ReportError("VALIDATION_ERROR");
  const selectedFiles: V2ReportBody["selectedFiles"] = [],
    coverage: string[] = [];
  for (const row of fileRows.results) {
    if (excluded.includes(row.id)) continue;
    const file = await reportFile(core, actor, row.id);
    if (!file || file.revision !== row.revision) throw new ReportError("STALE_REVISION");
    if (file.status !== "ready" || !file.manifest) {
      coverage.push(
        `${file.name}: ${file.status === "failed" ? "처리 실패" : "처리 미완료"} · 원본에서 직접 확인 필요`,
      );
      continue;
    }
    selectedFiles.push({
      id: file.id,
      revision: file.revision,
      name: file.name,
      byteLength: file.manifest.byteLength,
      contentHash: file.manifest.contentHash,
    });
    coverage.push(
      `${file.name}: ${coverageText(file.coverage)} · 추출·관찰은 진정성을 확인하지 않음`,
    );
    let cursor = -1;
    do {
      const page = await createV2FileStagingRepository(core).observations(actor, row.id, cursor, 4);
      for (const { value } of page)
        if (value.included)
          coverage.push(
            `${file.name} · 자료 버전 ${file.revision} · ${sourcePositionText(value.position)} · ${value.userEdited ? "사용자 교정 · 미확인" : "자료 관찰"}\n${value.text}`,
          );
      if (coverage.join("\n").length > 20000) throw new ReportError("EXPORT_LIMIT_EXCEEDED");
      cursor = page.length === 4 ? (page.at(-1)?.ordinal ?? -1) : -1;
    } while (cursor >= 0);
  }
  const selected = new Set(selectedFiles.map((f) => f.id));
  const allowed = (refs: V2ReportBody["facts"][number]["references"]) =>
    refs.every(
      (ref) =>
        ref.kind !== "user_material" ||
        (selected.has(ref.fileId) &&
          selectedFiles.some(
            (file) => file.id === ref.fileId && file.revision === ref.fileRevision,
          )),
    );
  let facts = summary.facts.filter((fact) => allowed(fact.references));
  // Excluding material also removes conflicting facts whose counterpart was
  // excluded, instead of leaving references to a hidden item in the export.
  while (
    facts.some((fact) => fact.conflictingFactIds.some((fid) => !facts.some((f) => f.id === fid)))
  ) {
    facts = facts.filter((fact) =>
      fact.conflictingFactIds.every((fid) => facts.some((f) => f.id === fid)),
    );
  }
  if (facts.length !== summary.facts.length)
    coverage.push(
      `제외했거나 현재 출처를 확인할 수 없는 자료를 참조한 사실 ${summary.facts.length - facts.length}개를 리포트에서 제외했습니다. 원본과 직접 확인해 주세요.`,
    );
  const factIds = new Set(facts.map((fact) => fact.id));
  const timeline: V2ReportBody["timeline"] = [],
    actions: V2ReportBody["actions"] = [];
  let after: string | undefined;
  let scanned = 0;
  do {
    const page = await workspace.timeline(actor, id, after, 8);
    scanned += page.length;
    timeline.push(
      ...page.filter(
        (entry) => allowed(entry.references) && entry.factIds.every((fid) => factIds.has(fid)),
      ),
    );
    after = page.length === 8 ? page.at(-1)?.id : undefined;
  } while (after && scanned <= 300);
  if (scanned > 300) throw new ReportError("VALIDATION_ERROR");
  after = undefined;
  scanned = 0;
  do {
    const page = await workspace.actions(actor, id, after, 8);
    scanned += page.length;
    actions.push(
      ...page.filter(
        (entry) => allowed(entry.references) && entry.factIds.every((fid) => factIds.has(fid)),
      ),
    );
    after = page.length === 8 ? page.at(-1)?.id : undefined;
  } while (after && scanned <= 100);
  if (scanned > 100) throw new ReportError("VALIDATION_ERROR");
  const references = [
    ...facts.flatMap((f) => f.references),
    ...timeline.flatMap((e) => e.references),
    ...actions.flatMap((e) => e.references),
  ];
  const citations = await verifiedCitations(core, actor, id, references, guideHosts);
  if (
    !(await referencesAuthorized(
      core,
      { ...actor, workspaceId: id, expectedRevision: current.revision },
      references,
    ))
  )
    throw new ReportError("STALE_REVISION");
  const body = v2ReportBodySchema(guideHosts).parse({
    schemaVersion: "2",
    overview: summary.overview,
    parties: summary.parties,
    facts,
    timeline,
    selectedFiles,
    unknowns: summary.unknowns,
    actions,
    lawyerQuestions: [],
    citations,
    legalSourceStatus: citations.length ? "verified" : "not_requested",
    notices: [
      ...summary.notices,
      ...(summary.notices.length < 20
        ? ["법률 판단·원본 진정성·법적 효력을 보장하지 않습니다. 사용자가 검토 후 직접 전달합니다."]
        : []),
    ],
    generatedAt: actor.now,
  });
  if ((await sourceDigest(core, actor, id)) !== digest) throw new ReportError("STALE_REVISION");
  return { current, digest, body, coverage };
}
export const sourcePositionText = (p: V2SourcePosition) =>
  p.kind === "document"
    ? `${p.page}쪽${p.paragraph ? ` · ${p.paragraph}번째 문단` : ""}${p.table ? ` · 표 ${p.table.index}, 행 ${p.table.row}, 열 ${p.table.column}` : ""}`
    : p.kind === "audio"
      ? `${p.startSeconds}–${p.endSeconds}초`
      : p.kind === "video"
        ? `${p.timestampSeconds}초 · 프레임 ${p.frameIndex} · ${p.sampling === "one_second" ? "1초 표본" : "장면 전환 표본"}`
        : "이미지 관찰";

export function reportText(body: V2ReportBody, coverage: readonly string[]) {
  const labels = {
    user_statement: "사용자 진술",
    user_material: "자료 관찰",
    official_source: "공식 출처",
    ai_organization: "AI 정리",
  };
  const certainty = {
    reported: "진술됨",
    observed: "자료에서 관찰",
    uncertain: "미확인",
    conflicting: "상반됨",
  };
  const refs = (references: V2ReportBody["facts"][number]["references"]) =>
    references
      .map((ref) =>
        ref.kind === "user_material"
          ? `${body.selectedFiles.find((file) => file.id === ref.fileId)?.name ?? ref.fileId} · 자료 버전 ${ref.fileRevision} · ${sourcePositionText(ref.position)}`
          : ref.kind === "user_message"
            ? `대화 ${ref.messageId}`
            : ref.kind === "intake_narrative"
              ? `입력 버전 ${ref.intakeRevision}`
              : ref.kind === "intake_answer"
                ? `답변 ${ref.questionId}`
                : `공식 출처 ${ref.citationId}`,
      )
      .join(" / ");
  const text = [
    "사건 요약",
    body.overview,
    "",
    "당사자",
    ...body.parties.map((party) => `${party.label} · ${party.role}`),
    "",
    "사실·주장·출처",
    ...body.facts.map(
      (fact) =>
        `${fact.text}\n[${labels[fact.attribution]} · ${certainty[fact.certainty]} · ${refs(fact.references)}${fact.conflictingFactIds.length ? ` · 상반 항목: ${fact.conflictingFactIds.join(", ")}` : ""}]`,
    ),
    "",
    "미확인 사항",
    ...body.unknowns,
    "",
    "타임라인",
    ...body.timeline.map(
      (entry) =>
        `${entry.date ?? "날짜 미확인"} · ${entry.event} · ${certainty[entry.certainty]} · ${refs(entry.references)}`,
    ),
    "",
    "공식 출처",
    ...body.citations.map(
      (c) =>
        `${c.title}\n${c.kind === "statute" ? `${c.article} · 시행일 ${c.effectiveDate}` : c.kind === "precedent" ? `${c.court} · ${c.caseNumber} · 선고일 ${c.decisionDate}` : `${c.section} · 게시일 ${c.publishedDate ?? "미확인"}`}\n${c.url}\n검증 시각: ${c.verifiedAt}`,
    ),
    "",
    "준비할 행동",
    ...body.actions.map(
      (entry) =>
        `${entry.title} (${entry.status})\n${entry.instructions}\n주의: ${entry.caution}\n출처: ${refs(entry.references)}`,
    ),
    "",
    "자료 처리 범위",
    ...coverage,
    "",
    "안내",
    ...body.notices,
    `작성 시각: ${body.generatedAt}`,
  ].join("\n");
  if (text.length > 30000) throw new ReportError("VALIDATION_ERROR");
  return text;
}
export function validateOriginalSelection(
  body: V2ReportBody,
  excluded: readonly string[],
  selected: readonly string[],
) {
  if (
    !selected.length ||
    selected.length > 100 ||
    new Set(selected).size !== selected.length ||
    selected.some(
      (id) => excluded.includes(id) || !body.selectedFiles.some((file) => file.id === id),
    )
  )
    throw new ReportError("VALIDATION_ERROR");
  return selected
    .map((id) => body.selectedFiles.find((file) => file.id === id))
    .filter((file): file is V2ReportBody["selectedFiles"][number] => !!file) satisfies Omit<
    ZipSource,
    "open"
  >[];
}
