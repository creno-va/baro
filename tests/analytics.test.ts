import { expect, test } from "bun:test";
import { type AnalyticsEvent, analyticsEventSchema } from "../src/contracts/analytics";
import { api } from "../src/server/api";
import {
  aggregateMetrics,
  createAnalyticsSdk,
  durationBucket,
  resultVisibilityTracker,
} from "../src/server/modules/analytics/sdk";
import { admitCase, domainRepository } from "../src/server/modules/intake/service";
import { syntheticWorkflow } from "./adapters/analysis-pipeline";
import { syntheticAnalyticsAdapter } from "./adapters/analytics";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const anonymousUserId = crypto.randomUUID(),
  sessionId = crypto.randomUUID(),
  flowId = crypto.randomUUID();
function event(name: string, properties: Record<string, unknown> = {}) {
  return {
    name,
    eventId: crypto.randomUUID(),
    flowId,
    eventVersion: "1",
    occurredAt: "2026-10-05T00:00:00.000Z",
    environment: "production",
    release: "local",
    anonymousUserId,
    sessionId,
    ...properties,
  };
}
test("opt-in precedes adapter work; strict allowlist/dedup/opt-out, no raw strings", async () => {
  const adapter = syntheticAnalyticsAdapter(),
    sdk = createAnalyticsSdk(adapter),
    input = event("case_input_viewed", { entryPoint: "direct" });
  expect(await sdk.track(input)).toBe(false);
  expect(adapter.events()).toEqual([]);
  sdk.optIn();
  expect(await sdk.track(input)).toBe(true);
  expect(await sdk.track(input)).toBe(false);
  for (const field of [
    "narrative",
    "email",
    "token",
    "sql",
    "prompt",
    "title",
    "answer",
    "url",
    "userId",
    "caseId",
    "analysisId",
  ]) {
    expect(
      await sdk.track({
        ...input,
        eventId: crypto.randomUUID(),
        [field]: "synthetic-private-sentinel",
      }),
    ).toBe(false);
  }
  expect(
    await sdk.track(
      event("analysis_failed", {
        analysisIdHash: "a".repeat(64),
        retryable: true,
        errorCategory: "arbitrary error stack",
      }),
    ),
  ).toBe(false);
  const view = event("result_viewed", { analysisIdHash: "a".repeat(64) });
  expect(await sdk.track(view)).toBe(true);
  expect(await sdk.track({ ...view, eventId: crypto.randomUUID() })).toBe(false);
  sdk.optOut();
  expect(adapter.events()).toEqual([]);
  expect(await sdk.track(input)).toBe(false);
});
test("50% continuous one-second visibility, hidden/reset and one view only", () => {
  let views = 0;
  const tracker = resultVisibilityTracker(() => views++);
  tracker.observe(0.49, true, 0);
  tracker.observe(0.5, true, 2000);
  tracker.observe(0.5, true, 2999);
  expect(views).toBe(0);
  tracker.observe(0.9, false, 3000);
  tracker.observe(0.8, true, 4000);
  tracker.observe(0.8, true, 5000);
  expect(views).toBe(1);
  tracker.observe(1, true, 9000);
  expect(views).toBe(1);
});
test("late adapter completion after opt-out removes only the old event, not a new consent cohort", async () => {
  const retained = new Map<string, AnalyticsEvent>();
  let release: () => void = () => {},
    first = true;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sdk = createAnalyticsSdk({
    async send(value) {
      if (first) {
        first = false;
        await wait;
      }
      retained.set(value.eventId, value);
    },
    clear(eventId) {
      if (eventId) retained.delete(eventId);
      else retained.clear();
    },
  });
  sdk.optIn();
  const old = sdk.track(event("case_input_viewed"));
  sdk.optOut();
  sdk.optIn();
  const fresh = event("case_input_viewed");
  expect(await sdk.track(fresh)).toBe(true);
  release();
  expect(await old).toBe(false);
  expect([...retained.keys()]).toEqual([fresh.eventId]);
});
test("admissions denominator, opt-in cohort, first flow timestamp differences/p75 and unknown", () => {
  const events: unknown[] = [];
  for (let i = 0; i < 4; i++) {
    const id = String(i).repeat(64),
      flow = crypto.randomUUID(),
      base = { flowId: flow, anonymousUserId: crypto.randomUUID() };
    const started = Date.parse("2026-10-05T00:00:00.000Z") + i * 600000;
    events.push(
      event("case_input_viewed", { ...base, occurredAt: new Date(started).toISOString() }),
      event("case_input_viewed", { ...base, occurredAt: new Date(started + 1000).toISOString() }),
      event("case_submitted", {
        ...base,
        caseIdHash: id,
        analysisIdHash: id,
        narrativeLengthBucket: "20_100",
      }),
    );
    if (i < 3)
      events.push(
        event("result_viewed", {
          ...base,
          analysisIdHash: id,
          occurredAt: new Date(started + ([180000, 60000, 120000][i] ?? 0)).toISOString(),
        }),
        event("evidence_checked", { ...base, analysisIdHash: id, itemIndex: 0, checked: true }),
      );
  }
  const yes = event("trust_answered", { helpful: "yes" }),
    no = event("trust_answered", { helpful: "no" });
  events.push(
    yes,
    yes,
    no,
    event("case_submitted", {
      environment: "preview",
      caseIdHash: "f".repeat(64),
      analysisIdHash: "f".repeat(64),
      narrativeLengthBucket: "20_100",
    }),
  );
  const metrics = aggregateMetrics(events, true);
  expect(metrics.admissions).toBe(4);
  expect(metrics.views).toBe(3);
  expect(metrics.analysisViewRate).toBe(0.75);
  expect(metrics.helpfulRate).toBe(0.5);
  expect(metrics.completionP75Ms).toBe(180000);
  expect(metrics.actionRate).toBe(1);
  const unknown = aggregateMetrics([], false);
  expect(unknown.admissions).toBeNull();
  expect(unknown.analysisViewRate).toBeNull();
  expect(unknown.completionP75Ms).toBeNull();
  expect(JSON.stringify(metrics)).not.toContain(flowId);
  expect(JSON.stringify(metrics)).not.toContain("analysisIdHash");
  expect([59999, 60000, 180000, 300000, 600000].map(durationBucket)).toEqual([
    "under_1m",
    "under_3m",
    "under_5m",
    "under_10m",
    "over_10m",
  ]);
});
test("all P0 events accept bounded data, unknown fields and duplicate semantic views reject", () => {
  const hash = "a".repeat(64),
    common = { caseIdHash: hash, analysisIdHash: hash };
  const extras: Record<string, Record<string, unknown>> = {
    case_input_viewed: {},
    case_submitted: { narrativeLengthBucket: "20_100" },
    clarification_viewed: { questionCount: 2 },
    clarification_completed: { questionCount: 2, unknownCount: 1 },
    analysis_started: {},
    analysis_completed: {},
    analysis_failed: { retryable: true, errorCategory: "model" },
    result_viewed: {},
    evidence_checked: { itemIndex: 0, checked: true },
    citation_opened: { itemIndex: 0, sourceType: "statute" },
    case_revisited: { daysSinceCreationBucket: "1_7" },
    trust_answered: { helpful: "yes" },
    case_deleted: {},
    account_deleted: {},
  };
  for (const [name, fields] of Object.entries(extras)) {
    expect(analyticsEventSchema.safeParse(event(name, { ...common, ...fields })).success).toBe(
      true,
    );
  }
  expect(
    analyticsEventSchema.safeParse(
      event("clarification_completed", { questionCount: 6, unknownCount: 0 }),
    ).success,
  ).toBe(false);
});
test("helpful PUT is optional boolean, real owner/session/origin gate, idempotent and deletion-safe", async () => {
  const db = await createTestDatabase();
  try {
    const owner = await seedTestSession(db, { consent: true }),
      other = await seedTestSession(db, { consent: true });
    const env = {
      ...owner.env,
      CASE_DATA_KEY_V1: btoa("x".repeat(32)).replace(/=+$/, ""),
      ANALYSIS_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
    } as Env;
    env.ANALYSIS_WORKFLOW = await syntheticWorkflow(env);
    const admitted = await admitCase(
      env,
      owner.userId,
      crypto.randomUUID(),
      {
        narrative: "합성 사용자 A는 지인에게 금전을 대여했다고 진술했습니다.",
        turnstileToken: "synthetic",
      },
      new Date().toISOString(),
      async () => true,
    );
    if (admitted.kind !== "created") throw new Error("fixture");
    const repo = await domainRepository(env);
    const guard = {
      ownerId: owner.userId,
      caseId: admitted.response.caseId,
      analysisId: admitted.response.analysisId,
      inputRevision: 1,
      attempt: 1,
      expectedStatus: "queued" as const,
    };
    const path = `/cases/${guard.caseId}/feedback`,
      put = (body: unknown, cookie = owner.cookie, origin = env.BETTER_AUTH_URL) =>
        api.request(
          path,
          {
            method: "PUT",
            headers: { cookie, origin, "content-type": "application/json" },
            body: JSON.stringify(body),
          },
          env,
        );
    expect((await put({ helpful: true }, "")).status).toBe(401);
    expect((await put({ helpful: true }, other.cookie)).status).toBe(404);
    expect((await put({ helpful: true }, owner.cookie, "https://evil.example")).status).toBe(403);
    expect((await put({ helpful: true, comment: "private" })).status).toBe(400);
    expect((await put({ helpful: "yes" })).status).toBe(400);
    expect((await put({ helpful: true })).status).toBe(409);
    // Existing validated fixture is stored via guarded state transitions, without model/provider calls.
    const { guidance } = await import("./fixtures/contracts");
    for (const status of ["retrieving", "generating", "validating"] as const) {
      await repo.compareAndSetAnalysis(guard, { status }, new Date().toISOString());
      Object.assign(guard, { expectedStatus: status });
    }
    await repo.compareAndSetAnalysis(
      guard,
      { status: "completed", result: guidance },
      new Date().toISOString(),
    );
    const responses = await Promise.all([put({ helpful: true }), put({ helpful: true })]);
    expect(responses.map((r) => r.status)).toEqual([204, 204]);
    expect(db.sqlite.query("SELECT count(*) AS n FROM case_feedback").get()).toEqual({ n: 1 });
    expect((await put({ helpful: false })).status).toBe(204);
    expect(db.sqlite.query("SELECT helpful FROM case_feedback").get()).toEqual({ helpful: 0 });
    await repo.deleteOwnedCase(
      owner.userId,
      guard.caseId,
      crypto.randomUUID(),
      new Date().toISOString(),
    );
    expect((await put({ helpful: true })).status).toBe(404);
    expect(db.sqlite.query("SELECT * FROM case_feedback").all()).toEqual([]);
  } finally {
    db.close();
  }
});
