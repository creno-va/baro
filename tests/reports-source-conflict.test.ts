import { expect, test } from "bun:test";
import { createV2OfficialSourceRepository } from "../src/server/db/v2-official-sources";
import { readBoundSource } from "../src/server/modules/legal-retrieval/v2/bound-sources";
import { OFFICIAL_CATALOG } from "../src/server/modules/legal-retrieval/v2/registry";
import { makeChunk } from "../src/server/modules/legal-retrieval/v2/source";
import { exportFence } from "../src/server/modules/reports/fence";
import { sourceDigest } from "../src/server/modules/reports/source";
import { reportFixture } from "./helpers/report-fixture";

async function fixture() {
  const f = await reportFixture();
  const source = await makeChunk(
    {
      sourceType: "statute",
      officialId: "1706",
      version: "284415",
      section: "제1조",
      canonicalUrl: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=284415",
      title: "합성 공식 원문",
      body: "합성 원문 · 실제 법률을 설명하지 않습니다.",
      sourceDate: "2026-10-01",
      fetchedAt: f.actor.now,
      verifiedAt: f.actor.now,
      rightsProvenance: OFFICIAL_CATALOG[0].rights,
      institutionId: null,
      endpointId: null,
      court: null,
      caseNumber: null,
    },
    f.actor.now.slice(0, 10),
  );
  const repo = createV2OfficialSourceRepository(f.core);
  expect(await repo.put(source.source, source.citation)).toBe(true);
  expect(
    await repo.bindCitation(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      source.citation,
    ),
  ).toBe(true);
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
  return { ...f, source, repo, row };
}

// Execute the actual final SQL predicate, not a mocked source validator. A new
// source in the global cache does not change the bound row, report or workspace.
for (const sameTime of [false, true])
  test(`final export fence rejects a conflicting original inserted after validation, equal time ${sameTime}`, async () => {
    const f = await fixture();
    try {
      const originalBinding = f.db.sqlite
        .query("SELECT * FROM v2_citation_bindings WHERE id=?")
        .get(f.source.citation.id);
      // Genuine same-content re-observation after the old receipt expires.
      f.actor.now = new Date(Date.parse(f.actor.now) + 25 * 3600000).toISOString();
      const renewed = await makeChunk(
        { ...f.source.source, fetchedAt: f.actor.now, verifiedAt: f.actor.now },
        f.actor.now.slice(0, 10),
      );
      expect(await f.repo.put(renewed.source, renewed.citation)).toBe(true);
      expect(
        await readBoundSource(f.core, f.workspaceId, f.source.citation.id, f.actor.now),
      ).not.toBeNull();
      const originalDigest = await sourceDigest(f.core, f.actor, f.workspaceId);
      const fence = await exportFence(
        f.core,
        f.actor,
        f.row,
        originalDigest,
        () => f.actor.now,
        undefined,
        [f.source.citation.id],
      );
      await fence.check();
      const conflictTime = sameTime
        ? f.actor.now
        : new Date(Date.parse(f.actor.now) + 1000).toISOString();
      const conflict = await makeChunk(
        {
          ...renewed.source,
          body: "합성 원문의 다른 본문 · 자동 재연결하면 안 됩니다.",
          fetchedAt: conflictTime,
          verifiedAt: conflictTime,
        },
        conflictTime.slice(0, 10),
      );
      expect(await f.repo.put(conflict.source, conflict.citation)).toBe(true);
      f.actor.now = conflictTime;
      expect(await sourceDigest(f.core, f.actor, f.workspaceId)).not.toBe(originalDigest);
      expect(
        await readBoundSource(f.core, f.workspaceId, f.source.citation.id, f.actor.now),
      ).toBeNull();
      await expect(fence.check()).rejects.toThrow("STALE_REVISION");
      expect(
        f.db.sqlite
          .query("SELECT * FROM v2_citation_bindings WHERE id=?")
          .get(f.source.citation.id),
      ).toEqual(originalBinding);

      // An unused invalid citation remains in the full report digest. Removing
      // its competitor makes it valid again and must invalidate that capture.
      const invalidDigest = await sourceDigest(f.core, f.actor, f.workspaceId);
      const invalidFence = await exportFence(
        f.core,
        f.actor,
        f.row,
        invalidDigest,
        () => f.actor.now,
        undefined,
        [],
      );
      await invalidFence.check();
      f.db.sqlite
        .query("DELETE FROM v2_official_sources WHERE source_id=?")
        .run(conflict.source.sourceId);
      expect(await sourceDigest(f.core, f.actor, f.workspaceId)).toBe(originalDigest);
      await expect(invalidFence.check()).rejects.toThrow("STALE_REVISION");
      await fence.check();
    } finally {
      f.db.close();
    }
  });

test("a newer different public version does not supersede a deliberately historical report citation", async () => {
  const f = await fixture();
  try {
    const digest = await sourceDigest(f.core, f.actor, f.workspaceId);
    const fence = await exportFence(f.core, f.actor, f.row, digest, () => f.actor.now, undefined, [
      f.source.citation.id,
    ]);
    const later = new Date(Date.parse(f.actor.now) + 1000).toISOString();
    const next = await makeChunk(
      {
        ...f.source.source,
        version: "284416",
        canonicalUrl: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=284416",
        body: "합성 다음 버전 원문",
        fetchedAt: later,
        verifiedAt: later,
      },
      later.slice(0, 10),
    );
    expect(await f.repo.put(next.source, next.citation)).toBe(true);
    f.actor.now = later;
    expect(await sourceDigest(f.core, f.actor, f.workspaceId)).toBe(digest);
    await fence.check();
  } finally {
    f.db.close();
  }
});
