import { expect, spyOn, test } from "bun:test";
import type { V2AssistantMessage } from "../src/contracts/v2";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2OfficialSourceRepository } from "../src/server/db/v2-official-sources";
import {
  createV2WorkspaceRepository,
  referenceCommitPredicate,
} from "../src/server/db/v2-workspace";
import { createV2WorkspaceResponseRepository } from "../src/server/db/v2-workspace-response";
import { capturePublicationSourceAuthority } from "../src/server/modules/legal-retrieval/v2/publication-authority";
import { OFFICIAL_CATALOG } from "../src/server/modules/legal-retrieval/v2/registry";
import { makeChunk } from "../src/server/modules/legal-retrieval/v2/source";
import { reportFixture } from "./helpers/report-fixture";

function official(now: string) {
  return makeChunk(
    {
      sourceType: "statute",
      officialId: "1706",
      version: "284415",
      section: "제1조",
      canonicalUrl: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=284415",
      title: "합성 공식 출처",
      body: "합성 원문 😀: 실제 법률을 설명하지 않습니다.",
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
async function fixture(renew = false, nearExpiry = false) {
  const f = await reportFixture(),
    sources = createV2OfficialSourceRepository(f.core);
  const original = await official(f.actor.now);
  const guard = () => ({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() });
  expect(await sources.put(original.source, original.citation)).toBe(true);
  expect(await sources.bindCitation(guard(), original.citation)).toBe(true);
  if (renew) {
    f.actor.now = new Date(Date.parse(f.actor.now) + 25 * 3600000).toISOString();
    const refreshed = await makeChunk(
      { ...original.source, fetchedAt: f.actor.now, verifiedAt: f.actor.now },
      f.actor.now.slice(0, 10),
    );
    expect(await sources.put(refreshed.source, refreshed.citation)).toBe(true);
    expect(await sources.bindCitation(guard(), refreshed.citation)).toBe(true);
  }
  if (nearExpiry) f.actor.now = new Date(Date.parse(original.source.expiresAt) - 100).toISOString();
  const jobs = createV2JobsRepository(f.core),
    jobId = crypto.randomUUID(),
    operationId = crypto.randomUUID();
  expect(
    await jobs.admitWorkspace(
      guard(),
      { operationId, key: crypto.randomUUID(), requestHash: "d".repeat(64) },
      jobId,
      "chat_response",
      {
        id: crypto.randomUUID(),
        request: {
          text: "합성 원문을 확인합니다.",
          selectedFileIds: [],
          expectedRevision: f.rev(),
        },
      },
    ),
  ).toBe(true);
  const acquired = await jobs.acquire(
    f.actor,
    jobId,
    crypto.randomUUID(),
    new Date(Date.parse(f.actor.now) + 240000).toISOString(),
  );
  if (!acquired) throw new Error("Missing synthetic lease");
  const references = [{ kind: "official_source" as const, citationId: original.citation.id }];
  const message: V2AssistantMessage = {
    schemaVersion: "2",
    id: crypto.randomUUID(),
    operationId,
    workspaceRevision: f.rev(),
    createdAt: f.actor.now,
    role: "assistant",
    safety: "validated",
    text: original.source.body,
    references,
    citations: [original.citation],
    warnings: [],
  };
  return {
    ...f,
    sources,
    original,
    guard,
    jobs,
    jobId,
    lease: acquired.lease,
    input: { message, facts: [], parties: [], actions: [], timeline: [] },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function commitAfter(f: Fixture, mutate?: () => Promise<void> | void) {
  return createV2WorkspaceResponseRepository({
    ...f.core,
    encrypt: async (...args: Parameters<typeof f.core.encrypt>) => {
      const result = await f.core.encrypt(...args);
      if (args[0] === "v2_messages") await mutate?.();
      return result;
    },
  }).commit(f.guard(), f.lease, f.input);
}
async function unpublished(f: Fixture, revision: number) {
  expect(
    (
      await createV2WorkspaceRepository(f.core.binding, f.core.cipher).messages(
        f.actor,
        f.workspaceId,
      )
    ).filter((m) => m.role === "assistant"),
  ).toHaveLength(0);
  expect(await f.jobs.find(f.actor, f.jobId)).toMatchObject({ status: "running" });
  expect(f.rev()).toBe(revision);
}

test("new chat publication accepts authentic same-content renewal and preserves the original binding", async () => {
  const f = await fixture(true);
  const saved = f.db.sqlite
    .query("SELECT citation_json FROM v2_citation_bindings WHERE id=?")
    .get(f.original.citation.id);
  expect(await commitAfter(f)).toBe(true);
  expect(await f.jobs.find(f.actor, f.jobId)).toMatchObject({ status: "completed" });
  const messages = await createV2WorkspaceRepository(f.core.binding, f.core.cipher).messages(
    f.actor,
    f.workspaceId,
  );
  expect(messages.find((m) => m.role === "assistant")).toMatchObject({
    citations: [f.original.citation],
  });
  expect(
    f.db.sqlite
      .query("SELECT citation_json FROM v2_citation_bindings WHERE id=?")
      .get(f.original.citation.id),
  ).toEqual(saved);
});

for (const timing of ["before_capture", "after_hash"] as const) {
  test(`new conflicting original ${timing} blocks actual atomic publication while the old availability predicate would accept`, async () => {
    const f = await fixture(true),
      revision = f.rev();
    const conflict = await makeChunk(
      {
        ...f.original.source,
        body: "변경된 합성 공식 원문",
        fetchedAt: f.actor.now,
        verifiedAt: f.actor.now,
      },
      f.actor.now.slice(0, 10),
    );
    const mutate = async () => {
      expect(await f.sources.put(conflict.source, conflict.citation)).toBe(true);
      const old = referenceCommitPredicate(f.input.message.references);
      expect(
        await f.core
          .statement(`SELECT 1 AS ok FROM v2_workspaces w WHERE w.id=? AND ${old.sql}`, [
            f.workspaceId,
            ...old.values,
          ])
          .first<{ ok: number }>(),
      ).toEqual({ ok: 1 });
    };
    if (timing === "before_capture") await mutate();
    expect(await commitAfter(f, timing === "after_hash" ? mutate : undefined)).toBe(false);
    await unpublished(f, revision);
  });
}

test("a different explicit law version does not invalidate atomic publication of the bound version", async () => {
  const f = await fixture(true);
  const other = await makeChunk(
    {
      ...f.original.source,
      version: "284416",
      canonicalUrl: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=284416",
      body: "다른 버전의 합성 원문",
      fetchedAt: f.actor.now,
      verifiedAt: f.actor.now,
    },
    f.actor.now.slice(0, 10),
  );
  expect(
    await commitAfter(f, async () => {
      expect(await f.sources.put(other.source, other.citation)).toBe(true);
    }),
  ).toBe(true);
});

for (const column of [
  "body",
  "content_hash",
  "title",
  "rights_provenance",
  "extractor_version",
  "canonical_url",
  "version",
  "section",
  "official_id",
  "expires_at",
] as const) {
  test(`atomic source proof rejects ${column} mutation after the hash without publishing`, async () => {
    const f = await fixture(),
      revision = f.rev();
    expect(
      await commitAfter(f, () => {
        f.db.sqlite
          .query(`UPDATE v2_official_sources SET ${column}=? WHERE source_id=?`)
          .run(
            column === "content_hash" ? "0".repeat(64) : "synthetic_changed_value",
            f.original.source.sourceId,
          );
      }),
    ).toBe(false);
    await unpublished(f, revision);
  });
}

for (const change of ["binding", "availability", "same_content_refresh", "deletion"] as const) {
  test(`atomic source proof rejects ${change} race after verification`, async () => {
    const f = await fixture(),
      revision = f.rev();
    expect(
      await commitAfter(f, async () => {
        if (change === "binding" || change === "availability") {
          const citation = { ...f.original.citation, _availability: "verified" };
          if (change === "binding") citation.verifiedAt = "2026-10-05T00:00:00.000Z";
          else citation._availability = "limited";
          f.db.sqlite
            .query("UPDATE v2_citation_bindings SET citation_json=? WHERE id=?")
            .run(JSON.stringify(citation), f.original.citation.id);
        } else if (change === "same_content_refresh") {
          const now = new Date(Date.parse(f.actor.now) + 1).toISOString();
          const refreshed = await makeChunk(
            { ...f.original.source, fetchedAt: now, verifiedAt: now },
            now.slice(0, 10),
          );
          expect(await f.sources.put(refreshed.source, refreshed.citation)).toBe(true);
        } else
          f.db.sqlite
            .query("DELETE FROM v2_citation_bindings WHERE id=?")
            .run(f.original.citation.id);
      }),
    ).toBe(false);
    await unpublished(f, revision);
  });
}

for (const elapsedMs of [99, 101]) {
  test(`publication clock preserves fresh sources and rejects expiration during encryption (${elapsedMs}ms)`, async () => {
    const f = await fixture(false, true),
      revision = f.rev();
    // Genuine source freshness is almost 24h old before admission. Its job lease
    // remains fresh throughout; only elapsed source freshness differs here.
    let elapsed = 0;
    const clock = spyOn(performance, "now").mockImplementation(() => elapsed);
    try {
      expect(
        await commitAfter(f, () => {
          elapsed = elapsedMs;
        }),
      ).toBe(elapsedMs < 100);
      if (elapsedMs >= 100) await unpublished(f, revision);
      else expect(await f.jobs.find(f.actor, f.jobId)).toMatchObject({ status: "completed" });
    } finally {
      clock.mockRestore();
    }
  });
}

test("missing binding and modified caller citation cannot become publication authority", async () => {
  for (const foreign of [false, true]) {
    const f = await fixture(),
      revision = f.rev();
    if (foreign)
      f.db.sqlite.query("DELETE FROM v2_citation_bindings WHERE id=?").run(f.original.citation.id);
    else
      f.input.message.citations = [
        { ...f.original.citation, verifiedAt: "2026-10-05T00:00:00.000Z" },
      ];
    expect(await commitAfter(f)).toBe(false);
    await unpublished(f, revision);
  }
});

for (const bodies of [["\\".repeat(600000)], ["a".repeat(600000), "b".repeat(600000)]]) {
  test(`publication proof stops at the serialized physical bound (${bodies.length} originals)`, async () => {
    const f = await fixture(),
      chunks = [];
    for (const [index, body] of bodies.entries()) {
      const chunk = await makeChunk(
        { ...f.original.source, body, section: `합성 ${index}` },
        f.actor.now.slice(0, 10),
      );
      expect(await f.sources.put(chunk.source, chunk.citation)).toBe(true);
      expect(await f.sources.bindCitation(f.guard(), chunk.citation)).toBe(true);
      chunks.push(chunk);
    }
    expect(
      await capturePublicationSourceAuthority(
        f.core,
        f.guard(),
        chunks.map((c) => ({ kind: "official_source", citationId: c.citation.id })),
        chunks.map((c) => c.citation),
        [],
      ),
    ).toBeNull();
  });
}
