import { expect, test } from "bun:test";
import { fixture, plan, type syntheticDetail } from "../scripts/benchmarks/retrieval/harness";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2OfficialSourceRepository } from "../src/server/db/v2-official-sources";
import { textHash } from "../src/server/modules/legal-retrieval/service";
import { GUIDE_HOSTS } from "../src/server/modules/legal-retrieval/v2/registry";
import { createV2LegalRetrieval } from "../src/server/modules/legal-retrieval/v2/service";
import { workspaceRetrievalPlans } from "../src/server/modules/legal-retrieval/v2/workspace-plans";
import {
  projectWorkspaceSources,
  sourceExcerpt,
} from "../src/server/modules/legal-retrieval/v2/workspace-sources";
import { readWorkspaceContext } from "../src/server/modules/workspace/context";
import {
  createWorkspacePipeline,
  type WorkspaceContext,
} from "../src/server/modules/workspace/pipeline";
import capturedGuide from "./fixtures/legal/v2/captured-guide-structure.json";
import families from "./fixtures/legal/v2/families.json";

const approved = {
  pass: true,
  findings: [],
  unsupportedFactIds: [],
  legalClaimsSupported: true,
  strategyDetected: false,
};
async function contextFor(f: Awaited<ReturnType<typeof fixture>>) {
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("b".repeat(32)).replace(/=+$/, ""),
  });
  const core = createV2Core(f.binding, cipher),
    actor = { ownerId: f.owner.userId, now: f.guard.now };
  const context = await readWorkspaceContext(
    core,
    actor,
    f.guard.workspaceId,
    undefined,
    GUIDE_HOSTS,
  );
  context.intake.status = "confirmed";
  context.confirmedSummary = {
    schemaVersion: "2",
    revision: 1,
    intakeRevision: context.intake.revision,
    createdAt: actor.now,
    overview: "합성 사실 정리",
    facts: [],
    parties: [],
    unknowns: [],
    notices: ["합성 검증"],
  };
  context.latestMessage = {
    schemaVersion: "2",
    id: "synthetic_message",
    operationId: crypto.randomUUID(),
    role: "user",
    workspaceRevision: f.guard.expectedRevision,
    text: "자료를 확인하려 합니다.",
    selectedFileIds: [],
    createdAt: actor.now,
  };
  return { core, actor, context };
}
const chatDraft = () => ({
  text: "확인할 사실과 보유 자료를 정리합니다.",
  references: [],
  warnings: [],
  facts: [],
  actions: [],
  parties: [],
  requestedSources: [],
  sourceClaims: [],
  timeline: [],
});

test.each(["cancel", "consent"])(
  "final digest %s race releases no original or citation",
  async (mode) => {
    const f = await fixture(createV2LegalRetrieval),
      controller = new AbortController();
    const original = crypto.subtle.digest.bind(crypto.subtle);
    let intervened = false;
    try {
      crypto.subtle.digest = async (algorithm, data) => {
        const result = await original(algorithm, data);
        if (!intervened && new TextDecoder().decode(data as ArrayBuffer).startsWith('["source_')) {
          intervened = true;
          if (mode === "cancel") controller.abort();
          else f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
        }
        return result;
      };
      const output = await f.service.retrieve(f.input([plan(["598"])]), {
        ...f.access,
        signal: controller.signal,
      });
      expect(intervened).toBe(true);
      expect(output.chunks).toEqual([]);
      expect(output.outcomes[0]?.chunks).toEqual([]);
      expect(output.legalSourceStatus).toBe("unavailable");
      expect(output.retrievalHash).toBe(await textHash("[]"));
    } finally {
      crypto.subtle.digest = original;
      f.db.close();
    }
  },
);

test("limited guide is never bound or restored as a verified citation", async () => {
  const f = await fixture(createV2LegalRetrieval);
  try {
    const { core, actor } = await contextFor(f),
      repository = createV2OfficialSourceRepository(core, GUIDE_HOSTS);
    const service = createV2LegalRetrieval({ LAW_API_OC: "synthetic-only" }, repository, {
      bindCitation: (c) => repository.bindCitation(f.guard, c),
      transport: async () =>
        new Response(capturedGuide.body, { headers: { "content-type": "text/html" } }),
    });
    const output = await service.retrieve(
      f.input(
        workspaceRetrievalPlans([{ kind: "official_guide", guideKey: "legal_consultation" }]),
      ),
      f.access,
    );
    expect(output.outcomes[0]?.availability).toBe("limited");
    expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
      n: 0,
    });
    const projection = await projectWorkspaceSources(output);
    expect(projection.citations).toEqual([]);
    expect(projection.sourceCoverage.sourcesPartial).toBe(true);
    expect(projection.sourceCoverage.outcomes[0]?.reason).toBe("update_pending");
    expect(
      (await readWorkspaceContext(core, actor, f.guard.workspaceId, undefined, GUIDE_HOSTS))
        .references.verifiedCitationIds,
    ).toEqual([]);
  } finally {
    f.db.close();
  }
});

test("a newly observed guide limitation revokes earlier bindings even at the same timestamp", async () => {
  const f = await fixture(createV2LegalRetrieval);
  try {
    const { core, actor } = await contextFor(f),
      repo = createV2OfficialSourceRepository(core, GUIDE_HOSTS);
    let pending = false;
    const service = createV2LegalRetrieval({ LAW_API_OC: "synthetic-only" }, repo, {
      bindCitation: (citation) => repo.bindCitation(f.guard, citation),
      transport: async () =>
        new Response(
          pending
            ? capturedGuide.body
            : capturedGuide.body.replace(/향후\s*업데이트\s*예정/g, "합성 검증 안내"),
          { headers: { "content-type": "text/html" } },
        ),
    });
    const input = f.input(
      workspaceRetrievalPlans([{ kind: "official_guide", guideKey: "legal_consultation" }]),
    );
    const first = await service.retrieve(input, f.access);
    expect(first.outcomes[0]?.availability).toBe("verified");
    const oldCitation = first.chunks[0]?.citation;
    if (!oldCitation) throw new Error("Missing synthetic guide");
    pending = true;
    expect((await service.retrieve(input, f.access)).outcomes[0]?.availability).toBe("limited");
    expect(await repo.bindCitation(f.guard, { ...oldCitation, id: crypto.randomUUID() })).toBe(
      false,
    );
    expect(
      (await readWorkspaceContext(core, actor, f.guard.workspaceId, undefined, GUIDE_HOSTS))
        .sourceStatus,
    ).toBe("unavailable");
  } finally {
    f.db.close();
  }
});

test("an older limited observation cannot revoke a newer verified source", async () => {
  const f = await fixture(createV2LegalRetrieval);
  try {
    const output = await f.service.retrieve(f.input([plan(["598"])]), f.access);
    const chunk = output.chunks[0];
    if (!chunk) throw new Error("Missing synthetic source");
    const { core, actor } = await contextFor(f);
    const repo = createV2OfficialSourceRepository(core);
    const earlier = new Date(Date.parse(actor.now) - 60000).toISOString();
    expect(
      await repo.put(
        { ...chunk.source, fetchedAt: earlier, verifiedAt: earlier },
        { ...chunk.citation, verifiedAt: earlier },
        "limited",
      ),
    ).toBe(false);
    expect((await readWorkspaceContext(core, actor, f.guard.workspaceId)).sourceStatus).toBe(
      "verified",
    );
  } finally {
    f.db.close();
  }
});

test("the ten-source projection limit exposes omitted citations", async () => {
  const f = await fixture(createV2LegalRetrieval);
  try {
    const output = await f.service.retrieve(f.input([plan(["598"])]), f.access);
    const chunk = output.chunks[0];
    const outcome = output.outcomes[0];
    if (!chunk || !outcome) throw new Error("Missing synthetic source");
    const chunks = Array.from({ length: 11 }, () => ({
      ...chunk,
      citation: { ...chunk.citation, id: crypto.randomUUID() },
    }));
    const projection = await projectWorkspaceSources({
      ...output,
      chunks,
      outcomes: [{ ...outcome, chunks }],
    });
    expect(projection.citations).toHaveLength(10);
    expect(projection.sourceTexts).toHaveLength(10);
    expect(projection.sourceRetrieval.outcomes[0]?.chunks).toHaveLength(10);
    expect(projection.sourceCoverage.sourcesPartial).toBe(true);
  } finally {
    f.db.close();
  }
});

test.each([
  "body",
  "version",
  "extractor_version",
  "rights_provenance",
  "source_date",
  "title",
  "canonical_url",
])("restoring a %s-corrupted original removes its verified authority", async (column) => {
  const f = await fixture(createV2LegalRetrieval);
  try {
    const output = await f.service.retrieve(f.input([plan(["598"])]), f.access);
    const { core, actor } = await contextFor(f);
    const chunk = output.chunks[0];
    if (!chunk) throw new Error("Missing synthetic source");
    f.db.sqlite
      .query(`UPDATE v2_official_sources SET ${column}=? WHERE source_id=?`)
      .run(column === "source_date" ? "2026-10-07" : "altered-synthetic", chunk.source.sourceId);
    const context = await readWorkspaceContext(core, actor, f.guard.workspaceId);
    expect(context.citations).toEqual([]);
    expect(context.sourceStatus).toBe("unavailable");
    expect(context.sourceCoverage?.rejectedSources).toBe(1);
  } finally {
    f.db.close();
  }
});

test("restored source excerpts expose omissions and retain full originals only as server proof", async () => {
  const f = await fixture(createV2LegalRetrieval, {
    mutate(value, list) {
      if (!list)
        for (const row of (value as typeof syntheticDetail).법령.조문.조문단위)
          row.조문내용 = "합성 원문 ".repeat(5000);
      return value;
    },
  });
  try {
    await f.service.retrieve(f.input([plan(["598"])]), f.access);
    const { context } = await contextFor(f);
    expect(context.sourceStatus).toBe("verified");
    expect(context.sourceTexts?.[0]?.text.length).toBe(20000);
    expect(context.sourceRetrieval?.chunks[0]?.source.body.length).toBeGreaterThan(20000);
    expect(context.contextCoverage?.sourcesPartial).toBe(true);
    expect(sourceExcerpt(`${"a".repeat(19999)}😀`).text.length).toBe(19999);
  } finally {
    f.db.close();
  }
});

test("future promulgation fails even if list and detail agree", async () => {
  const f = await fixture(createV2LegalRetrieval, {
    mutate(value, list) {
      if (list) {
        const row = (value as { LawSearch: { law: { 공포일자: string }[] } }).LawSearch.law[0];
        if (!row) throw new Error("Missing synthetic statute");
        row.공포일자 = "20270101";
      } else (value as typeof syntheticDetail).법령.기본정보.공포일자 = "20270101";
      return value;
    },
  });
  try {
    const output = await f.service.retrieve(f.input([plan(["598"])]), f.access);
    expect(output.outcomes[0]?.reason).toBe("date_invalid");
    expect(output.chunks).toEqual([]);
  } finally {
    f.db.close();
  }
});

test.each(["quotation", "legal_explanation", "altered_quote", "missing_claim", "audit_rejected"])(
  "product %s uses original/span integrity and independent claim review",
  async (mode) => {
    const f = await fixture(createV2LegalRetrieval);
    try {
      await f.service.retrieve(f.input([plan(["598"])]), f.access);
      const { context } = await contextFor(f),
        chunk = context.sourceRetrieval?.chunks[0];
      if (!chunk) throw new Error("Missing synthetic source");
      const quote =
        mode === "legal_explanation"
          ? "합성 자료의 내용은 원문 확인이 필요합니다."
          : mode === "altered_quote"
            ? "원문에 없는 합성 인용"
            : chunk.source.body;
      const ref = { kind: "official_source" as const, citationId: chunk.citation.id };
      const draft = {
        ...chatDraft(),
        text: quote,
        references: [ref],
        sourceClaims:
          mode === "missing_claim"
            ? []
            : [
                {
                  id: "synthetic_claim",
                  kind: mode === "legal_explanation" ? "legal_explanation" : "quotation",
                  text: quote,
                  citationId: chunk.citation.id,
                  startUtf16: 0,
                  endUtf16: chunk.source.body.length,
                },
              ],
      };
      const pipeline = createWorkspacePipeline(
        {
          call: async (phase, input) => {
            expect(JSON.stringify(input)).not.toContain('"sourceRetrieval"');
            return phase === "workspace_audit"
              ? { ...approved, pass: mode !== "audit_rejected" }
              : draft;
          },
        },
        { reserve: async () => true, invocation: () => crypto.randomUUID() },
      );
      if (["altered_quote", "missing_claim", "audit_rejected"].includes(mode))
        await expect(pipeline.chat(context, "synthetic")).rejects.toThrow();
      else expect((await pipeline.chat(context, "synthetic")).citations).toHaveLength(1);
    } finally {
      f.db.close();
    }
  },
);

for (const scenario of families) {
  test(`${scenario.family}/${scenario.sourceState}: real retrieval and chat retain attributed factual preparation`, async () => {
    const f = await fixture(createV2LegalRetrieval, {
      mutate(value, list) {
        if (scenario.sourceState === "gap" && list) return { LawSearch: { totalCnt: 0 } };
        if (list) {
          const row = (value as { LawSearch: { law: { 법령명한글: string }[] } }).LawSearch.law[0];
          if (!row) throw new Error("Missing synthetic statute");
          row.법령명한글 = "민법";
        } else (value as typeof syntheticDetail).법령.기본정보.법령명_한글 = "민법";
        return value;
      },
    });
    try {
      const { context } = await contextFor(f);
      context.intake.narrative = scenario.narrative;
      context.sourceStatus = "verified"; // Prior sources must not suppress this turn's new lookup.
      let lookups = 0;
      const pipeline = createWorkspacePipeline(
        {
          call: async (phase, input) => {
            if (phase === "workspace_audit") return approved;
            const current = input as WorkspaceContext;
            if (!current.sourceLookupPerformed)
              return {
                ...chatDraft(),
                requestedSources: [
                  { kind: "statute", lawTitle: "민법", articles: [{ number: "598", branch: "0" }] },
                ],
              };
            return {
              ...chatDraft(),
              facts: [
                {
                  id: "synthetic_fact",
                  text: scenario.narrative,
                  attribution: "user_statement",
                  certainty: "reported",
                  significance: "neutral",
                  references: [
                    { kind: "intake_narrative", intakeRevision: context.intake.revision },
                  ],
                  conflictingFactIds: [],
                  userEdited: false,
                },
              ],
              actions: [
                {
                  id: "synthetic_action",
                  revision: 1,
                  kind: "organize_materials",
                  title: "보유 자료 정리",
                  instructions: "진술과 관련된 자료의 날짜와 보유 여부를 확인해 주세요.",
                  caution: "법률 적용 여부는 별도 확인이 필요합니다.",
                  status: "todo",
                  factIds: ["synthetic_fact"],
                  references: [
                    { kind: "intake_narrative", intakeRevision: context.intake.revision },
                  ],
                },
              ],
            };
          },
        },
        {
          reserve: async () => true,
          invocation: () => crypto.randomUUID(),
          retrieve: async (current, requests) => {
            lookups++;
            const output = await f.service.retrieve(
              f.input(workspaceRetrievalPlans(requests)),
              f.access,
            );
            const sources = await projectWorkspaceSources(output);
            return {
              ...current,
              ...sources,
              references: {
                ...current.references,
                verifiedCitationIds: sources.citations.map((c) => c.id),
              },
            };
          },
        },
      );
      const result = await pipeline.chat(context, "synthetic-family");
      expect(lookups).toBe(1);
      expect(result.facts[0]?.text).toBe(scenario.narrative);
      expect(result.actions[0]?.kind).toBe("organize_materials");
      expect(result.actions[0]?.factIds).toEqual(["synthetic_fact"]);
      expect(result.sourceClaims).toEqual([]);
      expect(result.citations).toEqual([]);
      if (scenario.sourceState === "gap") expect(result.warnings.join(" ")).toContain("사실 정리");
    } finally {
      f.db.close();
    }
  });
}
