import { expect, test } from "bun:test";
import { createJsonRequester } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { EXPECTED_OWNER_HEADER } from "@baro/contracts/session";
import { Hono } from "hono";
import { createPrecedentsModel } from "../apps/mobile/src/features/precedents/model";
import type { SessionState } from "../apps/mobile/src/features/session/model";
import { createMobilePrecedents } from "../apps/mobile/src/platform/precedents";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createPrecedentsApi } from "../src/server/api/v2/precedents";
import { createPrecedentResearchService } from "../src/server/modules/legal-retrieval/research/service";
import precedents from "./fixtures/legal/v2/precedents.json";
import {
  confirmCustomerSummary,
  customerWorkspaceFixture,
  runCustomerJob,
} from "./helpers/customer-workspace";
import { seedTestSession } from "./helpers/session";

async function settled() {
  for (let i = 0; i < 500; i++) await Promise.resolve();
}
test("native context/search/signed read traverses real Hono/SQL with fixed owner and public topics only", async () => {
  const f = await customerWorkspaceFixture(new Date().toISOString());
  try {
    await runCustomerJob(f, "intake_questions");
    const intake = await f.service.intake(f.owner.userId, f.workspace.id);
    if (!intake) throw new Error("MISSING_SYNTHETIC_INTAKE");
    await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
      expectedRevision: intake.revision,
      answers: intake.batches[0]?.questions.map((q) => ({ questionId: q.id, status: "unknown" })),
    });
    await runCustomerJob(f, "intake_summary");
    await confirmCustomerSummary(f);
    const list = JSON.parse(
      precedents.find((item) => item.id === "precedent_list_candidate")?.response.body ?? "{}",
    );
    const detail = {
      PrecService: JSON.parse(
        precedents.find((item) => item.id === "precedent_verified")?.response.body ?? "{}",
      ).판례정보,
    };
    const env = {
      ...f.owner.env,
      APPLICATION_COST_LIMITS_ENABLED: "false",
      LAW_API_OC: "synthetic-test-only",
      CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, ""),
      ANALYSIS_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
    } as Env;
    const external: URL[] = [],
      wire: { path: string; body: string; owner: string | null }[] = [],
      opened: string[] = [];
    const app = new Hono<ApiEnvironment>().route(
      "/api/v2/cases",
      createPrecedentsApi({
        service: (core, value) =>
          createPrecedentResearchService(core, value, {
            clock: () => f.now,
            transport: async (url) => {
              const parsed = new URL(url);
              external.push(parsed);
              return Response.json(parsed.pathname.endsWith("lawSearch.do") ? list : detail);
            },
          }),
      }),
    );
    let cookie = f.owner.cookie;
    const scope = createSessionScope(),
      signal = new AbortController();
    const request = createJsonRequester({
      scope,
      newKey: () => crypto.randomUUID(),
      transport: async (path, init) => {
        const headers = new Headers(init.headers);
        wire.push({
          path,
          body: String(init.body ?? ""),
          owner: headers.get(EXPECTED_OWNER_HEADER),
        });
        headers.set("cookie", cookie);
        headers.set("origin", env.BETTER_AUTH_URL);
        return app.request(path, { ...init, headers }, env);
      },
    });
    const client = createMobilePrecedents({
      request,
      scope,
      signal: signal.signal,
      ownerId: f.owner.userId,
    });
    const session: SessionState = {
      phase: "ready",
      busy: false,
      role: "customer",
      session: {
        user: { id: f.owner.userId, name: "합성 계정", accountType: "customer" },
        needsConsent: false,
      },
      consent: null,
      error: null,
    };
    const model = createPrecedentsModel({
      caseId: f.workspace.id,
      session: { getSnapshot: () => session, subscribe: () => () => {}, refresh: async () => {} },
      createClient: () => client,
      openUrl: async (url) => {
        opened.push(url);
      },
    });
    const stop = model.start();
    await settled();
    if (!model.getSnapshot().context) await model.refresh();
    expect(model.getSnapshot().context).not.toBeNull();
    expect(external).toHaveLength(0);
    // Select a public concept independent of server suggestions; no private case text enters its wire.
    for (const topic of [...model.getSnapshot().topics]) model.select(topic);
    model.select("contract");
    await model.search();
    const item = model.getSnapshot().result?.items[0];
    expect(item).toBeDefined();
    if (!item) throw new Error("MISSING_SYNTHETIC_RESULT");
    expect(model.getSnapshot().result?.status).toBe("complete");
    expect(
      external
        .filter((url) => url.searchParams.has("query"))
        .map((url) => url.searchParams.get("query")),
    ).toEqual(["계약"]);
    const before = external.length;
    await model.read(item.id);
    expect(model.getSnapshot().article?.excerpt.text).toContain("합성 전문");
    expect(external).toHaveLength(before);
    expect(wire.every((call) => call.owner === encodeURIComponent(f.owner.userId))).toBe(true);
    const searchWire = wire.find((call) => call.path.endsWith("/search"));
    expect(Object.keys(JSON.parse(searchWire?.body ?? "{}")).sort()).toEqual([
      "expectedRevision",
      "summaryRevision",
      "topics",
    ]);
    const readWire = wire.find((call) => call.path.endsWith("/read"));
    expect(readWire?.path).not.toContain(item.readToken);
    expect(JSON.parse(readWire?.body ?? "{}").readToken).toBe(item.readToken);
    // A silently replaced signed cookie cannot use the old screen's owner intent or proof.
    cookie = (await seedTestSession(f.db, { consent: true })).cookie;
    await model.openOfficial(item.id);
    expect(opened).toEqual([]);
    expect(model.getSnapshot().result).toBeNull();
    expect(model.getSnapshot().context).toBeNull();
    expect(external).toHaveLength(before);
    stop();
    const wireBeforeAbort = wire.length;
    signal.abort();
    await expect(client.context(f.workspace.id)).rejects.toMatchObject({ name: "AbortError" });
    expect(wire).toHaveLength(wireBeforeAbort);
  } finally {
    f.db.close();
  }
});
