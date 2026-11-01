import { expect, test } from "bun:test";
import { v2ResolutionStateForGuidesSchema } from "../src/contracts/v2/resolution";
import { createV2OfficialSourceRepository } from "../src/server/db/v2-official-sources";
import { createV2ReworkRepository } from "../src/server/db/v2-rework";
import { readBoundSourceBatch } from "../src/server/modules/legal-retrieval/v2/bound-sources";
import { capturePublicationSourceAuthority } from "../src/server/modules/legal-retrieval/v2/publication-authority";
import {
  GUIDE_HOSTS,
  guideUrl,
  OFFICIAL_CATALOG,
} from "../src/server/modules/legal-retrieval/v2/registry";
import { makeChunk } from "../src/server/modules/legal-retrieval/v2/source";
import {
  buildProcedureSources,
  selectReviewedProcedurePlans,
} from "../src/server/modules/resolution/procedure-sources";
import { createResolutionRuntimeAdapter } from "../src/server/modules/resolution/runtime-adapter";
import { createResolutionService } from "../src/server/modules/resolution/service";
import { customerWorkspaceFixture } from "./helpers/customer-workspace";
import { resolutionMutation, resolutionSource } from "./helpers/resolution-fixture";
import { seedTestSession } from "./helpers/session";

const originalTime = "2026-11-01T12:00:00.000Z";
const renewalTime = "2026-11-02T13:00:00.000Z";

/** Actual source repository/binding/hash verification, publication SQL and encrypted
 * resolution CAS. Case/report facts and the public guide body are synthetic;
 * no live retrieval, model, HTTP authority or legal acceptance is substituted. */
async function fixture() {
  const f = await customerWorkspaceFixture(originalTime);
  const context = resolutionSource().context;
  const plan = selectReviewedProcedurePlans(context)[0];
  if (!plan) throw Error("Missing synthetic guide plan");
  const original = await makeChunk(
    {
      sourceType: "official_guide",
      officialId: "guide_568_4_1_1",
      version: "2026-10-15",
      section: "합성 절차 안내",
      canonicalUrl: guideUrl(plan).href,
      title: "합성 절차 안내",
      body: "합성 검증 전용\n소장에 기재해야 하는 필수 기재사항은 다음과 같습니다(「민사소송법」 제249조 및 제274조제1항).\n합성 끝",
      sourceDate: "2026-10-15",
      fetchedAt: originalTime,
      verifiedAt: originalTime,
      rightsProvenance: OFFICIAL_CATALOG[2].rights,
      institutionId: "moleg_easylaw",
      endpointId: "easylaw_text_section",
      court: null,
      caseNumber: null,
    },
    "2026-11-01",
  );
  const guard = {
    ownerId: f.owner.userId,
    workspaceId: f.workspace.id,
    expectedRevision: f.workspace.workspaceRevision,
    now: originalTime,
  };
  const sources = createV2OfficialSourceRepository(f.core, GUIDE_HOSTS);
  expect(await sources.put(original.source, original.citation)).toBe(true);
  expect(await sources.bindCitation(guard, original.citation)).toBe(true);
  const binding = () =>
    f.db.sqlite.query("SELECT * FROM v2_citation_bindings WHERE id=?").get(original.citation.id);
  const originalBinding = binding();
  let now = renewalTime;
  let scope = guard.workspaceId;
  const read = () => readBoundSourceBatch(f.core, scope, [original.citation.id], now, GUIDE_HOSTS);
  expect(await read()).toEqual([null]); // The original receipt's 24h cache expired.
  const renewed = await makeChunk(
    { ...original.source, fetchedAt: now, verifiedAt: now },
    "2026-11-02",
  );
  expect(await sources.put(renewed.source, renewed.citation)).toBe(true);
  async function loadSource() {
    const chunks = await read();
    const proof = await buildProcedureSources({
      context,
      asOfDate: now.slice(0, 10),
      now,
      // Like the root runtime, retain the exact prepared-analysis citation binding.
      outcomes: chunks.flatMap((chunk) =>
        chunk && JSON.stringify(chunk.citation) === JSON.stringify(original.citation)
          ? [
              {
                kind: "official_guide" as const,
                availability: "verified" as const,
                reason: null,
                chunks: [chunk],
              },
            ]
          : [],
      ),
    });
    return { ...resolutionSource(), ...proof };
  }
  let afterCapture: (() => void | Promise<void>) | undefined;
  let beforeClaim: (() => void) | undefined;
  const deps = createResolutionRuntimeAdapter(f.core, {
    loadSource,
    authorize: async () => true, // The adapter still applies real owner/consent/deletion SQL.
    now: () => now,
    guideHosts: GUIDE_HOSTS,
    publicationAuthority: async () => {
      const source = await loadSource();
      if (!source.documentSupport.some((s) => s.documentKind === "civil_claim"))
        return { sql: "0", values: [] };
      const proof = await capturePublicationSourceAuthority(
        f.core,
        { ...guard, now },
        source.citations.map((c) => ({ kind: "official_source", citationId: c.id })),
        source.citations,
        GUIDE_HOSTS,
      );
      if (!proof) return { sql: "0", values: [] };
      await afterCapture?.();
      return (at) => {
        beforeClaim?.();
        return { sql: proof.sql, values: proof.values(at) };
      };
    },
  });
  const service = createResolutionService(deps);
  const records = createV2ReworkRepository(f.core, { clock: () => now });
  const record = () =>
    records.read(
      { ownerId: guard.ownerId, now },
      guard.workspaceId,
      "resolution",
      guard.workspaceId,
      v2ResolutionStateForGuidesSchema(GUIDE_HOSTS),
    );
  async function select() {
    const state = await service.get(guard.ownerId, guard.workspaceId);
    expect(state.allowedDocumentKinds).toContain("civil_claim");
    return service.update(guard.ownerId, guard.workspaceId, {
      ...resolutionMutation(state),
      action: "select",
      choice: "self",
      selectedFileIds: state.selectedFileIds,
      maskIdentifiers: true,
    });
  }
  return {
    ...f,
    workspaceService: f.service,
    guard,
    sources,
    original,
    renewed,
    originalBinding,
    binding,
    read,
    loadSource,
    service,
    record,
    select,
    setNow: (value: string) => {
      now = value;
    },
    setScope: (value: string) => {
      scope = value;
    },
    afterCapture: (work: () => void | Promise<void>) => {
      afterCapture = work;
    },
    beforeClaim: (work: () => void) => {
      beforeClaim = work;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const sourceUpdate = (f: Fixture, column: string, value: string) =>
  f.db.sqlite
    .query(`UPDATE v2_official_sources SET ${column}=? WHERE source_id=?`)
    .run(value, f.original.source.sourceId);
const mutations: Record<string, (f: Fixture) => void> = {
  body: (f) => sourceUpdate(f, "body", `${f.original.source.body}\n변경`),
  hash: (f) => sourceUpdate(f, "content_hash", "0".repeat(64)),
  source: (f) => sourceUpdate(f, "official_id", "guide_568_7_2_1"),
  rights: (f) => sourceUpdate(f, "rights_provenance", "unreviewed"),
  expiry: (f) => sourceUpdate(f, "expires_at", "2026-11-02T13:00:01.000Z"),
  binding: (f) =>
    f.db.sqlite.query("DELETE FROM v2_citation_bindings WHERE id=?").run(f.original.citation.id),
  receipt: (f) =>
    f.db.sqlite
      .query(
        "UPDATE v2_citation_bindings SET citation_json=json_set(citation_json,'$.verifiedAt',?) WHERE id=?",
      )
      .run("2026-10-31T12:00:00.000Z", f.original.citation.id),
};

test("renewed guide supports a formal draft while preserving the original receipt and body through encrypted publication", async () => {
  const f = await fixture();
  try {
    const [chunk] = await f.read();
    expect(chunk?.citation).toEqual(f.original.citation);
    expect(chunk?.source).toEqual(f.renewed.source);
    expect(chunk?.source.sourceId).toBe(f.original.source.sourceId);
    expect(chunk?.source.body).toBe(f.original.source.body);
    expect(chunk?.source.contentHash).toBe(f.original.source.contentHash);
    expect(chunk?.span).toEqual(f.original.span);
    expect(f.binding()).toEqual(f.originalBinding);
    expect(
      await f.sources.bindCitation(
        { ...f.guard, now: renewalTime },
        {
          ...f.renewed.citation,
          id: "forged_earlier",
          verifiedAt: originalTime,
        },
      ),
    ).toBe(false); // New bindings must still match the actual fresh verification time.
    const selected = await f.select();
    expect(selected.citations).toEqual([f.original.citation]);
    const state = await f.service.prepareDraft(f.guard.ownerId, f.guard.workspaceId, {
      ...resolutionMutation(selected),
      documentKind: "civil_claim",
      selectedFileIds: selected.selectedFileIds,
      maskIdentifiers: true,
      factsConfirmed: true,
    });
    expect(state.draft?.documentKind).toBe("civil_claim");
    expect(state.draft?.reviewed).toBe(false);
    expect(state.draft?.content).toContain("[미입력: 관할]");
    expect(state.citations).toEqual([f.original.citation]);
    expect((await f.record())?.value.citations).toEqual([f.original.citation]);
    expect((await f.record())?.value.draft).toEqual(state.draft);
    expect(f.binding()).toEqual(f.originalBinding);
  } finally {
    f.db.sqlite.close();
  }
});

test.each(Object.entries(mutations))(
  "renewed guide rejects %s drift before admission and at the final encrypted CAS",
  async (_name, mutate) => {
    for (const late of [false, true]) {
      const f = await fixture();
      try {
        if (!late) {
          mutate(f);
          expect(
            (await f.service.get(f.guard.ownerId, f.guard.workspaceId)).allowedDocumentKinds,
          ).toEqual(["fact_statement"]);
          expect((await f.loadSource()).documentSupport).toEqual([]);
          expect(await f.record()).toBeNull();
        } else {
          const selected = await f.select();
          const stored = await f.record();
          f.beforeClaim(() => mutate(f));
          await expect(
            f.service.prepareDraft(f.guard.ownerId, f.guard.workspaceId, {
              ...resolutionMutation(selected),
              documentKind: "civil_claim",
              selectedFileIds: selected.selectedFileIds,
              maskIdentifiers: true,
              factsConfirmed: true,
            }),
          ).rejects.toMatchObject({ code: "STALE_REVISION" });
          expect(await f.record()).toEqual(stored);
        }
      } finally {
        f.db.sqlite.close();
      }
    }
  },
);

test("renewed guide rejects foreign owners and wrong source scope, including late owner changes", async () => {
  const f = await fixture();
  try {
    const foreign = await seedTestSession(f.db, { consent: true });
    await expect(f.service.get(foreign.userId, f.guard.workspaceId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    f.setScope("other_workspace");
    expect(await f.read()).toEqual([null]);
    expect(
      (await f.service.get(f.guard.ownerId, f.guard.workspaceId)).allowedDocumentKinds,
    ).toEqual(["fact_statement"]);
    f.setScope(f.guard.workspaceId);
    const selected = await f.select();
    const stored = await f.record();
    f.beforeClaim(() =>
      f.db.sqlite
        .query("UPDATE v2_workspaces SET owner_id=? WHERE id=?")
        .run(foreign.userId, f.guard.workspaceId),
    );
    await expect(
      f.service.prepareDraft(f.guard.ownerId, f.guard.workspaceId, {
        ...resolutionMutation(selected),
        documentKind: "civil_claim",
        selectedFileIds: selected.selectedFileIds,
        maskIdentifiers: true,
        factsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    f.db.sqlite
      .query("UPDATE v2_workspaces SET owner_id=? WHERE id=?")
      .run(f.guard.ownerId, f.guard.workspaceId);
    expect(await f.record()).toEqual(stored);
  } finally {
    f.db.sqlite.close();
  }
});

test("renewed source TTL is checked at the final claim time without rewriting the older citation", async () => {
  const f = await fixture();
  try {
    const selected = await f.select();
    const stored = await f.record();
    f.afterCapture(() => f.setNow(f.renewed.source.expiresAt));
    await expect(
      f.service.prepareDraft(f.guard.ownerId, f.guard.workspaceId, {
        ...resolutionMutation(selected),
        documentKind: "civil_claim",
        selectedFileIds: selected.selectedFileIds,
        maskIdentifiers: true,
        factsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(await f.record()).toEqual(stored);
    expect(f.binding()).toEqual(f.originalBinding);
  } finally {
    f.db.sqlite.close();
  }
});

test("renewed guide binding moved to another workspace cannot pass the captured publication fence", async () => {
  const f = await fixture();
  try {
    const other = await f.workspaceService.create(f.guard.ownerId, crypto.randomUUID(), {
      narrative: "별도 사건의 자료 준비를 확인합니다.",
      subjectContext: "individual",
      jurisdiction: "KR",
      turnstileToken: "synthetic",
    });
    const selected = await f.select();
    const stored = await f.record();
    f.beforeClaim(() =>
      f.db.sqlite
        .query("UPDATE v2_citation_bindings SET workspace_id=? WHERE id=?")
        .run(other.id, f.original.citation.id),
    );
    await expect(
      f.service.prepareDraft(f.guard.ownerId, f.guard.workspaceId, {
        ...resolutionMutation(selected),
        documentKind: "civil_claim",
        selectedFileIds: selected.selectedFileIds,
        maskIdentifiers: true,
        factsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(await f.record()).toEqual(stored);
    expect(await f.read()).toEqual([null]);
  } finally {
    f.db.sqlite.close();
  }
});

test.each([false, true])(
  "a correctly hashed newer original cannot reuse the previous receipt (late=%s)",
  async (late) => {
    const f = await fixture();
    try {
      const replacementTime = "2026-11-02T13:00:01.000Z";
      const replacement = await makeChunk(
        {
          ...f.renewed.source,
          body: `${f.renewed.source.body}\n새 원문의 내용`,
          fetchedAt: replacementTime,
          verifiedAt: replacementTime,
        },
        "2026-11-02",
      );
      expect(replacement.source.sourceId).not.toBe(f.original.source.sourceId);
      expect(replacement.source.contentHash).not.toBe(f.original.source.contentHash);
      const publishReplacement = async () => {
        expect(await f.sources.put(replacement.source, replacement.citation)).toBe(true);
        f.setNow(replacementTime);
      };
      if (late) {
        const selected = await f.select();
        const stored = await f.record();
        f.afterCapture(publishReplacement);
        await expect(
          f.service.prepareDraft(f.guard.ownerId, f.guard.workspaceId, {
            ...resolutionMutation(selected),
            documentKind: "civil_claim",
            selectedFileIds: selected.selectedFileIds,
            maskIdentifiers: true,
            factsConfirmed: true,
          }),
        ).rejects.toMatchObject({ code: "STALE_REVISION" });
        expect(await f.record()).toEqual(stored);
      } else {
        await publishReplacement();
        expect(
          (await f.service.get(f.guard.ownerId, f.guard.workspaceId)).allowedDocumentKinds,
        ).toEqual(["fact_statement"]);
      }
      expect(await f.read()).toEqual([null]);
      expect(f.binding()).toEqual(f.originalBinding);
    } finally {
      f.db.sqlite.close();
    }
  },
);
