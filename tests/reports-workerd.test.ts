import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { Hono } from "hono";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createReportsApi } from "../src/server/api/v2/reports";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2OfficialSourceRepository } from "../src/server/db/v2-official-sources";
import { createFilesService } from "../src/server/modules/files/service";
import { OFFICIAL_CATALOG } from "../src/server/modules/legal-retrieval/v2/registry";
import { makeChunk } from "../src/server/modules/legal-retrieval/v2/source";
import { exportFence } from "../src/server/modules/reports/fence";
import { createReportsService } from "../src/server/modules/reports/service";
import {
  REPORT_SOURCE_SQL,
  reportSourceDigest,
  reportSourceRows,
  sourceDigest,
} from "../src/server/modules/reports/source";
import { signedSessionCookie, testEnvironment } from "./helpers/d1";
import { reportFixture } from "./helpers/report-fixture";

type Fixture = Awaited<ReturnType<typeof reportFixture>>;
type SourceRow = Awaited<ReturnType<typeof reportSourceRows>>[number];
const legacySql = await Bun.file("tests/fixtures/reports/source-before-d1-limits.sql").text();
const args = (id: string, now: string) => [id, id, id, id, id, id, id, now, now, now, id];

function officialChunk(now: string, body = "합성 공식 원문") {
  return makeChunk(
    {
      sourceType: "statute",
      officialId: "1706",
      version: "284415",
      section: "제1조",
      canonicalUrl: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=284415",
      title: "합성 공식 출처",
      body,
      sourceDate: "2026-10-01",
      fetchedAt: now,
      verifiedAt: now,
      rightsProvenance: OFFICIAL_CATALOG[0].rights,
      court: null,
      caseNumber: null,
      institutionId: null,
      endpointId: null,
    },
    now.slice(0, 10),
  );
}

async function nativeFixture(
  f: Fixture,
  run: (core: ReturnType<typeof createV2Core>) => Promise<void>,
) {
  // Real pinned workerd D1, not bun:sqlite's more permissive compound SELECT limit.
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("local report test"); } }',
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
      cf: false,
      unsafeRegisterWorker: false,
    }),
  );
  try {
    const db = (await mf.getD1Database("DB")) as unknown as D1Database;
    for (const name of (await readdir("drizzle")).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
      const sql = (await Bun.file(`drizzle/${name}`).text())
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      await db.batch(sql.map((s) => db.prepare(s)));
    }
    // Transfer only this synthetic fixture, with FK enforcement at batch commit.
    const inserts = [db.prepare("PRAGMA defer_foreign_keys=ON")];
    for (const table of [
      "user",
      "session",
      "user_consents",
      "v2_workspaces",
      "v2_billing_principals",
      "v2_case_original_usage",
      "v2_private_snapshots",
      "v2_private_parts",
      "v2_summaries",
      "v2_intakes",
      "v2_operations",
      "v2_facts",
      "v2_parties",
      "v2_files",
      "v2_messages",
      "v2_actions",
      "v2_timeline",
      "v2_official_sources",
      "v2_citation_bindings",
    ]) {
      for (const row of f.db.sqlite.query(`SELECT * FROM ${table}`).all() as Record<
        string,
        unknown
      >[]) {
        inserts.push(
          db
            .prepare(
              `INSERT INTO ${table}(${Object.keys(row).join(",")}) VALUES(${Object.keys(row)
                .map(() => "?")
                .join(",")})`,
            )
            .bind(...Object.values(row)),
        );
      }
    }
    await db.batch(inserts);
    await db
      .prepare("INSERT INTO app_metadata(key,value,updated_at) VALUES(?,'customer',?)")
      .bind(`account-type:${f.actor.ownerId}`, f.actor.now)
      .run();
    await run(createV2Core(db, f.core.cipher));
  } finally {
    await mf.dispose();
  }
}

test("workerd D1 admits a first signed report with no files and fences source/session changes", async () => {
  const f = await reportFixture();
  f.db.sqlite
    .query("UPDATE session SET created_at=?,expires_at=? WHERE user_id=?")
    .run(Date.now(), Date.now() + 3600000, f.actor.ownerId);
  await nativeFixture(f, async (core) => {
    // The old query failed at prepare time even when there were no citations.
    await expect(core.statement(legacySql, args(f.workspaceId, f.actor.now)).all()).rejects.toThrow(
      "too many terms in compound SELECT",
    );
    expect((await reportSourceRows(core, f.actor, f.workspaceId)).map((r) => r.kind)).toEqual([
      "summary",
    ]);
    const env = {
      ...testEnvironment(core.binding),
      APP_ENV: "preview",
      CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
    } as Env;
    const session = await core
      .statement("SELECT id,token FROM session WHERE user_id=?", [f.actor.ownerId])
      .first<{ id: string; token: string }>();
    if (!session) throw new Error("Synthetic session missing");
    const app = new Hono().route(
      "/api/v2",
      createReportsApi({
        dependencies: async (_, c) => ({ ...f.deps, files: createFilesService(c, f.deps) }),
      }),
    );
    const response = await app.request(
      `/api/v2/cases/${f.workspaceId}/reports`,
      {
        headers: { cookie: await signedSessionCookie(session.token, env.BETTER_AUTH_SECRET) },
      },
      env,
    );
    expect(response.status).toBe(200);
    const view = (await response.json()) as { id: string; stale: boolean; content: string };
    expect(view.stale).toBe(false);
    expect(view.content).toContain("합성 리포트 사건 요약");
    const row = await core
      .statement(
        "SELECT id,revision,workspace_id,snapshot_id,encrypted_payload FROM v2_reports WHERE id=?",
        [view.id],
      )
      .first<{
        id: string;
        revision: number;
        workspace_id: string;
        snapshot_id: string;
        encrypted_payload: string;
      }>();
    if (!row) throw new Error("Synthetic report missing");
    const fence = await exportFence(
      core,
      f.actor,
      row,
      await sourceDigest(core, f.actor, f.workspaceId),
      () => f.actor.now,
      session.id,
    );
    // Executes the actual WITH source AS (...) consumer, not a stand-alone approximation.
    await fence.check();
    await core
      .statement(
        "INSERT INTO v2_facts(id,entity_id,workspace_id,summary_revision,encrypted_payload) VALUES('new-fact','new-fact',?,1,'synthetic')",
        [f.workspaceId],
      )
      .run();
    await expect(fence.check()).rejects.toThrow("STALE_REVISION");
    await core.statement("DELETE FROM v2_facts WHERE id='new-fact'").run();
    await fence.check();
    await core.statement("DELETE FROM session WHERE id=?", [session.id]).run();
    await expect(fence.check()).rejects.toThrow("STALE_REVISION");
  });
}, 30000);

test("workerd export fence accepts a verified citation and rejects original, identity, availability and expiry drift", async () => {
  const f = await reportFixture(),
    repo = createV2OfficialSourceRepository(f.core);
  const chunk = await officialChunk(f.actor.now);
  expect(await repo.put(chunk.source, chunk.citation)).toBe(true);
  expect(
    await repo.bindCitation(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      chunk.citation,
    ),
  ).toBe(true);
  await nativeFixture(f, async (core) => {
    const view = await createReportsService(core, f.deps).get(f.actor.ownerId, f.workspaceId);
    const row = await core
      .statement(
        "SELECT id,revision,workspace_id,snapshot_id,encrypted_payload FROM v2_reports WHERE id=?",
        [view.id],
      )
      .first<{
        id: string;
        revision: number;
        workspace_id: string;
        snapshot_id: string;
        encrypted_payload: string;
      }>();
    if (!row) throw new Error("Synthetic report missing");
    let now = f.actor.now;
    const fence = await exportFence(
      core,
      f.actor,
      row,
      await sourceDigest(core, f.actor, f.workspaceId),
      () => now,
    );
    await fence.check();
    for (const [column, altered, original] of [
      ["body", "원문만 변조, hash는 그대로", chunk.source.body],
      ["version", "999999", chunk.source.version],
      ["rights_provenance", "unverified", chunk.source.rightsProvenance],
    ]) {
      await core
        .statement(`UPDATE v2_official_sources SET ${column}=? WHERE source_id=?`, [
          altered,
          chunk.source.sourceId,
        ])
        .run();
      await expect(fence.check()).rejects.toThrow("STALE_REVISION");
      await core
        .statement(`UPDATE v2_official_sources SET ${column}=? WHERE source_id=?`, [
          original,
          chunk.source.sourceId,
        ])
        .run();
      await fence.check();
    }
    await core
      .statement(
        "UPDATE v2_citation_bindings SET citation_json=json_set(citation_json,'$._availability','limited') WHERE id=?",
        [chunk.citation.id],
      )
      .run();
    await expect(fence.check()).rejects.toThrow("STALE_REVISION");
    await core
      .statement(
        "UPDATE v2_citation_bindings SET citation_json=json_set(citation_json,'$._availability','verified') WHERE id=?",
        [chunk.citation.id],
      )
      .run();
    await fence.check();
    now = chunk.source.expiresAt;
    await expect(fence.check()).rejects.toThrow("STALE_REVISION");
  });
}, 30000);

test("workerd citation fence allows 50 bound originals and rejects count or serialized byte overflow", async () => {
  const f = await reportFixture(),
    repo = createV2OfficialSourceRepository(f.core);
  const chunk = await officialChunk(f.actor.now);
  expect(await repo.put(chunk.source, chunk.citation)).toBe(true);
  for (let i = 0; i < 50; i++) {
    expect(
      await repo.bindCitation(
        { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
        { ...chunk.citation, id: `citation_${i}` },
      ),
    ).toBe(true);
  }
  await nativeFixture(f, async (core) => {
    const view = await createReportsService(core, f.deps).get(f.actor.ownerId, f.workspaceId);
    const row = await core
      .statement(
        "SELECT id,revision,workspace_id,snapshot_id,encrypted_payload FROM v2_reports WHERE id=?",
        [view.id],
      )
      .first<{
        id: string;
        revision: number;
        workspace_id: string;
        snapshot_id: string;
        encrypted_payload: string;
      }>();
    if (!row) throw new Error("Synthetic report missing");
    const digest = await sourceDigest(core, f.actor, f.workspaceId);
    const fence = await exportFence(core, f.actor, row, digest, () => f.actor.now);
    await fence.check();
    await core
      .statement(
        "INSERT INTO v2_citation_bindings SELECT 'citation_50',workspace_id,source_id,snapshot_revision,json_set(citation_json,'$.id','citation_50') FROM v2_citation_bindings WHERE id='citation_0'",
      )
      .run();
    await expect(exportFence(core, f.actor, row, digest, () => f.actor.now)).rejects.toThrow(
      "EXPORT_LIMIT_EXCEEDED",
    );
    await core.statement("DELETE FROM v2_citation_bindings").run();
    // Original text fits the legal source limit, but JSON escaping exceeds the fence envelope.
    const large = await officialChunk(f.actor.now, `합성${"\u0001".repeat(180000)}`);
    const nativeRepo = createV2OfficialSourceRepository(core);
    expect(await nativeRepo.put(large.source, large.citation)).toBe(true);
    const revision = await core
      .statement("SELECT revision FROM v2_workspaces WHERE id=?", [f.workspaceId])
      .first<number>("revision");
    expect(
      await nativeRepo.bindCitation(
        { ...f.actor, workspaceId: f.workspaceId, expectedRevision: revision ?? 0 },
        large.citation,
      ),
    ).toBe(true);
    await expect(exportFence(core, f.actor, row, digest, () => f.actor.now)).rejects.toThrow(
      "EXPORT_LIMIT_EXCEEDED",
    );
  });
}, 30000);

test("workerd source rows preserve legacy bytes, digest and binary citation ordering with nulls and escaping", async () => {
  const f = await reportFixture(),
    id = f.workspaceId,
    now = f.actor.now;
  for (const table of ["v2_facts", "v2_parties"]) {
    f.db.sqlite
      .query(
        `INSERT INTO ${table}(id,entity_id,workspace_id,summary_revision,encrypted_payload) VALUES(?,?,?,1,?)`,
      )
      .run(table, table, id, 'synthetic "한글"\\\n');
  }
  f.db.sqlite
    .query(
      "INSERT INTO v2_operations(id,owner_id,workspace_id,kind,created_at) VALUES('source-op',?,?,'chat',?)",
    )
    .run(f.actor.ownerId, id, now);
  f.db.sqlite
    .query(
      "INSERT INTO v2_messages(id,workspace_id,workspace_revision,operation_id,role,encrypted_payload,created_at) VALUES('source-message',?,1,'source-op','user','synthetic',?)",
    )
    .run(id, now);
  f.db.sqlite
    .query(
      "INSERT INTO v2_files(id,workspace_id,operation_id,state,declared_bytes,encrypted_payload,created_at,updated_at) VALUES('source-file',?,'source-op','reserved',1,'synthetic',?,?)",
    )
    .run(id, now, now);
  f.db.sqlite
    .query(
      "INSERT INTO v2_actions(id,entity_id,workspace_id,kind,status,encrypted_payload) VALUES('source-action','source-action',?,'fact_check','todo','synthetic')",
    )
    .run(id);
  f.db.sqlite
    .query(
      "INSERT INTO v2_timeline(id,entity_id,workspace_id,encrypted_payload) VALUES('source-timeline','source-timeline',?,'synthetic')",
    )
    .run(id);
  const repo = createV2OfficialSourceRepository(f.core);
  for (const citationId of ["citation_z", "citation_A"]) {
    const chunk = await makeChunk(
      {
        sourceType: "statute",
        officialId: "1706",
        version: "284415",
        section: "제1조",
        canonicalUrl: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=284415",
        title: '합성 "인용" \\ 줄바꿈\n검증',
        body: `합성 공식 원문 ${citationId}`,
        sourceDate: "2026-10-01",
        fetchedAt: now,
        verifiedAt: now,
        rightsProvenance: OFFICIAL_CATALOG[0].rights,
        court: null,
        caseNumber: null,
        institutionId: null,
        endpointId: null,
      },
      now.slice(0, 10),
    );
    const citation = { ...chunk.citation, id: citationId };
    expect(await repo.put(chunk.source, citation)).toBe(true);
    expect(
      await repo.bindCitation({ ...f.actor, workspaceId: id, expectedRevision: f.rev() }, citation),
    ).toBe(true);
  }
  await nativeFixture(f, async (core) => {
    for (const date of [now, "2027-10-06T00:00:00.000Z"]) {
      const expected = f.db.sqlite.query(legacySql).all(...args(id, date)) as SourceRow[];
      const actual = (await core.statement(REPORT_SOURCE_SQL, args(id, date)).all<SourceRow>())
        .results;
      expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
      expect([...new Set(actual.map((r) => r.kind))]).toEqual([
        "action",
        "citation",
        "fact",
        "file",
        "message",
        "party",
        "summary",
        "timeline",
      ]);
      expect(actual.filter((r) => r.kind === "citation").map((r) => r.id)).toEqual([
        "citation_A",
        "citation_z",
      ]);
      expect(actual.find((r) => r.kind === "citation")?.snapshot).toContain('"court":null');
      const verified = expected.map((r) => ({
        ...r,
        snapshot:
          r.snapshot + (r.kind === "citation" ? (date === now ? ":verified" : ":invalid") : ""),
      }));
      const rows = await reportSourceRows(core, { ...f.actor, now: date }, id);
      expect(JSON.stringify(rows)).toBe(JSON.stringify(verified));
      expect(await reportSourceDigest(1, "active", rows)).toBe(
        await reportSourceDigest(1, "active", verified),
      );
    }
  });
}, 30000);
