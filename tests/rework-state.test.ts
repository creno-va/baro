import { afterEach, expect, test } from "bun:test";
import { type V2LegalAnalysisSnapshot, v2ReworkVersionSchema } from "../src/contracts/v2";
import { createV2ReworkRepository } from "../src/server/db/v2-rework";
import { analysisBasis } from "../src/server/modules/legal-retrieval/analysis/context";
import {
  createCaseReportDependencies,
  createReportDependencies,
} from "../src/server/modules/reports/runtime";
import {
  defaultAnalysisScope,
  loadAnalysisInput,
} from "../src/server/modules/rework/analysis-input";
import { createReworkCaseService } from "../src/server/modules/rework/case-context";
import { preparedAnalysisRecordSchema } from "../src/server/modules/rework/records";
import {
  createReworkStateService,
  preparedAnalysisMatchesScope,
  readPreparedAnalysis,
} from "../src/server/modules/rework/state";
import { readyFile, reportFixture } from "./helpers/report-fixture";
import { seedTestSession } from "./helpers/session";

const fixtures: Awaited<ReturnType<typeof reportFixture>>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.db.close();
});
async function fixture() {
  const f = await reportFixture();
  fixtures.push(f);
  return f;
}
function unavailable(
  input: NonNullable<Awaited<ReturnType<typeof loadAnalysisInput>>["input"]>,
  basis: Awaited<ReturnType<typeof analysisBasis>>,
  now: string,
): V2LegalAnalysisSnapshot {
  return {
    contractVersion: v2ReworkVersionSchema.value,
    id: crypto.randomUUID(),
    basis,
    context: input.context,
    basedOnFactIds: input.facts
      .filter((f) => ["user_statement", "user_material"].includes(f.attribution))
      .map((f) => f.id),
    includedEvidence: input.includedEvidence,
    asOfDate: now.slice(0, 10),
    checkedAt: now,
    status: "unavailable",
    citations: [],
    retrievalHash: "a".repeat(64),
    availability: [{ kind: "statute", status: "unavailable", reason: "configuration_missing" }],
    issues: [],
    precedents: [],
    perspective: {
      casePurpose: input.context.casePurpose,
      weaknesses: [],
      claimGaps: [],
      responsePoints: [],
      additionalMaterials: [],
    },
    evidenceRequirements: [],
    sourceClaims: [],
    limitations: ["공식 조회가 연결되지 않은 합성 검증입니다."],
  };
}
async function publish(
  f: Awaited<ReturnType<typeof fixture>>,
  scope = defaultAnalysisScope(),
  failure = false,
) {
  const loaded = await loadAnalysisInput(f.core, f.actor, f.workspaceId, scope);
  if (!loaded.input) throw new Error("missing input");
  const basis = await analysisBasis(loaded.input),
    snapshot = unavailable(loaded.input, basis, f.actor.now);
  const record = await createV2ReworkRepository(f.core, { clock: () => f.actor.now }).write(
    { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
    {
      kind: "analysis",
      expectedVersion: 0,
      schema: preparedAnalysisRecordSchema,
      value: {
        format: "prepared-legal-analysis-v1",
        basis,
        scope,
        snapshot: failure ? null : snapshot,
        failure: failure ? "MODEL_UNAVAILABLE" : null,
        completedAt: f.actor.now,
        procedureCitations: [],
      },
    },
  );
  if (!record) throw new Error("missing analysis");
  return { snapshot, record };
}
test("legacy context remains unconfirmed; local state reads neither create reports/jobs nor call a provider", async () => {
  const f = await fixture();
  const before = f.db.sqlite.query("SELECT count(*) n FROM v2_operations").get();
  const state = await createReworkStateService(f.core, { clock: () => f.actor.now }).get(
    f.actor.ownerId,
    f.workspaceId,
  );
  expect(state.caseContext.casePurpose).toBe("unconfirmed");
  expect(state.summaryConfirmed).toBe(true);
  expect(state.analysis.status).toBe("not_started");
  expect(state.report.status).toBe("not_started");
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_operations").get()).toEqual(before);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_reports").get()).toEqual({ n: 0 });
});
test("report runtime selects prepared analysis only after this case explicitly confirms a purpose", async () => {
  const f = await fixture();
  const env = { APP_ENV: "preview" } as Env;
  expect(
    createReportDependencies(env, f.core, f.actor.ownerId).readPreparedAnalysis,
  ).toBeUndefined();
  expect(
    (
      await createCaseReportDependencies(
        env,
        f.core,
        f.actor.ownerId,
        f.workspaceId,
        undefined,
        () => f.actor.now,
      )
    ).readPreparedAnalysis,
  ).toBeUndefined();
  await createReworkCaseService(f.core, { clock: () => f.actor.now }).update(
    f.actor.ownerId,
    f.workspaceId,
    crypto.randomUUID(),
    {
      expectedRevision: f.rev(),
      casePurpose: "respond_to_claim",
      subjectContext: "individual",
      procedure: { kind: "civil", stage: "first_instance", description: null },
    },
  );
  const { snapshot } = await publish(f);
  const deps = await createCaseReportDependencies(
    env,
    f.core,
    f.actor.ownerId,
    f.workspaceId,
    undefined,
    () => f.actor.now,
  );
  expect(await deps.readPreparedAnalysis?.(f.actor, f.workspaceId)).toEqual(snapshot);
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
  const readonly = await createCaseReportDependencies(
    env,
    f.core,
    f.actor.ownerId,
    f.workspaceId,
    undefined,
    () => f.actor.now,
  );
  expect(await readonly.readPreparedAnalysis?.(f.actor, f.workspaceId)).toEqual(snapshot);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
});
test("a current honest unavailable snapshot is preserved, and purpose/evidence changes invalidate its basis", async () => {
  const f = await fixture();
  const { snapshot } = await publish(f);
  expect(await readPreparedAnalysis(f.core, f.actor, f.workspaceId)).toEqual(snapshot);
  const state = await createReworkStateService(f.core, { clock: () => f.actor.now }).get(
    f.actor.ownerId,
    f.workspaceId,
  );
  expect(state.analysis.status).toBe("unavailable");
  expect(state.snapshot?.id).toBe(snapshot.id);
  await createReworkCaseService(f.core, { clock: () => f.actor.now }).update(
    f.actor.ownerId,
    f.workspaceId,
    crypto.randomUUID(),
    {
      expectedRevision: f.rev(),
      casePurpose: "respond_to_claim",
      subjectContext: "individual",
      procedure: { kind: "civil", stage: "first_instance", description: null },
    },
  );
  expect(await readPreparedAnalysis(f.core, f.actor, f.workspaceId)).toBeNull();
  expect(
    (
      await createReworkStateService(f.core, { clock: () => f.actor.now }).get(
        f.actor.ownerId,
        f.workspaceId,
      )
    ).analysis.status,
  ).toBe("stale");
  expect(
    (
      await createV2ReworkRepository(f.core).read(
        f.actor,
        f.workspaceId,
        "analysis",
        f.workspaceId,
        preparedAnalysisRecordSchema,
      )
    )?.value.snapshot?.id,
  ).toBe(snapshot.id);
});
test("withdrawing processing consent preserves local currentness and existing report readability", async () => {
  const f = await fixture();
  const { snapshot } = await publish(f);
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
  expect(await readPreparedAnalysis(f.core, f.actor, f.workspaceId)).toEqual(snapshot);
  const state = await createReworkStateService(f.core, { clock: () => f.actor.now }).get(
    f.actor.ownerId,
    f.workspaceId,
  );
  expect(state.analysis.status).toBe("unavailable");
  await expect(
    createReworkCaseService(f.core, { clock: () => f.actor.now }).update(
      f.actor.ownerId,
      f.workspaceId,
      crypto.randomUUID(),
      {
        expectedRevision: f.rev(),
        casePurpose: "prepare_claim",
        subjectContext: "individual",
        procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
      },
    ),
  ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
});
test("actual evidence positions/hashes and masking are part of the scope proof", async () => {
  const f = await fixture();
  const file = await readyFile(f, "연락처 010-1234-5678을 적은 합성 계약서입니다.");
  const observationId = crypto.randomUUID();
  const observation = {
    id: crypto.randomUUID(),
    text: "연락처 010-1234-5678을 적은 합성 계약서입니다.",
    position: { kind: "document", page: 1, paragraph: null, table: null },
    certainty: "observed",
    userEdited: false,
    included: true,
  };
  const encrypted = await f.core.encrypt(
    "v2_file_observations",
    observationId,
    f.actor.ownerId,
    2,
    observation,
  );
  f.db.sqlite
    .query(
      "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload) VALUES(?,?,?,2,2,0,?)",
    )
    .run(observationId, observation.id, file.session.fileId, encrypted);
  const original = await loadAnalysisInput(f.core, f.actor, f.workspaceId);
  expect(original.input?.includedEvidence).toMatchObject([
    { fileId: file.session.fileId, fileRevision: 2 },
  ]);
  expect(original.input?.materials[0]?.reference).toMatchObject({
    kind: "user_material",
    fileId: file.session.fileId,
  });
  expect(original.input?.materials[0]?.text).toContain("010-1234-5678");
  expect(original.input?.materials[0]?.coverage).toEqual({
    observationCertainty: "observed",
    userEdited: false,
  });
  const scope = { excludedFileIds: [], maskIdentifiers: true };
  const masked = await loadAnalysisInput(f.core, f.actor, f.workspaceId, scope);
  expect(JSON.stringify(masked.input)).not.toContain("010-1234-5678");
  const { snapshot } = await publish(f, scope);
  expect(await preparedAnalysisMatchesScope(f.core, f.actor, f.workspaceId, snapshot, scope)).toBe(
    true,
  );
  expect(
    await preparedAnalysisMatchesScope(
      f.core,
      f.actor,
      f.workspaceId,
      snapshot,
      defaultAnalysisScope(),
    ),
  ).toBe(false);
  expect(
    await readPreparedAnalysis(f.core, f.actor, f.workspaceId, {
      excludedFileIds: [file.session.fileId],
      maskIdentifiers: true,
    }),
  ).toBeNull();
  await readyFile(f, "추가 제출된 합성 자료입니다.");
  expect(await readPreparedAnalysis(f.core, f.actor, f.workspaceId, scope)).toBeNull();
});
test("failure remains failure, consent withdrawal stops current proof, and another owner cannot read state", async () => {
  const f = await fixture();
  await publish(f, defaultAnalysisScope(), true);
  const states = createReworkStateService(f.core, { clock: () => f.actor.now });
  expect((await states.get(f.actor.ownerId, f.workspaceId)).analysis).toMatchObject({
    status: "failed",
    failure: "MODEL_UNAVAILABLE",
  });
  const peer = await seedTestSession(f.db, { consent: true });
  await expect(states.get(peer.userId, f.workspaceId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
  expect(await readPreparedAnalysis(f.core, f.actor, f.workspaceId)).toBeNull();
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_reports").get()).toEqual({ n: 0 });
});
