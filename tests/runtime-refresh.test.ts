import { expect, test } from "bun:test";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { createV2Core } from "../src/server/db/v2-core";
import { fundingProofSchema, pricingProofSchema } from "../src/server/db/v2-paid-contracts";
import { budgetAdmissionPredicate } from "../src/server/db/v2-paid-statements";
import {
  createV2RuntimeRefreshRepository,
  type RuntimeRefresh,
} from "../src/server/db/v2-runtime-refresh";
import { fileStorageRequestCore } from "../src/server/modules/files/limits";
import { createFileStorageBudget } from "../src/server/modules/files/runtime";
import { createFilesService } from "../src/server/modules/files/service";
import { readProcessingProofs } from "../src/server/runtime/processing-proofs";
import { r2 } from "./helpers/file-processing-fixture";
import { EXP, fixture, LATER, NOW, ready, verifier } from "./helpers/storage-capacity";

async function observation(f: Awaited<ReturnType<typeof fixture>>, at = LATER) {
  const pricing = {
    ...f.pp,
    id: crypto.randomUUID(),
    checkedAt: at,
    prices: f.pp.prices.map((p) => ({ ...p, checkedAt: at })),
    fx: { ...f.pp.fx, checkedAt: at, asOf: at },
  };
  const funding = { ...f.fp, id: crypto.randomUUID(), observedAt: at };
  expect(await f.runtime.putPricingProof(pricing, at)).toBe(true);
  // Verified-at order is authoritative, not insertion order or a caller's clock.
  const { createV2PaidRuntimeRepository } = await import("../src/server/db/v2-paid-runtime");
  const runtime = createV2PaidRuntimeRepository(
    f.core,
    "preview",
    async (kind, payload, digest) => {
      const evidence = await verifier(kind, payload, digest);
      const observed = (payload as { observedAt?: string }).observedAt ?? at;
      return evidence ? { ...evidence, verifiedAt: observed > at ? observed : at } : null;
    },
  );
  expect(await runtime.putFundingProof(funding, at)).toBe(true);
  const exposure = await f.runtime.exposure(at);
  if (!exposure) throw new Error("Synthetic control missing");
  const request: RuntimeRefresh = {
    id: crypto.randomUUID(),
    month: "2026-10",
    expectedControlRevision: exposure.control_revision,
    allocationVersion: exposure.allocation_version,
    allocationProofId: f.ap.id,
    pricingProofId: pricing.id,
    fundingProofId: funding.id,
  };
  return { pricing, funding, request, runtime };
}

async function heldFixture() {
  const f = await ready();
  f.db.sqlite
    .query("INSERT INTO v2_case_original_usage(workspace_id) VALUES(?)")
    .run(f.workspaceId);
  const core = fileStorageRequestCore(f.core, false);
  const service = createFilesService(core, {
    environment: "preview",
    bucket: r2().port,
    paidStorage: createFileStorageBudget(core, "preview", f.actor.ownerId, () => NOW),
    clock: () => NOW,
  });
  const upload = await service.reserve(f.actor.ownerId, f.workspaceId, 1, crypto.randomUUID(), {
    name: "합성.txt",
    mediaType: "text/plain",
    byteLength: 5,
    autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
  });
  await service.putPart(
    f.actor.ownerId,
    f.workspaceId,
    upload.fileId,
    upload.uploadSession,
    0,
    new Response("hello").body,
  );
  // Synthetic already-running job: refresh must preserve its opaque lease and state.
  f.db.sqlite
    .query(
      "INSERT INTO v2_jobs(id,operation_id,runtime_instance_id,workspace_id,target_kind,target_id,target_revision,kind,status,phase,lease_token,lease_until,created_at,updated_at) SELECT ?,operation_id,?,workspace_id,'file',id,revision,'file_processing','running','extracting','synthetic-running-lease',?,?,? FROM v2_files WHERE id=?",
    )
    .run(crypto.randomUUID(), crypto.randomUUID(), EXP, NOW, NOW, upload.fileId);
  const exposure = await f.runtime.exposure(NOW);
  if (!exposure) throw new Error("Synthetic control missing");
  expect(await f.runtime.freeze("2026-10", exposure.control_revision, 1, NOW)).toBe(true);
  return f;
}

test("same allocation resumes with real unresolved upload hold and running lease, preserving original proofs and counters", async () => {
  const f = await heldFixture(),
    o = await observation(f);
  const saved = Object.fromEntries(
    [
      "v2_jobs",
      "v2_cost_attempts",
      "v2_storage_paid_executions",
      "v2_runtime_proofs",
      "v2_budget_allocations",
      "v2_maintenance_exposure",
    ].map((table) => [table, f.db.sqlite.query(`SELECT * FROM ${table}`).all()]),
  );
  const before = await f.runtime.exposure(LATER);
  const projection = f.db.sqlite
    .query(
      "SELECT gets,heads,deletes,get_limit,head_limit,delete_limit FROM v2_storage_projections",
    )
    .get();
  const renew = createV2RuntimeRefreshRepository(f.core, "preview", verifier);
  expect(await renew.refresh(o.request, LATER)).toBe(true);
  const after = await f.runtime.exposure(LATER);
  expect(after?.phase).toBe("active");
  expect(after?.allocation_version).toBe(before?.allocation_version);
  expect(after?.reserved_krw).toBeGreaterThan(0);
  expect(after?.reserved_krw).toBe(before?.reserved_krw);
  expect(after?.ambiguous_krw).toBe(before?.ambiguous_krw);
  expect(after?.fixed_maintenance_krw).toBeGreaterThan(before?.fixed_maintenance_krw ?? 0);
  for (const table of [
    "v2_jobs",
    "v2_cost_attempts",
    "v2_storage_paid_executions",
    "v2_runtime_proofs",
    "v2_budget_allocations",
  ])
    expect(f.db.sqlite.query(`SELECT * FROM ${table}`).all()).toEqual(saved[table] ?? []);
  expect(f.db.sqlite.query("SELECT * FROM v2_maintenance_exposure").all()).toEqual(
    expect.arrayContaining(saved.v2_maintenance_exposure as unknown[]),
  );
  expect(
    f.db.sqlite
      .query(
        "SELECT gets,heads,deletes,get_limit,head_limit,delete_limit FROM v2_storage_projections",
      )
      .get(),
  ).toEqual(projection);
  const refreshed = f.db.sqlite.query("SELECT * FROM v2_runtime_refreshes").all();
  expect(refreshed).toHaveLength(1);
  expect(await renew.refresh(o.request, LATER)).toBe(true);
  expect(await f.runtime.exposure(LATER)).toEqual(after);
  expect(await renew.refresh({ ...o.request, fundingProofId: f.fp.id }, LATER)).toBe(false);
  const nextCore = fileStorageRequestCore(f.core, false);
  const nextService = createFilesService(nextCore, {
    environment: "preview",
    bucket: r2().port,
    clock: () => LATER,
    paidStorage: createFileStorageBudget(nextCore, "preview", f.actor.ownerId, () => LATER),
  });
  const row = f.db.sqlite
    .query("SELECT revision FROM v2_workspaces WHERE id=?")
    .get(f.workspaceId) as { revision: number };
  const upload = await nextService.reserve(
    f.actor.ownerId,
    f.workspaceId,
    row.revision,
    crypto.randomUUID(),
    {
      name: "다음 합성.txt",
      mediaType: "text/plain",
      byteLength: 5,
      autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
    },
  );
  await nextService.putPart(
    f.actor.ownerId,
    f.workspaceId,
    upload.fileId,
    upload.uploadSession,
    0,
    new Response("hello").body,
  );
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_cost_attempts").get()).toEqual({ n: 2 });
  expect(f.db.sqlite.query("SELECT * FROM v2_cost_attempts").all()).toEqual(
    expect.arrayContaining(saved.v2_cost_attempts as unknown[]),
  );
});

test("expired allocation authority can renew without editing its manifest or requiring outstanding costs to drain", async () => {
  const f = await fixture();
  const short = {
    ...f.ap,
    id: crypto.randomUUID(),
    allocation: { ...f.ap.allocation, validUntil: LATER, fundingValidUntil: LATER },
  };
  expect(await f.runtime.putAllocationProof(short, NOW)).toBe(true);
  f.db.sqlite
    .query("UPDATE v2_runtime_controls SET allocation_proof_id=?,phase='frozen'")
    .run(short.id);
  f.db.sqlite.exec("UPDATE v2_monthly_budget SET reserved_krw=100,ambiguous_krw=50");
  const at = "2026-10-06T00:03:00.000Z",
    o = await observation(f, at);
  o.request.allocationProofId = short.id;
  expect(await f.runtime.findProof(short.id, at)).toBeNull();
  expect(
    await createV2RuntimeRefreshRepository(f.core, "preview", verifier).refresh(o.request, at),
  ).toBe(true);
  const proof = await f.runtime.findProof(short.id, at);
  expect(proof?.payload).toEqual(short);
  expect(Date.parse(proof?.validUntil ?? "")).toBeGreaterThan(Date.parse(at));
  const predicate = budgetAdmissionPredicate({
    pricingProofId: o.pricing.id,
    fundingProofId: o.funding.id,
    pricingJson: JSON.stringify(pricingProofSchema.parse(o.pricing)),
    fundingJson: JSON.stringify(fundingProofSchema.parse(o.funding)),
    amount: 1,
    environment: "preview",
    now: at,
  });
  expect(
    await f.core.statement(`SELECT 1 WHERE ${predicate.sql}`, predicate.values).first(),
  ).not.toBeNull();
});

test.each([
  "revision",
  "allocation",
  "pending_reallocation",
  "funding",
  "integrity",
  "expiry",
  "unverified",
])(
  "refresh rejects %s without refund, activation or partial maintenance mutation",
  async (failure) => {
    const f = await heldFixture(),
      o = await observation(f);
    if (failure === "revision") o.request.expectedControlRevision++;
    if (failure === "allocation") o.request.allocationVersion++;
    if (failure === "pending_reallocation")
      f.db.sqlite.exec("UPDATE v2_runtime_controls SET pending_version=2");
    if (failure === "funding")
      f.db.sqlite.exec("UPDATE v2_monthly_budget SET ambiguous_krw=100000");
    if (failure === "integrity")
      f.db.sqlite.exec(
        "INSERT INTO v2_storage_integrity_faults VALUES('preview','synthetic-fault')",
      );
    const before = await f.runtime.exposure(LATER),
      prior = f.db.sqlite.query("SELECT * FROM v2_storage_projections").get();
    const renew = createV2RuntimeRefreshRepository(
      f.core,
      "preview",
      failure === "unverified" ? undefined : verifier,
    );
    expect(await renew.refresh(o.request, failure === "expiry" ? EXP : LATER)).toBe(false);
    expect(await f.runtime.exposure(LATER)).toEqual(before);
    expect(f.db.sqlite.query("SELECT * FROM v2_storage_projections").get()).toEqual(prior);
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_refreshes").get()).toEqual({
      n: 0,
    });
  },
);

test("a newer unavailable or expired funding observation cannot fall back during refresh or model proof selection", async () => {
  for (const state of ["unavailable", "expired"] as const) {
    const f = await fixture(),
      o = await observation(f);
    const stop = {
      ...o.funding,
      id: crypto.randomUUID(),
      state: state === "unavailable" ? ("unavailable" as const) : ("funded" as const),
      observedAt: "2026-10-06T00:03:00.000Z",
      validUntil: "2026-10-06T00:04:00.000Z",
    };
    expect(await o.runtime.putFundingProof(stop, stop.observedAt)).toBe(true);
    const at = "2026-10-06T00:05:00.000Z";
    expect(await readProcessingProofs(f.core, "preview", at, null)).toBeNull();
    expect(
      await createV2RuntimeRefreshRepository(f.core, "preview", verifier).refresh(o.request, at),
    ).toBe(false);
    expect((await f.runtime.exposure(at))?.reserved_krw).toBe(0);
  }
});

test("concurrent identical refreshes and a lost committed response produce one immutable receipt", async () => {
  const f = await fixture(),
    o = await observation(f);
  const renew = createV2RuntimeRefreshRepository(f.core, "preview", verifier);
  expect(
    await Promise.all([renew.refresh(o.request, LATER), renew.refresh(o.request, LATER)]),
  ).toEqual([true, true]);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_refreshes").get()).toEqual({ n: 1 });
  const wrapped = createV2Core(
    {
      prepare: (sql: string) => f.core.binding.prepare(sql),
      async batch(statements: D1PreparedStatement[]) {
        await f.core.binding.batch(statements);
        throw new Error("Synthetic response lost after commit");
      },
    } as unknown as D1Database,
    f.core.cipher,
  );
  const current = await f.runtime.exposure(LATER);
  if (!current) throw new Error("Synthetic control missing");
  const retry = {
    ...o.request,
    id: crypto.randomUUID(),
    expectedControlRevision: current.control_revision,
  };
  await expect(
    createV2RuntimeRefreshRepository(wrapped, "preview", verifier).refresh(retry, LATER),
  ).rejects.toThrow("DB_OPERATION_FAILED");
  expect(await renew.refresh(retry, LATER)).toBe(true);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_refreshes").get()).toEqual({ n: 2 });
  expect(await renew.refresh(retry, "2026-11-01T00:00:00.000Z")).toBe(true);
  expect(
    await renew.refresh({ ...retry, id: crypto.randomUUID() }, "2026-11-01T00:00:00.000Z"),
  ).toBe(false);
});

test("a concurrent funding stop after verification wins the final CAS without partial renewal", async () => {
  const f = await heldFixture(),
    o = await observation(f);
  const before = await f.runtime.exposure(LATER);
  const renew = createV2RuntimeRefreshRepository(
    f.core,
    "preview",
    async (kind, payload, digest) => {
      expect(
        await o.runtime.putFundingProof(
          { ...o.funding, id: "zz-stop-during-refresh", state: "unavailable" },
          LATER,
        ),
      ).toBe(true);
      return verifier(kind, payload, digest);
    },
  );
  expect(await renew.refresh(o.request, LATER)).toBe(false);
  expect(await f.runtime.exposure(LATER)).toEqual(before);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_refreshes").get()).toEqual({ n: 0 });
});

test("final activation failure rolls back receipt, renewed projection and additional maintenance together", async () => {
  const f = await heldFixture(),
    o = await observation(f);
  const before = await f.runtime.exposure(LATER),
    projection = f.db.sqlite.query("SELECT * FROM v2_storage_projections").get();
  const maintenance = f.db.sqlite.query("SELECT * FROM v2_maintenance_exposure").all();
  f.db.sqlite.exec(
    "CREATE TRIGGER synthetic_refresh_failure BEFORE UPDATE OF phase ON v2_runtime_controls WHEN NEW.phase='active' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_REFRESH_FAILURE'); END",
  );
  await expect(
    createV2RuntimeRefreshRepository(f.core, "preview", verifier).refresh(o.request, LATER),
  ).rejects.toThrow("DB_OPERATION_FAILED");
  expect(await f.runtime.exposure(LATER)).toEqual(before);
  expect(f.db.sqlite.query("SELECT * FROM v2_storage_projections").get()).toEqual(projection);
  expect(f.db.sqlite.query("SELECT * FROM v2_maintenance_exposure").all()).toEqual(maintenance);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_refreshes").get()).toEqual({ n: 0 });
});

test("cost operations are manual and operator-scoped, with observations passed as data", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(".github/workflows/cost-operations.yml").text(),
  ) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: {
      operations: {
        if: string;
        environment: { deployment: boolean };
        steps: { run?: string; env?: Record<string, string> }[];
      };
    };
  };
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.jobs.operations.if).toContain("github.actor == 'hyunhomon'");
  expect(workflow.jobs.operations.if).toContain("github.actor == 'hwangeunchan'");
  expect(workflow.jobs.operations.if).toContain("github.ref == 'refs/heads/main'");
  expect(workflow.jobs.operations.environment.deployment).toBe(false);
  const step = workflow.jobs.operations.steps.find((s) =>
    s.run?.includes("scripts/provision-ai-budget.ts"),
  );
  expect(step?.env?.AI_RUNTIME_OBSERVATION_JSON).toBe("$" + "{{ inputs.observation_json }}");
  expect(step?.run).not.toContain("inputs.observation_json");
});
