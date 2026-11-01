import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { v2WorkspaceSchema } from "../src/contracts/v2";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createReworkApi } from "../src/server/api/v2/rework";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { createReworkCaseService } from "../src/server/modules/rework/case-context";
import { customerWorkspaceFixture } from "./helpers/customer-workspace";
import { seedTestSession } from "./helpers/session";

const fixtures: Awaited<ReturnType<typeof customerWorkspaceFixture>>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.db.close();
});
async function fixture() {
  const f = await customerWorkspaceFixture();
  fixtures.push(f);
  return { ...f, rework: createReworkCaseService(f.core, { clock: () => f.now }) };
}
const input = {
  narrative: "상대방이 전달한 청구 내용과 계약서를 검토하고 대응 자료를 정리합니다.",
  subjectContext: "company" as const,
  jurisdiction: "KR" as const,
  casePurpose: "respond_to_claim" as const,
  turnstileToken: "synthetic",
};
test("legacy context remains unconfirmed and opt-in creation is atomic without expanding legacy strict DTOs", async () => {
  const f = await fixture();
  expect((await f.rework.get(f.owner.userId, f.workspace.id)).context).toEqual({
    casePurpose: "unconfirmed",
    subjectContext: "individual",
    procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
  });
  const key = crypto.randomUUID(),
    made = await f.rework.create(f.owner.userId, key, input);
  expect(made.context).toMatchObject({
    casePurpose: "respond_to_claim",
    subjectContext: "company",
    procedure: { kind: "unconfirmed", stage: "unconfirmed" },
  });
  expect(v2WorkspaceSchema.parse(made.workspace)).not.toHaveProperty("context");
  expect(
    await f.rework.replayCreate(f.owner.userId, key, { ...input, turnstileToken: "renewed" }),
  ).toEqual(made);
  await expect(
    f.rework.create(f.owner.userId, key, { ...input, casePurpose: "prepare_claim" }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const items = await f.repository.list({ ownerId: f.owner.userId, now: f.now }, 20);
  expect(items).toHaveLength(2);
  expect(items.find((item) => item.id === made.workspace.id)).toMatchObject({
    subjectContext: "company",
  });
});
test("context changes preserve history, use separate procedure fields and replay exactly once", async () => {
  const f = await fixture(),
    key = crypto.randomUUID();
  const update = {
    expectedRevision: f.workspace.workspaceRevision,
    casePurpose: "prepare_claim" as const,
    subjectContext: "company" as const,
    procedure: {
      kind: "civil" as const,
      stage: "appeal" as const,
      description: "사용자가 확인한 항소 단계",
    },
  };
  const next = await f.rework.update(f.owner.userId, f.workspace.id, key, update);
  expect(next.workspaceRevision).toBe(update.expectedRevision + 1);
  expect(await f.rework.update(f.owner.userId, f.workspace.id, key, update)).toEqual(next);
  expect(
    (await f.repository.findWorkspace({ ownerId: f.owner.userId, now: f.now }, f.workspace.id))
      ?.subjectContext,
  ).toBe("company");
  await expect(
    f.rework.update(f.owner.userId, f.workspace.id, key, {
      ...update,
      casePurpose: "respond_to_claim",
    }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    f.rework.update(f.owner.userId, f.workspace.id, crypto.randomUUID(), update),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  const nextInput = {
    ...update,
    expectedRevision: next.workspaceRevision,
    casePurpose: "respond_to_claim" as const,
  };
  await f.rework.update(f.owner.userId, f.workspace.id, crypto.randomUUID(), nextInput);
  expect(
    f.db.sqlite
      .query(
        "SELECT count(*) n FROM v2_rework_records WHERE kind='action_receipt' AND state='published'",
      )
      .get(),
  ).toEqual({ n: 2 });
  expect(
    JSON.stringify(f.db.sqlite.query("SELECT encrypted_payload FROM v2_workspaces").all()),
  ).not.toContain("respond_to_claim");
  expect(
    JSON.stringify(f.db.sqlite.query("SELECT encrypted_payload FROM v2_rework_parts").all()),
  ).not.toContain("항소 단계");
});
test("context cannot be read by a peer or changed after consent withdrawal or deletion", async () => {
  const f = await fixture(),
    peer = await seedTestSession(f.db, { consent: true });
  await expect(f.rework.get(peer.userId, f.workspace.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const next = {
    expectedRevision: f.workspace.workspaceRevision,
    casePurpose: "prepare_claim",
    subjectContext: "individual",
    procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
  };
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
  await expect(
    f.rework.update(f.owner.userId, f.workspace.id, crypto.randomUUID(), next),
  ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  expect((await f.rework.get(f.owner.userId, f.workspace.id)).context.casePurpose).toBe(
    "unconfirmed",
  );
  await expect(f.rework.create(f.owner.userId, crypto.randomUUID(), input)).rejects.toMatchObject({
    code: "CONSENT_REQUIRED",
  });
  f.db.sqlite.query("DELETE FROM v2_workspaces WHERE id=?").run(f.workspace.id);
  await expect(f.rework.get(f.owner.userId, f.workspace.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
test("HTTP creates and updates through current owner, origin, Turnstile and idempotency guards", async () => {
  const f = await fixture();
  let verified = 0;
  const env = {
    ...f.owner.env,
    CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, ""),
    CASE_IP_LIMIT: { limit: async () => ({ success: true }) },
    CASE_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
    ANALYSIS_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
  } as Env;
  const app = new Hono<ApiEnvironment>()
    .use("*", async (c, next) => {
      c.set("requestId", "synthetic-rework");
      await next();
    })
    .route("/api/v2/cases", createReworkApi({ turnstile: async () => ++verified === 1 }))
    .route("/api/v2/cases", createWorkspacesApi());
  const headers = {
    cookie: f.owner.cookie,
    origin: env.BETTER_AUTH_URL,
    "content-type": "application/json",
    "idempotency-key": crypto.randomUUID(),
    "cf-connecting-ip": "192.0.2.1",
  };
  const create = () =>
    app.request(
      "/api/v2/cases/rework",
      { method: "POST", headers, body: JSON.stringify(input) },
      env,
    );
  const result = await create();
  expect(result.status).toBe(201);
  const made = (await result.json()) as { workspace: { id: string; workspaceRevision: number } };
  expect((await create()).status).toBe(201);
  expect(verified).toBe(1);
  const path = `/api/v2/cases/${made.workspace.id}/rework/context`;
  const state = await app.request(
    `/api/v2/cases/${made.workspace.id}/rework/conversation`,
    { headers },
    env,
  );
  expect(state.status).toBe(200);
  expect(await state.json()).toMatchObject({
    caseContext: { casePurpose: "respond_to_claim", subjectContext: "company" },
    summaryConfirmed: false,
    analysis: { status: "not_started" },
    report: { status: "not_started" },
  });
  expect((await app.request(path, undefined, env)).status).toBe(401);
  const update = {
    expectedRevision: made.workspace.workspaceRevision,
    casePurpose: "prepare_claim",
    subjectContext: "company",
    procedure: { kind: "civil", stage: "first_instance", description: null },
  };
  expect(
    (
      await app.request(
        path,
        {
          method: "PUT",
          headers: { ...headers, origin: "https://foreign.test" },
          body: JSON.stringify(update),
        },
        env,
      )
    ).status,
  ).toBe(403);
  expect(
    (await app.request(path, { method: "PUT", headers, body: JSON.stringify(update) }, env)).status,
  ).toBe(200);
  const legacy = await app.request(
    `/api/v2/cases/${made.workspace.id}/workspace`,
    { headers },
    env,
  );
  expect(legacy.status).toBe(200);
  expect(v2WorkspaceSchema.safeParse(await legacy.json()).success).toBe(true);
});
