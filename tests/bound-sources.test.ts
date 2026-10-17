import { expect, test } from "bun:test";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2OfficialSourceRepository } from "../src/server/db/v2-official-sources";
import {
  readBoundSource,
  readBoundSourceBatch,
} from "../src/server/modules/legal-retrieval/v2/bound-sources";
import { OFFICIAL_CATALOG } from "../src/server/modules/legal-retrieval/v2/registry";
import { makeChunk } from "../src/server/modules/legal-retrieval/v2/source";
import { reportSourceRows, sourceDigest } from "../src/server/modules/reports/source";
import { countD1Calls } from "./helpers/d1-call-count";
import { reportFixture } from "./helpers/report-fixture";

async function fixture(count = 2, body = "합성 공식 원문") {
  const f = await reportFixture();
  const repo = createV2OfficialSourceRepository(f.core);
  const chunks = [];
  for (let index = 0; index < count; index++) {
    const chunk = await makeChunk(
      {
        sourceType: "statute",
        officialId: "1706",
        version: "284415",
        section: `제${index + 1}조`,
        canonicalUrl: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=284415",
        title: "합성 공식 출처",
        body,
        sourceDate: "2026-10-01",
        fetchedAt: f.actor.now,
        verifiedAt: f.actor.now,
        rightsProvenance: OFFICIAL_CATALOG[0].rights,
        court: null,
        caseNumber: null,
        institutionId: null,
        endpointId: null,
      },
      f.actor.now.slice(0, 10),
    );
    chunk.citation.id = `citation_${index}`;
    expect(await repo.put(chunk.source, chunk.citation)).toBe(true);
    expect(
      await repo.bindCitation(
        { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
        chunk.citation,
      ),
    ).toBe(true);
    chunks.push(chunk);
  }
  const meter = countD1Calls(f.core.binding);
  return { ...f, chunks, meter, measured: createV2Core(meter.binding, f.core.cipher) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function chunkAt(f: Fixture, index = 0) {
  const chunk = f.chunks[index];
  if (!chunk) throw new Error("Synthetic source missing");
  return chunk;
}
const read = (f: Fixture, ids = f.chunks.map((chunk) => chunk.citation.id)) =>
  readBoundSourceBatch(f.measured, f.workspaceId, ids, f.actor.now);
const sourceUpdate = (f: Fixture, column: string, value: string) =>
  f.db.sqlite
    .query(`UPDATE v2_official_sources SET ${column}=? WHERE source_id=?`)
    .run(value, chunkAt(f).source.sourceId);

// Fixed synthetic mutations only; no production data or legal provider requests.
const changes: Record<string, (f: Fixture) => void> = {
  body: (f) => sourceUpdate(f, "body", "합성 변조 원문"),
  version: (f) => sourceUpdate(f, "version", "284416"),
  section: (f) => sourceUpdate(f, "section", "제99조"),
  official_id: (f) => sourceUpdate(f, "official_id", "1707"),
  hash: (f) => sourceUpdate(f, "content_hash", "0".repeat(64)),
  extractor: (f) => sourceUpdate(f, "extractor_version", "synthetic_old"),
  rights: (f) => sourceUpdate(f, "rights_provenance", "synthetic_other"),
  url: (f) => sourceUpdate(f, "canonical_url", "https://example.invalid/synthetic"),
  expiry: (f) => sourceUpdate(f, "expires_at", "2026-10-06T23:00:00.000Z"),
  title: (f) => sourceUpdate(f, "title", "합성 다른 제목"),
  future_fetch: (f) => sourceUpdate(f, "fetched_at", "2026-10-06T01:00:00.000Z"),
  future_verify: (f) => sourceUpdate(f, "verified_at", "2026-10-06T01:00:00.000Z"),
  oversized: (f) => sourceUpdate(f, "body", "x".repeat(1048577)),
  availability: (f) => {
    f.db.sqlite
      .query(
        "UPDATE v2_citation_bindings SET citation_json=json_set(citation_json,'$._availability','limited') WHERE id=?",
      )
      .run(chunkAt(f).citation.id);
  },
  binding_json: (f) => {
    f.db.sqlite
      .query(
        "UPDATE v2_citation_bindings SET citation_json=json_set(citation_json,'$.id','other_id') WHERE id=?",
      )
      .run(chunkAt(f).citation.id);
  },
  binding_source: (f) => {
    f.db.sqlite
      .query("UPDATE v2_citation_bindings SET source_id=? WHERE id=?")
      .run(chunkAt(f, 1).source.sourceId, chunkAt(f).citation.id);
  },
  missing_binding: (f) => {
    f.db.sqlite.query("DELETE FROM v2_citation_bindings WHERE id=?").run(chunkAt(f).citation.id);
  },
};

test("bound source batch preserves input order, missing entries and exact original/span", async () => {
  const f = await fixture();
  const result = await read(f, ["citation_1", "missing_citation", "citation_0"]);
  expect(result).toEqual([chunkAt(f, 1), null, chunkAt(f)]);
  expect(f.meter.work).toEqual({ calls: 2, statements: 2 });
  expect(await readBoundSource(f.measured, f.workspaceId, "citation_0", f.actor.now)).toEqual(
    chunkAt(f),
  );
  expect(
    await readBoundSourceBatch(f.measured, "different_workspace", ["citation_0"], f.actor.now),
  ).toEqual([null]);
  expect(
    await readBoundSourceBatch(
      f.measured,
      f.workspaceId,
      ["citation_0"],
      chunkAt(f).source.expiresAt,
    ),
  ).toEqual([null]);
  f.meter.reset();
  expect(
    await readBoundSourceBatch(f.measured, f.workspaceId, ["citation_0"], "invalid-time"),
  ).toEqual([null]);
  expect(f.meter.work).toEqual({ calls: 0, statements: 0 });
});

test.each(Object.entries(changes))(
  "bound source rejects %s before reading and again across hash verification",
  async (_name, mutate) => {
    for (const race of [false, true]) {
      const f = await fixture();
      let reads = 0;
      if (race) {
        f.meter.before(() => {
          if (++reads === 2) mutate(f);
        });
      } else mutate(f);
      const result = await read(f);
      expect(result[0]).toBeNull();
      expect(result[1]).toEqual(chunkAt(f, 1));
      expect(f.meter.work).toEqual({ calls: 2, statements: 2 });
      if (race) expect(reads).toBe(2);
    }
  },
);

test.each([1, 2])(
  "bound source does not release any original when read %i fails",
  async (failedRead) => {
    const f = await fixture();
    let reads = 0;
    f.meter.before(() => {
      if (++reads === failedRead) throw new Error("Synthetic read failure");
    });
    expect(await read(f)).toEqual([null, null]);
  },
);

test("bound source batch caps four 1 MiB rows and refuses oversized input without IO", async () => {
  const f = await fixture(4, "x".repeat(1048576));
  const result = await read(f);
  expect(result).toEqual(f.chunks);
  expect(f.meter.work).toEqual({ calls: 2, statements: 2 });
  f.meter.reset();
  expect(
    await read(f, ["citation_0", "citation_1", "citation_2", "citation_3", "citation_4"]),
  ).toEqual([null, null, null, null, null]);
  expect(await read(f, [])).toEqual([]);
  expect(f.meter.work).toEqual({ calls: 0, statements: 0 });
});

test("report source digest revalidates all 50 originals on every invocation without caching", async () => {
  const f = await fixture(50);
  const original = await sourceDigest(f.measured, f.actor, f.workspaceId);
  expect(f.meter.work).toEqual({ calls: 28, statements: 28 });
  sourceUpdate(f, "body", "합성 변조 원문");
  f.meter.reset();
  expect(await sourceDigest(f.measured, f.actor, f.workspaceId)).not.toBe(original);
  expect(f.meter.work).toEqual({ calls: 28, statements: 28 });
  sourceUpdate(f, "body", chunkAt(f).source.body);
  expect(await sourceDigest(f.measured, f.actor, f.workspaceId)).toBe(original);
  const originals: [string, string][] = [];
  const rows = await reportSourceRows(f.measured, f.actor, f.workspaceId, (id, body) =>
    originals.push([id, body]),
  );
  expect(originals).toEqual(
    rows.filter((row) => row.kind === "citation").map((row) => [row.id, "합성 공식 원문"]),
  );
  expect(originals).toHaveLength(50);
});

test("real identical-source refresh renews old bindings without rewriting their receipts", async () => {
  const f = await fixture(1);
  try {
    const original = chunkAt(f);
    const repo = createV2OfficialSourceRepository(f.core);
    const binding = () =>
      f.db.sqlite.query("SELECT * FROM v2_citation_bindings WHERE id=?").get(original.citation.id);
    const saved = binding();
    f.actor.now = new Date(Date.parse(f.actor.now) + 25 * 3600000).toISOString();
    expect(await read(f)).toEqual([null]);
    const refreshed = await makeChunk(
      { ...original.source, fetchedAt: f.actor.now, verifiedAt: f.actor.now },
      f.actor.now.slice(0, 10),
    );
    expect(await repo.put(refreshed.source, refreshed.citation)).toBe(true);
    const guard = { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() };
    expect(await repo.bindCitation(guard, refreshed.citation)).toBe(true);
    // New binding authority still requires the exact actual verification time.
    expect(
      await repo.bindCitation(guard, {
        ...refreshed.citation,
        id: "forged_earlier",
        verifiedAt: original.citation.verifiedAt,
      }),
    ).toBe(false);
    const renewed = (await read(f))[0];
    expect(renewed?.citation).toEqual(original.citation);
    expect(renewed?.source).toEqual(refreshed.source);
    expect(renewed?.span).toEqual(original.span);
    expect(binding()).toEqual(saved);
    expect(
      await readBoundSource(f.core, "other_workspace", original.citation.id, f.actor.now),
    ).toBeNull();
    f.actor.now = refreshed.source.expiresAt;
    expect(await read(f)).toEqual([null]);
    expect(binding()).toEqual(saved);
  } finally {
    f.db.close();
  }
});

test.each([
  "body",
  "version",
  "section",
  "official_id",
  "hash",
  "extractor",
  "rights",
  "url",
  "title",
  "availability",
  "binding_json",
])("renewed source still rejects %s drift", async (kind) => {
  const f = await fixture(1);
  try {
    const original = chunkAt(f),
      repo = createV2OfficialSourceRepository(f.core);
    f.actor.now = new Date(Date.parse(f.actor.now) + 25 * 3600000).toISOString();
    const fresh = await makeChunk(
      { ...original.source, fetchedAt: f.actor.now, verifiedAt: f.actor.now },
      f.actor.now.slice(0, 10),
    );
    expect(await repo.put(fresh.source, fresh.citation)).toBe(true);
    changes[kind]?.(f);
    expect(await read(f)).toEqual([null]);
  } finally {
    f.db.close();
  }
});

test.each([false, true])(
  "newer conflicting content defeats renewal, including during hash verification (race=%s)",
  async (race) => {
    const f = await fixture(1);
    try {
      const original = chunkAt(f),
        repo = createV2OfficialSourceRepository(f.core);
      f.actor.now = new Date(Date.parse(f.actor.now) + 25 * 3600000).toISOString();
      const same = await makeChunk(
        { ...original.source, fetchedAt: f.actor.now, verifiedAt: f.actor.now },
        f.actor.now.slice(0, 10),
      );
      expect(await repo.put(same.source, same.citation)).toBe(true);
      expect((await read(f))[0]?.citation).toEqual(original.citation);
      f.actor.now = new Date(Date.parse(f.actor.now) + 1000).toISOString();
      const changed = await makeChunk(
        {
          ...same.source,
          body: "새로 확인한 다른 합성 원문",
          fetchedAt: f.actor.now,
          verifiedAt: f.actor.now,
        },
        f.actor.now.slice(0, 10),
      );
      expect(await repo.put(changed.source, changed.citation)).toBe(true);
      if (race) {
        const row = f.db.sqlite
          .query("SELECT * FROM v2_official_sources WHERE source_id=?")
          .get(changed.source.sourceId) as Record<string, string | null>;
        f.db.sqlite
          .query("DELETE FROM v2_official_sources WHERE source_id=?")
          .run(changed.source.sourceId);
        let reads = 0;
        f.meter.before(() => {
          if (++reads === 2)
            f.db.sqlite
              .query(
                "INSERT INTO v2_official_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
              )
              .run(...Object.values(row));
        });
      }
      expect(await read(f)).toEqual([null]);
    } finally {
      f.db.close();
    }
  },
);

test("a different law version does not replace an intentionally historical source", async () => {
  const f = await fixture(1);
  try {
    const original = chunkAt(f),
      repo = createV2OfficialSourceRepository(f.core);
    f.actor.now = new Date(Date.parse(f.actor.now) + 25 * 3600000).toISOString();
    const same = await makeChunk(
      { ...original.source, fetchedAt: f.actor.now, verifiedAt: f.actor.now },
      f.actor.now.slice(0, 10),
    );
    expect(await repo.put(same.source, same.citation)).toBe(true);
    const later = new Date(Date.parse(f.actor.now) + 1000).toISOString();
    const changed = await makeChunk(
      {
        ...same.source,
        version: "284416",
        canonicalUrl: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=284416",
        body: "다른 법령 버전의 합성 원문",
        fetchedAt: later,
        verifiedAt: later,
      },
      later.slice(0, 10),
    );
    expect(await repo.put(changed.source, changed.citation)).toBe(true);
    f.actor.now = later;
    expect((await read(f))[0]?.citation).toEqual(original.citation);
  } finally {
    f.db.close();
  }
});

test.each(["equal", "older"])(
  "%s-time conflicting original has deterministic renewal authority",
  async (time) => {
    const f = await fixture(1);
    try {
      const original = chunkAt(f),
        repo = createV2OfficialSourceRepository(f.core);
      f.actor.now = new Date(Date.parse(f.actor.now) + 25 * 3600000).toISOString();
      const same = await makeChunk(
        { ...original.source, fetchedAt: f.actor.now, verifiedAt: f.actor.now },
        f.actor.now.slice(0, 10),
      );
      expect(await repo.put(same.source, same.citation)).toBe(true);
      const observed = new Date(
        Date.parse(f.actor.now) - (time === "older" ? 1000 : 0),
      ).toISOString();
      const conflicting = await makeChunk(
        {
          ...same.source,
          body: "시각 충돌을 검증하는 다른 합성 원문",
          fetchedAt: observed,
          verifiedAt: observed,
        },
        f.actor.now.slice(0, 10),
      );
      expect(await repo.put(conflicting.source, conflicting.citation)).toBe(true);
      const result = (await read(f))[0];
      if (time === "equal") expect(result).toBeNull();
      else expect(result?.citation).toEqual(original.citation);
    } finally {
      f.db.close();
    }
  },
);

test("another re-verification while hashing requires a new read, and limited bindings stay unavailable", async () => {
  const f = await fixture(1);
  try {
    const original = chunkAt(f),
      repo = createV2OfficialSourceRepository(f.core);
    f.actor.now = new Date(Date.parse(f.actor.now) + 25 * 3600000).toISOString();
    const same = await makeChunk(
      { ...original.source, fetchedAt: f.actor.now, verifiedAt: f.actor.now },
      f.actor.now.slice(0, 10),
    );
    expect(await repo.put(same.source, same.citation)).toBe(true);
    const later = new Date(Date.parse(f.actor.now) + 1000).toISOString();
    const expiry = new Date(Date.parse(later) + 86400000).toISOString();
    f.actor.now = later;
    let reads = 0;
    f.meter.before(() => {
      if (++reads === 2)
        f.db.sqlite
          .query(
            "UPDATE v2_official_sources SET fetched_at=?,verified_at=?,expires_at=? WHERE source_id=?",
          )
          .run(later, later, expiry, same.source.sourceId);
    });
    expect(await read(f)).toEqual([null]);
    f.meter.before(() => {});
    expect((await read(f))[0]?.citation).toEqual(original.citation);
    const limited = await makeChunk(
      { ...same.source, fetchedAt: later, verifiedAt: later },
      later.slice(0, 10),
    );
    expect(await repo.put(limited.source, limited.citation, "limited")).toBe(true);
    expect(await read(f)).toEqual([null]);
  } finally {
    f.db.close();
  }
});
