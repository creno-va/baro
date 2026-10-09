import { expect, test } from "bun:test";
import type { V2Summary } from "../src/contracts/v2";
import { snapshotStatements } from "../src/server/db/v2-core";
import { createV2OfficialSourceRepository } from "../src/server/db/v2-official-sources";
import { createV2ReportsRepository } from "../src/server/db/v2-reports";
import { digest } from "../src/server/modules/files/binary";
import { decryptExport, planExport } from "../src/server/modules/reports/binary";
import { createReportsService } from "../src/server/modules/reports/service";
import { streamChunks, zipByteLength, zipChunks } from "../src/server/modules/reports/zip";
import { readyFile, reportFixture } from "./helpers/report-fixture";

test("actual SQL encrypted immutable reports preserve review, masking, revision and idempotent lost responses", async () => {
  const f = await reportFixture(),
    owner = f.actor.ownerId;
  const draft = await f.reports.get(owner, f.workspaceId);
  expect(draft.content).toContain("사건 요약");
  expect(draft.stale).toBe(false);
  const key = crypto.randomUUID(),
    input = {
      expectedRevision: draft.revision,
      content: "검토한 한글 내용 010-1234-5678",
      maskIdentifiers: true,
      excludedFileIds: [],
    };
  const saved = await f.reports.save(owner, f.workspaceId, key, input);
  expect(saved.revision).toBe(2);
  expect(saved.maskIdentifiers).toBe(true);
  expect(await f.reports.save(owner, f.workspaceId, key, input)).toEqual(saved);
  await expect(f.reports.save(owner, f.workspaceId, crypto.randomUUID(), input)).rejects.toThrow(
    "STALE_REVISION",
  );
  const canonical = await createV2ReportsRepository(f.core).read(f.actor, saved.id);
  expect(canonical?.body.overview).toContain("합성 리포트 사건 요약");
  expect(
    JSON.stringify(f.db.sqlite.query("SELECT encrypted_payload FROM v2_private_parts").all()),
  ).not.toContain("검토한 한글 내용");
  const download = await f.reports.pdf(owner, saved.id),
    bytes = new Uint8Array(await new Response(download.body).arrayBuffer());
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  expect(bytes.length).toBe(download.byteLength);
  expect((await f.reports.get(owner, f.workspaceId)).stale).toBe(false);
  expect((await createV2ReportsRepository(f.core).read(f.actor, saved.id))?.status).toBe("ready");
  for (const stored of f.bucket.objects.values())
    expect(new TextDecoder().decode(stored)).not.toContain("검토한 한글 내용");
  const again = await f.reports.pdf(owner, saved.id);
  expect(new Uint8Array(await new Response(again.body).arrayBuffer())).toEqual(bytes);
});
test("ZIP contains exactly chosen owned original names and bytes; excludes, peers, source changes and duplicates deny export", async () => {
  const f = await reportFixture(),
    owner = f.actor.ownerId;
  const first = await readyFile(f, "선택한 합성 원본 010-1234-5678"),
    second = await readyFile(f, "선택하지 않은 원본");
  const report = await f.reports.get(owner, f.workspaceId),
    key = crypto.randomUUID();
  const zip = await f.reports.zip(owner, report.id, key, [first.session.fileId]);
  const bytes = new Uint8Array(await new Response(zip.body).arrayBuffer());
  expect(bytes.length).toBe(zip.byteLength);
  expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 3, 4]));
  expect(new TextDecoder().decode(bytes)).toContain("선택한 합성 원본");
  expect(new TextDecoder().decode(bytes)).not.toContain("선택하지 않은 원본");
  expect(new TextDecoder().decode(bytes)).toContain("합성💙 자료.txt");
  const replay = await f.reports.zip(owner, report.id, key, [first.session.fileId]);
  expect(new Uint8Array(await new Response(replay.body).arrayBuffer())).toEqual(bytes);
  await expect(
    f.reports.zip(owner, report.id, crypto.randomUUID(), [
      first.session.fileId,
      first.session.fileId,
    ]),
  ).rejects.toThrow("VALIDATION_ERROR");
  await expect(f.reports.pdf(crypto.randomUUID(), report.id)).rejects.toThrow("NOT_FOUND");
  const saved = await f.reports.save(owner, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: report.revision,
    content: report.content,
    maskIdentifiers: true,
    excludedFileIds: [second.session.fileId],
  });
  await expect(
    f.reports.zip(owner, saved.id, crypto.randomUUID(), [second.session.fileId]),
  ).rejects.toThrow("VALIDATION_ERROR");
  f.db.sqlite.query("UPDATE v2_files SET revision=revision+1 WHERE id=?").run(first.session.fileId);
  expect((await f.reports.get(owner, f.workspaceId)).stale).toBe(true);
  await expect(f.reports.pdf(owner, saved.id)).rejects.toThrow("STALE_REVISION");
});
test("ambiguous R2 write journals cleanup and a fenced retry cannot revive a deleted workspace", async () => {
  const f = await reportFixture(),
    owner = f.actor.ownerId,
    draft = await f.reports.get(owner, f.workspaceId);
  f.setFailure(true);
  await expect(f.reports.pdf(owner, draft.id)).rejects.toThrow("STORAGE_UNAVAILABLE");
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs WHERE kind='report_pdf'").get()).toEqual({
    state: "deleting",
  });
  expect(
    f.db.sqlite.query("SELECT count(*) AS n FROM v2_deletion_targets WHERE kind='blob'").get(),
  ).toEqual({ n: 1 });
  f.setFailure(false);
  const retry = await f.reports.pdf(owner, draft.id);
  expect((await new Response(retry.body).arrayBuffer()).byteLength).toBe(retry.byteLength);
  const next = await f.reports.generate(owner, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: draft.revision,
  });
  f.setHook(async () => {
    f.db.sqlite.query("DELETE FROM v2_workspaces WHERE id=?").run(f.workspaceId);
  });
  await expect(f.reports.pdf(owner, next.id)).rejects.toThrow();
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_reports").get()).toEqual({ n: 0 });
  expect(
    f.db.sqlite.query("SELECT count(*) AS n FROM v2_blobs WHERE state='stored'").get(),
  ).toEqual({ n: 0 });
  await expect(f.reports.get(owner, f.workspaceId)).rejects.toThrow("NOT_FOUND");
});
test("missing physical/billing admission fails closed before a real R2 write", async () => {
  const f = await reportFixture();
  const { testOnlyUnmeteredStorage: _test, ...actualDeps } = f.deps;
  const actual = createReportsService(f.core, actualDeps);
  const report = await actual.get(f.actor.ownerId, f.workspaceId),
    before = f.bucket.objects.size;
  await expect(actual.pdf(f.actor.ownerId, report.id)).rejects.toThrow("BUDGET_UNAVAILABLE");
  expect(f.bucket.objects.size).toBe(before);
});
test("export AEAD rejects source mutation, corruption and the wrong owner across bounded chunks", async () => {
  const f = await reportFixture();
  const bytes = new Uint8Array(600000).fill(7),
    id = {
      environment: "preview" as const,
      ownerId: f.actor.ownerId,
      reportId: crypto.randomUUID(),
      blobId: crypto.randomUUID(),
      revision: 1,
      kind: "original_zip" as const,
    };
  const plan = await planExport(
    f.core.cipher,
    id,
    bytes.length,
    async function* () {
      yield bytes;
    },
    async () => {},
  );
  const encrypted = new Uint8Array(await new Response(streamChunks(plan.open())).arrayBuffer());
  const expected = {
    byteLength: plan.byteLength,
    contentHash: plan.contentHash,
    cipherBytes: plan.cipherBytes,
    cipherHash: plan.cipherHash,
  };
  const decoded = new Uint8Array(
    await new Response(
      streamChunks(
        decryptExport(
          f.core.cipher,
          id,
          expected,
          new Response(encrypted).body as ReadableStream<Uint8Array>,
          async () => {},
        ),
      ),
    ).arrayBuffer(),
  );
  expect(decoded).toEqual(bytes);
  await expect(
    new Response(
      streamChunks(
        decryptExport(
          f.core.cipher,
          { ...id, ownerId: crypto.randomUUID() },
          expected,
          new Response(encrypted).body as ReadableStream<Uint8Array>,
          async () => {},
        ),
      ),
    ).arrayBuffer(),
  ).rejects.toThrow();
  encrypted[encrypted.length - 1] = (encrypted.at(-1) ?? 0) ^ 1;
  await expect(
    new Response(
      streamChunks(
        decryptExport(
          f.core.cipher,
          id,
          expected,
          new Response(encrypted).body as ReadableStream<Uint8Array>,
          async () => {},
        ),
      ),
    ).arrayBuffer(),
  ).rejects.toThrow();
  bytes[0] = 8;
  await expect(new Response(streamChunks(plan.open())).arrayBuffer()).rejects.toThrow(
    "EXPORT_SOURCE_CHANGED",
  );
});

async function replaceSummary(
  f: Awaited<ReturnType<typeof reportFixture>>,
  facts: V2Summary["facts"],
) {
  const snapshotId = crypto.randomUUID(),
    claim = crypto.randomUUID();
  // Replace an encrypted immutable snapshot only inside this synthetic fixture;
  // the product publishes a fresh summary revision through its existing CAS.
  f.db.sqlite
    .query(
      "DELETE FROM v2_private_snapshots WHERE purpose='summary' AND target_id=? AND revision=1",
    )
    .run(f.workspaceId);
  await f.core.binding.batch([
    f.core.claim({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() }, claim),
    ...(await snapshotStatements(
      f.core,
      {
        id: snapshotId,
        ownerId: f.actor.ownerId,
        workspaceId: f.workspaceId,
        targetId: f.workspaceId,
        revision: 1,
        purpose: "summary",
        now: f.actor.now,
      },
      {
        schemaVersion: "2",
        revision: 1,
        intakeRevision: 1,
        createdAt: f.actor.now,
        overview: "합성 출처 검토",
        facts,
        parties: [],
        unknowns: [],
        notices: ["합성 검증 자료"],
      },
      claim,
    )),
    f.core.finish(claim),
  ]);
  const summaryId = crypto.randomUUID();
  f.db.sqlite
    .query(
      "INSERT INTO v2_summaries(id,workspace_id,revision,intake_revision,snapshot_id,created_at) VALUES(?,?,1,1,?,?)",
    )
    .run(summaryId, f.workspaceId, snapshotId, f.actor.now);
  f.db.sqlite
    .query(
      "UPDATE v2_intakes SET summary_id=?,status='confirmed',confirmed_summary_revision=1 WHERE id=?",
    )
    .run(summaryId, f.workspaceId);
}
test("reuse bound verified official citations without retrieval; expiry invalidates an existing report and refuses new export", async () => {
  const f = await reportFixture(),
    repository = createV2OfficialSourceRepository(f.core),
    sourceId = crypto.randomUUID(),
    citationId = crypto.randomUUID(),
    officialId = crypto.randomUUID(),
    body = "공식 출처 합성 본문",
    contentHash = await digest(new TextEncoder().encode(body));
  const citation = {
    id: citationId,
    sourceId,
    kind: "statute" as const,
    officialId,
    title: "합성 검증 법령",
    article: "제1조",
    effectiveDate: "2026-10-01",
    url: "https://www.law.go.kr/법령/합성",
    verifiedAt: f.actor.now,
    contentHash,
  };
  expect(
    await repository.put(
      {
        sourceId,
        sourceType: "statute",
        officialId,
        version: "v1",
        section: "제1조",
        contentHash,
        extractorVersion: "synthetic",
        canonicalUrl: citation.url,
        title: citation.title,
        body,
        sourceDate: citation.effectiveDate,
        fetchedAt: f.actor.now,
        verifiedAt: f.actor.now,
        expiresAt: "2026-10-07T00:00:00.000Z",
        rightsProvenance: "synthetic only",
        institutionId: null,
        endpointId: null,
        court: null,
        caseNumber: null,
      },
      citation,
    ),
  ).toBe(true);
  expect(
    await repository.bindCitation(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      citation,
    ),
  ).toBe(true);
  await replaceSummary(f, [
    {
      id: crypto.randomUUID(),
      text: "검증된 출처를 참조한 합성 항목",
      attribution: "official_source",
      certainty: "observed",
      significance: "neutral",
      references: [{ kind: "official_source", citationId }],
      conflictingFactIds: [],
      userEdited: false,
    },
  ]);
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  expect(report.content).toContain(citation.title);
  expect(
    (await createV2ReportsRepository(f.core).read(f.actor, report.id))?.body.citations,
  ).toEqual([citation]);
  const expired = createReportsService(f.core, {
    ...f.deps,
    clock: () => "2026-10-08T00:00:00.000Z",
  });
  expect((await expired.get(f.actor.ownerId, f.workspaceId)).stale).toBe(true);
  await expect(expired.pdf(f.actor.ownerId, report.id)).rejects.toThrow("STALE_REVISION");
  await expect(
    expired.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: report.revision,
    }),
  ).rejects.toThrow("LEGAL_SOURCE_UNAVAILABLE");
});
test("existing canonical reports without client review remain readable and require explicit regeneration", async () => {
  const f = await reportFixture(),
    draft = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const canonical = f.db.sqlite
    .query("SELECT workspace_revision FROM v2_reports WHERE id=?")
    .get(draft.id) as { workspace_revision: number };
  f.db.sqlite
    .query("DELETE FROM v2_private_snapshots WHERE target_id=? AND purpose='report' AND revision=?")
    .run(draft.id, canonical.workspace_revision + 1);
  const legacy = await f.reports.get(f.actor.ownerId, f.workspaceId);
  expect(legacy.id).toBe(draft.id);
  expect(legacy.content).toContain("합성 리포트 사건 요약");
  expect(legacy.stale).toBe(true);
  await expect(f.reports.pdf(f.actor.ownerId, legacy.id)).rejects.toThrow("STALE_REVISION");
  expect(
    (
      await f.reports.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
        expectedRevision: legacy.revision,
      })
    ).stale,
  ).toBe(false);
});
test("material exclusions remove their canonical facts; foreign and stale source references block a new report", async () => {
  const f = await reportFixture(),
    u = await readyFile(f, "합성 사실의 원본"),
    factId = crypto.randomUUID();
  const fact = {
    id: factId,
    text: "선택 자료에서 관찰한 합성 사실",
    attribution: "user_material" as const,
    certainty: "observed" as const,
    significance: "neutral" as const,
    references: [
      {
        kind: "user_material" as const,
        fileId: u.session.fileId,
        fileRevision: 2,
        position: { kind: "document" as const, page: 1, paragraph: null, table: null },
      },
    ],
    conflictingFactIds: [],
    userEdited: false,
  };
  await replaceSummary(f, [fact]);
  const draft = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const saved = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: draft.revision,
    content: "직접 검토한 합성 내용",
    maskIdentifiers: true,
    excludedFileIds: [u.session.fileId],
  });
  expect((await createV2ReportsRepository(f.core).read(f.actor, saved.id))?.body.facts).toEqual([]);
  const reference = fact.references[0];
  if (!reference) throw new Error("synthetic source missing");
  await replaceSummary(f, [
    { ...fact, references: [{ ...reference, fileId: crypto.randomUUID() }] },
  ]);
  // A removed or foreign material cannot leak into the report. It is excluded
  // from the source by membership, never accepted as an observed owned file.
  const next = await f.reports.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: saved.revision,
  });
  expect(next.content).not.toContain(fact.text);
  await replaceSummary(f, [
    {
      ...fact,
      references: [{ kind: "intake_narrative", intakeRevision: 999 }],
      attribution: "user_statement",
      certainty: "reported",
    },
  ]);
  await expect(
    f.reports.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: next.revision,
    }),
  ).rejects.toThrow("STALE_REVISION");
});
test("streaming ZIP rejects changed originals and unsafe names before claiming a complete download", async () => {
  const bytes = new TextEncoder().encode("synthetic"),
    source = {
      id: "source",
      name: "합성.txt",
      byteLength: bytes.length,
      contentHash: await digest(bytes),
      open: async () => new Response(bytes).body as ReadableStream<Uint8Array>,
    };
  const stream = () => zipChunks([source], async () => {});
  expect((await new Response(streamChunks(stream())).arrayBuffer()).byteLength).toBe(
    zipByteLength([source]),
  );
  source.contentHash = "0".repeat(64);
  await expect(new Response(streamChunks(stream())).arrayBuffer()).rejects.toThrow(
    "EXPORT_SOURCE_CHANGED",
  );
  expect(() => zipByteLength([{ ...source, name: "../wrong.txt" }])).toThrow(
    "EXPORT_INVALID_FILENAME",
  );
});

test("stored historical PDF keeps its exact bytes after newer source and consent changes, but owner/delete fences remain", async () => {
  const f = await reportFixture(),
    a = f.actor.ownerId;
  const old = await f.reports.get(a, f.workspaceId);
  const original = await f.reports.pdf(a, old.id),
    bytes = await new Response(original.body).arrayBuffer();
  await readyFile(f, "새로 추가한 합성 자료");
  expect((await f.reports.get(a, f.workspaceId)).stale).toBe(true);
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(a);
  const stored = await f.reports.pdf(a, old.id);
  expect(await new Response(stored.body).arrayBuffer()).toEqual(bytes);
  expect((await f.reports.get(a, f.workspaceId)).content).toBe(old.content);
  await expect(f.reports.generate(a, f.workspaceId, crypto.randomUUID(), {})).rejects.toMatchObject(
    { code: "CONSENT_REQUIRED" },
  );
  await expect(f.reports.pdf(crypto.randomUUID(), old.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const late = await f.reports.pdf(a, old.id);
  f.db.sqlite.query("DELETE FROM v2_workspaces WHERE id=?").run(f.workspaceId);
  await expect(new Response(late.body).arrayBuffer()).rejects.toThrow();
});

test("excluding a material rebuilds the rendered review, removing its observed text from actual PDF input", async () => {
  const f = await reportFixture(),
    a = f.actor.ownerId,
    u = await readyFile(f, "제외 대상 원본"),
    fileId = u.session.fileId;
  const id = crypto.randomUUID(),
    entity = crypto.randomUUID();
  const payload = await f.core.encrypt("v2_file_observations", id, a, 2, {
    id: entity,
    text: "제외 대상 비공개 문장",
    position: { kind: "document", page: 1, paragraph: null, table: null },
    certainty: "observed",
    userEdited: false,
    included: true,
  });
  f.db.sqlite
    .query(
      "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload) VALUES(?,?,?,2,2,0,?)",
    )
    .run(id, entity, fileId, payload);
  const prior = await f.reports.get(a, f.workspaceId);
  expect(prior.content).toContain("제외 대상 비공개 문장");
  const saved = await f.reports.save(a, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: prior.revision,
    content: prior.content,
    maskIdentifiers: true,
    excludedFileIds: [fileId],
  });
  expect(saved.content).not.toContain("제외 대상 비공개 문장");
  expect(
    (await createV2ReportsRepository(f.core).read(f.actor, saved.id))?.body.selectedFiles,
  ).toEqual([]);
  expect(
    (await createV2ReportsRepository(f.core).read(f.actor, prior.id))?.body.selectedFiles,
  ).toHaveLength(1);
  const pdf = await f.reports.pdf(a, saved.id);
  expect((await new Response(pdf.body).arrayBuffer()).byteLength).toBe(pdf.byteLength);
});
