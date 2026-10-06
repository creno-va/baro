import { expect, test } from "bun:test";
import type {
  ExecutionPlan,
  FundingProof,
  PricingProof,
  UsageReceipt,
} from "../src/server/modules/budget/contracts";
import { decimal, krwCeiling } from "../src/server/modules/budget/money";
import {
  assessReceipt,
  BudgetError,
  budgetState,
  calculateQuote,
  createBudgetService,
} from "../src/server/modules/budget/service";

const NOW = "2026-10-05T14:59:59.999Z";
const START = "2026-10-01T00:00:00.000Z";
const END = "2026-10-06T00:00:00.000Z";
function proofs(): { pricing: PricingProof; funding: FundingProof; plan: ExecutionPlan } {
  return {
    pricing: {
      modelBillingPolicy: null,
      id: crypto.randomUUID(),
      version: 1,
      environment: "preview",
      checkedAt: START,
      validUntil: END,
      prices: [
        {
          sku: "asr_seconds",
          modelRates: null,
          provider: "cloudflare",
          model: "@cf/openai/whisper-large-v3-turbo",
          region: "global",
          plan: "verified-test-plan",
          billingMode: "metered",
          unit: "seconds",
          unitSize: "60",
          usdPerUnit: "0.006",
          billingQuantum: "0.1",
          officialUrl: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
          checkedAt: START,
          validUntil: END,
        },
      ],
      fx: {
        krwPerUsd: "1375.25",
        authority: "synthetic verified FX evidence",
        referenceUrl: "https://www.bok.or.kr/",
        asOf: START,
        checkedAt: START,
        validUntil: END,
      },
      taxRatio: "0.1",
      feeRatio: "0.03",
      safetyMarginRatio: "0.125",
      hiddenAttemptMultiplier: 1,
      hiddenRetryReference: "synthetic verified retry-off receipt",
    },
    funding: {
      id: crypto.randomUUID(),
      environment: "preview",
      state: "funded",
      existingPaymentPath: true,
      autoRecharge: false,
      spendAllowanceKrw: 1000000,
      reference: "synthetic funding evidence",
      observedAt: START,
      validUntil: END,
    },
    plan: {
      operationId: crypto.randomUUID(),
      operationRevision: 1,
      requestHash: "a".repeat(64),
      invocationId: crypto.randomUUID(),
      maximumAttempts: 3,
      deadlineAt: new Date(Date.parse(NOW) + 60000).toISOString(),
      quantities: [{ sku: "asr_seconds", maximumQuantity: "60" }],
    },
  };
}
async function quote(overrides: Partial<ReturnType<typeof proofs>> = {}) {
  return calculateQuote({ environment: "preview", now: NOW, ...proofs(), ...overrides });
}
function firstPrice(value: ReturnType<typeof proofs>) {
  const price = value.pricing.prices[0];
  if (!price) throw new Error("Synthetic price fixture is missing");
  return price;
}
function firstQuantity(plan: ExecutionPlan) {
  const quantity = plan.quantities[0];
  if (!quantity) throw new Error("Synthetic quantity fixture is missing");
  return quantity;
}
function receipt(
  hold: Awaited<ReturnType<typeof quote>>,
  attemptId: string,
  overrides: Partial<UsageReceipt> = {},
): UsageReceipt {
  return {
    id: crypto.randomUUID(),
    attemptId,
    invocationId: hold.plan.invocationId,
    providerRequestId: "synthetic-provider-receipt",
    observedAt: NOW,
    transport: "response",
    definitiveNoCharge: false,
    meteringComplete: true,
    quantities: [{ sku: "asr_seconds", quantity: "0.5" }],
    chargedUsd: null,
    dispatchToken: null,
    modelTokenDetails: null,
    ...overrides,
  };
}
test("quote reserves exact decimal FX/tax/fees/margin/hidden retries and binds immutable proof/footprint", async () => {
  const value = proofs();
  // 0.006 * 1375.25 * 1.1 * 1.03 * 1.125 = 10.517868... -> 11 KRW.
  const first = await quote(value);
  expect(first.quote.estimatedKrw).toBe(11);
  expect(first.maximumInvocationKrw).toBe(33);
  value.pricing.hiddenAttemptMultiplier = 2;
  const second = await quote(value);
  expect(second.quote.estimatedKrw).toBe(22);
  expect(second.proofHash).not.toBe(first.proofHash);
  firstQuantity(value.plan).maximumQuantity = "0.5";
  const fractional = await quote(value);
  expect(fractional.quote.estimatedKrw).toBe(1);
  expect(firstQuantity(first.plan).maximumQuantity).toBe("60");
  expect(first.quote.validUntil).toBe(value.plan.deadlineAt);
});
test("money ceilings never under-reserve a representable decimal just above an integer", () => {
  expect(krwCeiling(decimal("1.000000000001"), "1", [])).toBe(2);
  expect(krwCeiling(decimal("1"), "1", [])).toBe(1);
  expect(krwCeiling(decimal("0.000000000001"), "1", [])).toBe(1);
  expect(() => krwCeiling(decimal("999999999999999999"), "100000", [])).toThrow();
});
test("quote fails closed for missing/stale/wrong environment/zero-price/new-model/new-payment proofs", async () => {
  const changes: ((value: ReturnType<typeof proofs>) => void)[] = [
    (v) => {
      v.pricing.fx.validUntil = NOW;
    },
    (v) => {
      v.pricing.fx.checkedAt = END;
    },
    (v) => {
      v.pricing.fx.asOf = END;
    },
    (v) => {
      v.pricing.fx.referenceUrl = "https://user:private@www.bok.or.kr/";
    },
    (v) => {
      v.pricing.fx.referenceUrl = "https://www.bok.or.kr/?token=private";
    },
    (v) => {
      v.funding.validUntil = NOW;
    },
    (v) => {
      v.funding.environment = "production";
    },
    (v) => {
      v.funding.state = "unavailable";
    },
    (v) => {
      v.funding.spendAllowanceKrw = 0;
    },
    (v) => {
      firstPrice(v).usdPerUnit = "0";
    },
    (v) => {
      firstPrice(v).billingMode = "verified_free";
      firstPrice(v).usdPerUnit = "0";
    },
    (v) => {
      firstPrice(v).validUntil = NOW;
    },
    (v) => {
      firstPrice(v).unit = "tokens";
    },
    (v) => {
      firstPrice(v).officialUrl = "https://attacker.example/prices";
    },
    (v) => {
      v.plan.deadlineAt = NOW;
    },
    (v) => {
      firstQuantity(v.plan).sku = "model_input_tokens";
    },
  ];
  for (const change of changes) {
    const value = proofs();
    change(value);
    await expect(quote(value)).rejects.toBeInstanceOf(BudgetError);
  }
  for (const funding of [
    { ...proofs().funding, autoRecharge: true },
    { ...proofs().funding, existingPaymentPath: false },
    { ...proofs().funding, role: "admin" },
  ])
    await expect(quote({ funding: funding as FundingProof })).rejects.toMatchObject({
      code: "BUDGET_UNAVAILABLE",
    });
  const value = proofs();
  firstPrice(value).model = "unapproved/model" as never;
  await expect(quote(value)).rejects.toMatchObject({ code: "BUDGET_UNAVAILABLE" });
  await expect(
    calculateQuote({ environment: "preview", now: NOW, pricing: null, funding: null, plan: null }),
  ).rejects.toBeInstanceOf(BudgetError);
});
test("bounded invocation cost cannot exceed funding or the authorized global technical budget", async () => {
  const value = proofs();
  value.funding.spendAllowanceKrw = 32;
  await expect(quote(value)).rejects.toBeInstanceOf(BudgetError);
  const expensive = proofs();
  firstPrice(expensive).usdPerUnit = "1000";
  await expect(quote(expensive)).rejects.toBeInstanceOf(BudgetError);
});
test("refusal/malformed output transport still settles actual scalar usage before output validation", async () => {
  const hold = await quote();
  const attemptId = crypto.randomUUID();
  const result = assessReceipt(hold, attemptId, receipt(hold, attemptId));
  expect(result.outcome).toBe("settled");
  expect(result.chargedKrw).toBe(1);
  const zero = assessReceipt(
    hold,
    attemptId,
    receipt(hold, attemptId, { quantities: [{ sku: "asr_seconds", quantity: "0" }] }),
  );
  expect(zero.outcome).toBe("settled");
  expect(zero.chargedKrw).toBe(0);
  const overrun = assessReceipt(hold, attemptId, receipt(hold, attemptId, { chargedUsd: "1000" }));
  expect(overrun.chargedKrw).toBe(1558159);
  expect(overrun.chargedKrw).toBeGreaterThan(1000000);
});
test("unknown/partial usage retains exposure while only definitively unsent requests release", async () => {
  const hold = await quote();
  const id = crypto.randomUUID();
  for (const patch of [
    { transport: "unknown" as const },
    { meteringComplete: false },
    { quantities: [] },
    { transport: "provider_error" as const, quantities: [] },
  ]) {
    const result = assessReceipt(hold, id, receipt(hold, id, patch));
    expect(result.outcome).toBe("ambiguous");
    expect(result.chargedKrw).toBeNull();
  }
  const released = assessReceipt(
    hold,
    id,
    receipt(hold, id, {
      transport: "not_sent",
      definitiveNoCharge: true,
      quantities: [],
      providerRequestId: null,
    }),
  );
  expect(released.outcome).toBe("release_candidate");
  expect(released.chargedKrw).toBeNull();
  expect(() => assessReceipt(hold, id, receipt(hold, id, { definitiveNoCharge: true }))).toThrow(
    BudgetError,
  );
  expect(() =>
    assessReceipt(hold, id, receipt(hold, id, { attemptId: crypto.randomUUID() })),
  ).toThrow(BudgetError);
  expect(() =>
    assessReceipt(hold, id, receipt(hold, id, { invocationId: crypto.randomUUID() })),
  ).toThrow(BudgetError);
  expect(() => assessReceipt(hold, id, { ...receipt(hold, id), rawResponse: "private" })).toThrow(
    BudgetError,
  );
});
test("expired/next-month late receipts use original FX/proof and preserve actual overrun", async () => {
  const hold = await quote();
  const id = crypto.randomUUID();
  const result = assessReceipt(
    hold,
    id,
    receipt(hold, id, { observedAt: "2026-11-02T00:00:00.000Z", chargedUsd: "1" }),
  );
  expect(result.outcome).toBe("settled");
  expect(result.chargedKrw).toBe(1559);
});
test("service awaits durable receipt before resolving and persistence failure closes execution", async () => {
  const value = proofs();
  const events: string[] = [];
  const service = createBudgetService({
    environment: "preview",
    clock: () => NOW,
    proofs: async () => value,
    persistQuote: async () => {
      events.push("quote-persisted");
      return true;
    },
    recordUsage: async () => {
      await Promise.resolve();
      events.push("receipt-persisted");
      return true;
    },
  });
  const hold = await service.quote(value.plan);
  const id = crypto.randomUUID();
  await service.receipt(hold, id, receipt(hold, id));
  events.push("caller-output-validation");
  expect(events).toEqual(["quote-persisted", "receipt-persisted", "caller-output-validation"]);
  const closed = createBudgetService({
    environment: "preview",
    proofs: async () => null,
    persistQuote: async () => {
      throw new Error("must not persist");
    },
    recordUsage: async () => false,
  });
  await expect(closed.quote(value.plan)).rejects.toMatchObject({ code: "BUDGET_UNAVAILABLE" });
  await expect(closed.receipt(hold, id, receipt(hold, id))).rejects.toMatchObject({
    code: "BUDGET_UNAVAILABLE",
  });
});
test("environment-local circuit snapshots include ambiguity/fixed maintenance and are not global ledgers", () => {
  const ledger = {
    month: "2026-10",
    environment: "preview",
    allocationVersion: 1,
    allocatedLimitKrw: 100,
    settledKrw: 40,
    reservedKrw: 20,
    ambiguousKrw: 10,
    fixedAndMaintenanceKrw: 0,
    availableKrw: 30,
  };
  const expected = { environment: "preview" as const, month: "2026-10" };
  expect(budgetState(ledger, expected).state).toBe("warning");
  expect(
    budgetState({ ...ledger, fixedAndMaintenanceKrw: 15, availableKrw: 15 }, expected).state,
  ).toBe("restricted");
  expect(
    budgetState({ ...ledger, fixedAndMaintenanceKrw: 20, availableKrw: 10 }, expected).state,
  ).toBe("stop_high_cost");
  expect(budgetState({ ...ledger, settledKrw: 1000001, availableKrw: 0 }, expected).state).toBe(
    "closed",
  );
  for (const patch of [
    { allocationVersion: null },
    { environment: "production" },
    { month: "2026-11" },
    { availableKrw: 100 },
  ])
    expect(budgetState({ ...ledger, ...patch }, expected).state).toBe("unavailable");
});
