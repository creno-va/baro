import { afterEach, expect, test } from "bun:test";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { assessReceipt, calculateQuote } from "../src/server/modules/budget/service";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-31T14:59:59.999Z";
const START = "2026-10-01T00:00:00.000Z";
const END = "2026-11-02T00:00:00.000Z";
const HASH = "a".repeat(64);
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
async function fixture() {
  const database = await createTestDatabase();
  databases.push(database);
  const owner = await seedTestSession(database);
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("s".repeat(32)).replace(/=+$/, ""),
  });
  const core = createV2Core(database.binding, cipher);
  const accounting = createV2AccountingRepository(core, "preview");
  const actor = { ownerId: owner.userId, now: NOW };
  await accounting.ensurePrincipal(actor);
  const allocation = {
    month: "2026-10",
    version: 1,
    previewKrw: 3,
    productionKrw: 0,
    sharedFixedKrw: 0,
    maintenanceReserveKrw: 0,
    pricingProvenance: "synthetic-test-price",
    fxProvenance: "synthetic-test-FX",
    fundingProvenance: "synthetic-test-funding",
    reviewedAt: START,
    validUntil: END,
    fundingState: "funded" as const,
    fundingValidUntil: END,
    manifestHash: HASH,
  };
  expect(await accounting.recordAllocation(allocation)).toBe(true);
  for (const environment of ["preview", "production"] as const)
    expect(
      await accounting.recordAllocationAcknowledgment({
        month: "2026-10",
        version: 1,
        environment,
        manifestHash: HASH,
        drainReceiptId: crypto.randomUUID(),
        now: NOW,
      }),
    ).toBe(true);
  expect(await accounting.activateAllocation("2026-10", 1, NOW)).toBe(true);
  const operationId = crypto.randomUUID();
  const created = await createV2WorkspaceRepository(database.binding, cipher).create(
    actor,
    crypto.randomUUID(),
    {
      narrative: "별도 실제 비용 정산과 logical quota 경계를 검증하는 합성 사건입니다.",
      subjectContext: "individual",
      jurisdiction: "KR",
      turnstileToken: "synthetic-token",
    },
    { operationId, key: crypto.randomUUID(), requestHash: HASH },
  );
  expect(created.kind).toBe("created");
  async function hold(invocationId = crypto.randomUUID()) {
    const value = await calculateQuote({
      environment: "preview",
      now: NOW,
      pricing: {
        id: crypto.randomUUID(),
        version: 1,
        environment: "preview",
        checkedAt: START,
        validUntil: END,
        prices: [
          {
            sku: "asr_seconds",
            provider: "cloudflare",
            model: "@cf/openai/whisper-large-v3-turbo",
            region: "global",
            plan: "synthetic-plan",
            billingMode: "metered",
            unit: "seconds",
            unitSize: "1",
            usdPerUnit: "0.0001",
            billingQuantum: "0.1",
            officialUrl: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
            checkedAt: START,
            validUntil: END,
          },
        ],
        fx: {
          krwPerUsd: "1375.25",
          authority: "synthetic FX",
          referenceUrl: "https://www.bok.or.kr/",
          asOf: START,
          checkedAt: START,
          validUntil: END,
        },
        taxRatio: "0",
        feeRatio: "0",
        safetyMarginRatio: "0.1",
        hiddenAttemptMultiplier: 1,
        hiddenRetryReference: "synthetic test retry bound",
      },
      funding: {
        id: crypto.randomUUID(),
        environment: "preview",
        state: "funded",
        existingPaymentPath: true,
        autoRecharge: false,
        spendAllowanceKrw: 3,
        reference: "synthetic funding",
        observedAt: START,
        validUntil: END,
      },
      plan: {
        operationId,
        operationRevision: 1,
        requestHash: HASH,
        invocationId,
        maximumAttempts: 1,
        deadlineAt: new Date(Date.parse(NOW) + 60000).toISOString(),
        quantities: [{ sku: "asr_seconds", maximumQuantity: "0.5" }],
      },
    });
    // Existing summary-quote DAL integration only; durable proof storage and
    // atomic job+cost dispatch are #87 and are not claimed by this test.
    await accounting.putQuote(value.quote);
    const attempt = {
      id: crypto.randomUUID(),
      operationId,
      invocationId,
      attempt: 1,
      quoteId: value.quote.id,
      service: "asr" as const,
      state: "reserved" as const,
      reservedKrw: value.quote.estimatedKrw,
      chargedKrw: null,
      createdAt: NOW,
    };
    return { value, attempt };
  }
  return { database, accounting, actor, hold };
}
test("calculated cost holds contend atomically and duplicate invocation cannot charge twice", async () => {
  const f = await fixture();
  const candidates = await Promise.all(Array.from({ length: 8 }, () => f.hold()));
  const results = await Promise.all(
    candidates.map(({ attempt }) => f.accounting.reserveCost(f.actor, attempt)),
  );
  expect(results.filter(Boolean)).toHaveLength(3);
  expect((await f.accounting.budget(NOW)).reservedKrw).toBe(3);
  const winner = candidates[results.indexOf(true)];
  if (!winner) throw new Error("Missing synthetic winner");
  expect(
    await f.accounting.reserveCost(f.actor, { ...winner.attempt, id: crypto.randomUUID() }),
  ).toBe(false);
  expect((await f.accounting.usage(f.actor)).newCases.used).toBe(1);
});
test("unknown cost never TTL-refunds; late next-month receipt settles original month after account deletion", async () => {
  const f = await fixture();
  const { value, attempt } = await f.hold();
  expect(await f.accounting.reserveCost(f.actor, attempt)).toBe(true);
  const unknown = assessReceipt(value, attempt.id, {
    id: crypto.randomUUID(),
    attemptId: attempt.id,
    invocationId: attempt.invocationId,
    providerRequestId: null,
    observedAt: NOW,
    transport: "unknown",
    definitiveNoCharge: false,
    meteringComplete: false,
    quantities: [],
    chargedUsd: null,
    dispatchToken: null,
    modelTokenDetails: null,
  });
  if (unknown.outcome !== "ambiguous") throw new Error("Synthetic unknown must retain exposure");
  expect(await f.accounting.settleCost(attempt.id, unknown.outcome, unknown.chargedKrw)).toBe(true);
  expect(await f.accounting.settleCost(attempt.id, "released", null)).toBe(false);
  f.database.sqlite.query("DELETE FROM user WHERE id=?").run(f.actor.ownerId);
  const late = assessReceipt(value, attempt.id, {
    id: crypto.randomUUID(),
    attemptId: attempt.id,
    invocationId: attempt.invocationId,
    providerRequestId: "synthetic-provider-meter",
    dispatchToken: null,
    modelTokenDetails: null,
    observedAt: END,
    transport: "response",
    definitiveNoCharge: false,
    meteringComplete: false,
    quantities: [],
    chargedUsd: "1",
  });
  if (late.outcome !== "settled") throw new Error("Synthetic exact bill must settle");
  expect(late.chargedKrw).toBe(1376);
  const settlements = await Promise.all(
    Array.from({ length: 5 }, () =>
      f.accounting.settleCost(attempt.id, late.outcome, late.chargedKrw),
    ),
  );
  expect(settlements.filter(Boolean)).toHaveLength(1);
  const october = await f.accounting.budget(NOW);
  expect(october.settledKrw).toBe(1376);
  expect(october.ambiguousKrw).toBe(0);
  expect(october.availableKrw).toBe(0);
  expect((await f.accounting.budget("2026-10-31T15:00:00.000Z")).settledKrw).toBe(0);
});
test("SQL receipt failure rolls all transitions back, and actual retry attempts retain separate costs", async () => {
  const f = await fixture();
  const first = await f.hold();
  expect(await f.accounting.reserveCost(f.actor, first.attempt)).toBe(true);
  f.database.sqlite.exec(
    "CREATE TRIGGER synthetic_settlement_failure BEFORE UPDATE ON v2_cost_attempts WHEN NEW.state='settled' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;",
  );
  await expect(f.accounting.settleCost(first.attempt.id, "settled", 1)).rejects.toThrow();
  expect((await f.accounting.budget(NOW)).reservedKrw).toBe(1);
  expect(f.database.sqlite.query("SELECT count(*) AS n FROM v2_cost_receipts").get()).toEqual({
    n: 0,
  });
  f.database.sqlite.exec("DROP TRIGGER synthetic_settlement_failure");
  expect(await f.accounting.settleCost(first.attempt.id, "settled", 1)).toBe(true);
  const second = await f.hold(first.attempt.invocationId);
  expect(await f.accounting.reserveCost(f.actor, { ...second.attempt, attempt: 2 })).toBe(true);
  expect(await f.accounting.settleCost(second.attempt.id, "settled", 1)).toBe(true);
  expect((await f.accounting.budget(NOW)).settledKrw).toBe(2);
  expect((await f.accounting.usage(f.actor)).newCases.used).toBe(1);
});
