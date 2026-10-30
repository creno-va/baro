import { expect, test } from "bun:test";
import { v2ReportBodySchema } from "../src/contracts/v2";
import { createV2OfficialSourceRepository } from "../src/server/db/v2-official-sources";
import { createV2ReportsRepository } from "../src/server/db/v2-reports";
import { readBoundSource } from "../src/server/modules/legal-retrieval/v2/bound-sources";
import { OFFICIAL_CATALOG } from "../src/server/modules/legal-retrieval/v2/registry";
import { makeChunk } from "../src/server/modules/legal-retrieval/v2/source";
import { exportFence } from "../src/server/modules/reports/fence";
import { createReportsService } from "../src/server/modules/reports/service";
import { sourceDigest } from "../src/server/modules/reports/source";
import { reportFixture } from "./helpers/report-fixture";

async function official(now: string, section = "제1조") {
  return makeChunk(
    {
      sourceType: "statute",
      officialId: "1706",
      version: "284415",
      section,
      canonicalUrl: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=284415",
      title: "합성 검증 법령",
      body: `합성 공식 원문 ${section}`,
      sourceDate: "2026-10-01",
      fetchedAt: now,
      verifiedAt: now,
      rightsProvenance: OFFICIAL_CATALOG[0].rights,
      institutionId: null,
      endpointId: null,
      court: null,
      caseNumber: null,
    },
    now.slice(0, 10),
  );
}
async function bind(
  f: Awaited<ReturnType<typeof reportFixture>>,
  chunk: Awaited<ReturnType<typeof official>>,
  now: string,
) {
  const repo = createV2OfficialSourceRepository(f.core);
  expect(await repo.put(chunk.source, chunk.citation)).toBe(true);
  expect(
    await repo.bindCitation(
      { ...f.actor, now, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      chunk.citation,
    ),
  ).toBe(true);
}

for (const refresh of [false, true])
  test(`new PDF excludes unrelated historical citation authority, with source refresh ${refresh}`, async () => {
    const f = await reportFixture();
    const old = await official(f.actor.now);
    await bind(f, old, f.actor.now);
    const original = await f.reports.get(f.actor.ownerId, f.workspaceId);
    const later = new Date(Date.parse(f.actor.now) + 2 * 86400000).toISOString();
    if (refresh) {
      const next = await official(later);
      expect(next.source.sourceId).toBe(old.source.sourceId);
      await bind(f, next, later);
      expect(await readBoundSource(f.core, f.workspaceId, next.citation.id, later)).not.toBeNull();
    }
    const priorSource = await readBoundSource(f.core, f.workspaceId, old.citation.id, later);
    if (refresh) expect(priorSource?.citation).toEqual(old.citation);
    else expect(priorSource).toBeNull();
    const reports = createReportsService(f.core, { ...f.deps, clock: () => later });
    expect((await reports.get(f.actor.ownerId, f.workspaceId)).stale).toBe(true);
    const generated = await reports.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: original.revision,
    });
    expect(generated.stale).toBe(false);
    const body = (
      await createV2ReportsRepository(f.core).read({ ...f.actor, now: later }, generated.id)
    )?.body;
    expect(body?.citations).toEqual([]);
    expect(body?.legalSourceStatus).toBe("not_requested");
    const result = await reports.pdf(f.actor.ownerId, generated.id);
    const bytes = new Uint8Array(await new Response(result.body).arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBe(result.byteLength);
    expect(await reports.html(f.actor.ownerId, original.id)).toContain(
      `BARO · 리포트 ${original.revision}`,
    );
    f.db.close();
  });

test("scoped export fences preserve required source integrity and all source metadata and session boundaries", async () => {
  const f = await reportFixture();
  const old = await official(f.actor.now),
    later = new Date(Date.parse(f.actor.now) + 2 * 86400000).toISOString();
  await bind(f, old, f.actor.now);
  const current = await official(later, "제2조");
  await bind(f, current, later);
  const actor = { ...f.actor, now: later };
  const reports = createReportsService(f.core, { ...f.deps, clock: () => later });
  const report = await reports.get(f.actor.ownerId, f.workspaceId);
  const row = await f.core
    .statement(
      "SELECT id,revision,workspace_id,snapshot_id,encrypted_payload FROM v2_reports WHERE id=?",
      [report.id],
    )
    .first<{
      id: string;
      revision: number;
      workspace_id: string;
      snapshot_id: string;
      encrypted_payload: string;
    }>();
  if (!row) throw new Error("Synthetic report missing");
  const digest = await sourceDigest(f.core, actor, f.workspaceId);
  const fence = await exportFence(f.core, actor, row, digest, () => later, undefined, [
    current.citation.id,
  ]);
  await fence.check();
  for (const id of [old.citation.id, "missing-citation"]) {
    await expect(
      exportFence(f.core, actor, row, digest, () => later, undefined, [id]),
    ).rejects.toThrow("LEGAL_SOURCE_UNAVAILABLE");
  }
  // Omitted canonical scope retains the conservative all-binding behavior.
  await expect(exportFence(f.core, actor, row, digest, () => later)).rejects.toThrow(
    "LEGAL_SOURCE_UNAVAILABLE",
  );
  f.db.sqlite
    .query("UPDATE v2_official_sources SET body=? WHERE source_id=?")
    .run("tampered body with unchanged hash", current.source.sourceId);
  await expect(fence.check()).rejects.toThrow("STALE_REVISION");
  f.db.sqlite
    .query("UPDATE v2_official_sources SET body=? WHERE source_id=?")
    .run(current.source.body, current.source.sourceId);
  await fence.check();
  f.db.sqlite
    .query("UPDATE v2_official_sources SET title=? WHERE source_id=?")
    .run("changed historical metadata", old.source.sourceId);
  await expect(fence.check()).rejects.toThrow("STALE_REVISION");
  f.db.sqlite
    .query("UPDATE v2_official_sources SET title=? WHERE source_id=?")
    .run(old.source.title, old.source.sourceId);
  await fence.check();
  f.db.sqlite
    .query(
      "UPDATE v2_citation_bindings SET citation_json=json_set(citation_json,'$._availability','limited') WHERE id=?",
    )
    .run(current.citation.id);
  await expect(fence.check()).rejects.toThrow("STALE_REVISION");
  f.db.sqlite
    .query(
      "UPDATE v2_citation_bindings SET citation_json=json_set(citation_json,'$._availability','verified') WHERE id=?",
    )
    .run(current.citation.id);
  await fence.check();
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
  await expect(fence.check()).rejects.toThrow("STALE_REVISION");
  f.db.close();
});

test("canonical report citation scope cannot omit a fact, timeline or action reference", async () => {
  const f = await reportFixture();
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const body = (await createV2ReportsRepository(f.core).read(f.actor, report.id))?.body;
  if (!body) throw new Error("Synthetic canonical body missing");
  const fact = {
    id: "fact-reference",
    text: "합성 사실",
    attribution: "official_source",
    certainty: "observed",
    significance: "neutral",
    references: [{ kind: "official_source", citationId: "required-citation" }],
    conflictingFactIds: [],
    userEdited: false,
  };
  expect(v2ReportBodySchema().safeParse({ ...body, facts: [fact] }).success).toBe(false);
  const source = await official(f.actor.now);
  const valid = {
    ...body,
    facts: [{ ...fact, references: [{ kind: "official_source", citationId: source.citation.id }] }],
    citations: [source.citation],
    legalSourceStatus: "verified",
  };
  expect(v2ReportBodySchema().safeParse(valid).success).toBe(true);
  expect(v2ReportBodySchema().safeParse({ ...valid, citations: [] }).success).toBe(false);
  const references = [{ kind: "official_source", citationId: source.citation.id }];
  const timeline = {
    id: "timeline-reference",
    revision: 1,
    date: null,
    datePrecision: "unknown",
    event: "합성 사건",
    certainty: "uncertain",
    factIds: [],
    references,
    userEdited: false,
  };
  const action = {
    id: "action-reference",
    revision: 1,
    kind: "official_guide_check",
    title: "합성 확인",
    instructions: "공식 원문을 확인합니다.",
    caution: "합성 검증 자료입니다.",
    status: "todo",
    factIds: [],
    references,
  };
  for (const referenced of [{ timeline: [timeline] }, { actions: [action] }]) {
    const value = {
      ...body,
      ...referenced,
      citations: [source.citation],
      legalSourceStatus: "verified",
    };
    expect(v2ReportBodySchema().safeParse(value).success).toBe(true);
    expect(v2ReportBodySchema().safeParse({ ...value, citations: [] }).success).toBe(false);
  }
  f.db.close();
});

for (const initiallyOversized of [false, true])
  test(`unused invalid source repairs are fenced, initially oversized ${initiallyOversized}`, async () => {
    const f = await reportFixture(),
      chunk = await official(f.actor.now);
    await bind(f, chunk, f.actor.now);
    const invalid = initiallyOversized ? "x".repeat(1048577) : "invalid synthetic source body";
    f.db.sqlite
      .query("UPDATE v2_official_sources SET body=? WHERE source_id=?")
      .run(invalid, chunk.source.sourceId);
    const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
    const row = await f.core
      .statement(
        "SELECT id,revision,workspace_id,snapshot_id,encrypted_payload FROM v2_reports WHERE id=?",
        [report.id],
      )
      .first<{
        id: string;
        revision: number;
        workspace_id: string;
        snapshot_id: string;
        encrypted_payload: string;
      }>();
    if (!row) throw new Error("Synthetic report missing");
    const digest = await sourceDigest(f.core, f.actor, f.workspaceId);
    const fence = await exportFence(f.core, f.actor, row, digest, () => f.actor.now, undefined, []);
    await fence.check();
    f.db.sqlite
      .query("UPDATE v2_official_sources SET body=? WHERE source_id=?")
      .run(chunk.source.body, chunk.source.sourceId);
    expect(await sourceDigest(f.core, f.actor, f.workspaceId)).not.toBe(digest);
    await expect(fence.check()).rejects.toThrow("STALE_REVISION");
    f.db.sqlite
      .query("UPDATE v2_official_sources SET body=? WHERE source_id=?")
      .run(invalid, chunk.source.sourceId);
    await fence.check();
    if (!initiallyOversized) {
      f.db.sqlite
        .query("UPDATE v2_official_sources SET body=? WHERE source_id=?")
        .run("x".repeat(1048577), chunk.source.sourceId);
      await expect(fence.check()).rejects.toThrow("STALE_REVISION");
    }
    f.db.close();
  });

test("expired unused large bodies remain bounded null snapshots, with missing bindings and mid-capture repairs rejected", async () => {
  const f = await reportFixture(),
    chunk = await official(f.actor.now);
  await bind(f, chunk, f.actor.now);
  const later = new Date(Date.parse(f.actor.now) + 2 * 86400000).toISOString(),
    actor = { ...f.actor, now: later };
  f.db.sqlite
    .query("UPDATE v2_official_sources SET body=? WHERE source_id=?")
    .run("x".repeat(1048577), chunk.source.sourceId);
  const reports = createReportsService(f.core, { ...f.deps, clock: () => later }),
    report = await reports.get(actor.ownerId, f.workspaceId);
  const row = await f.core
    .statement(
      "SELECT id,revision,workspace_id,snapshot_id,encrypted_payload FROM v2_reports WHERE id=?",
      [report.id],
    )
    .first<{
      id: string;
      revision: number;
      workspace_id: string;
      snapshot_id: string;
      encrypted_payload: string;
    }>();
  if (!row) throw new Error("Synthetic report missing");
  let bound: unknown[] = [];
  const core = {
    ...f.core,
    statement: (sql: string, values: unknown[] = []) => {
      if (sql.startsWith("WITH source")) bound = values;
      return f.core.statement(sql, values);
    },
  };
  const digest = await sourceDigest(core, actor, f.workspaceId),
    fence = await exportFence(core, actor, row, digest, () => later, undefined, []);
  await fence.check();
  expect(bound.length).toBeLessThanOrEqual(100);
  expect(JSON.stringify(bound).length).toBeLessThan(10000);
  expect(JSON.stringify(bound)).not.toContain("x".repeat(100));
  f.db.sqlite.query("DELETE FROM v2_citation_bindings WHERE id=?").run(chunk.citation.id);
  await expect(fence.check()).rejects.toThrow("STALE_REVISION");
  f.db.close();
});

test("a repair between invalid classification and body capture cannot establish an inconsistent fence", async () => {
  const f = await reportFixture(),
    chunk = await official(f.actor.now);
  await bind(f, chunk, f.actor.now);
  f.db.sqlite
    .query("UPDATE v2_official_sources SET body=? WHERE source_id=?")
    .run("invalid", chunk.source.sourceId);
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const row = await f.core
    .statement(
      "SELECT id,revision,workspace_id,snapshot_id,encrypted_payload FROM v2_reports WHERE id=?",
      [report.id],
    )
    .first<{
      id: string;
      revision: number;
      workspace_id: string;
      snapshot_id: string;
      encrypted_payload: string;
    }>();
  if (!row) throw new Error("Synthetic report missing");
  const digest = await sourceDigest(f.core, f.actor, f.workspaceId);
  let repaired = false;
  const core = {
    ...f.core,
    statement: (sql: string, values: unknown[] = []) => {
      if (!repaired && sql.startsWith("SELECT b.id,CASE WHEN s.fetched_at")) {
        repaired = true;
        f.db.sqlite
          .query("UPDATE v2_official_sources SET body=? WHERE source_id=?")
          .run(chunk.source.body, chunk.source.sourceId);
      }
      return f.core.statement(sql, values);
    },
  };
  await expect(
    exportFence(core, f.actor, row, digest, () => f.actor.now, undefined, []),
  ).rejects.toThrow("STALE_REVISION");
  expect(repaired).toBe(true);
  f.db.close();
});

test("unused invalid body snapshots share the existing total byte and original-count bounds", async () => {
  for (const overCount of [false, true]) {
    const f = await reportFixture(),
      chunk = await official(f.actor.now);
    await bind(f, chunk, f.actor.now);
    const repo = createV2OfficialSourceRepository(f.core);
    if (overCount) {
      for (let index = 1; index < 51; index++) {
        expect(
          await repo.bindCitation(
            { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
            { ...chunk.citation, id: `unused-${index}` },
          ),
        ).toBe(true);
      }
    }
    f.db.sqlite
      .query("UPDATE v2_official_sources SET body=? WHERE source_id=?")
      .run(overCount ? "invalid" : "x".repeat(1048576), chunk.source.sourceId);
    const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
    const row = await f.core
      .statement(
        "SELECT id,revision,workspace_id,snapshot_id,encrypted_payload FROM v2_reports WHERE id=?",
        [report.id],
      )
      .first<{
        id: string;
        revision: number;
        workspace_id: string;
        snapshot_id: string;
        encrypted_payload: string;
      }>();
    if (!row) throw new Error("Synthetic report missing");
    await expect(
      exportFence(
        f.core,
        f.actor,
        row,
        await sourceDigest(f.core, f.actor, f.workspaceId),
        () => f.actor.now,
        undefined,
        [],
      ),
    ).rejects.toThrow("EXPORT_LIMIT_EXCEEDED");
    f.db.close();
  }
});
