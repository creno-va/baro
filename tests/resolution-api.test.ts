import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import type { V2ResolutionState } from "../src/contracts/v2/resolution";
import { type ApiEnvironment, errorBody } from "../src/server/api/errors";
import {
  createReworkResolutionApi,
  type ReworkResolutionRuntime,
} from "../src/server/api/v2/rework-resolution";
import { createResolutionService, ResolutionError } from "../src/server/modules/resolution/service";
import { customerWorkspaceFixture } from "./helpers/customer-workspace";
import { resolutionHarness, resolutionMutation } from "./helpers/resolution-fixture";
import { seedTestSession } from "./helpers/session";

const fixtures: Awaited<ReturnType<typeof customerWorkspaceFixture>>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.db.close();
});
async function fixture() {
  const f = await customerWorkspaceFixture();
  fixtures.push(f);
  const h = resolutionHarness();
  const service = createResolutionService({
    ...h.deps,
    authorize: async (ownerId, caseId) =>
      !!(await f.repository.findWorkspace({ ownerId, now: f.now }, caseId)),
  });
  const calls: {
    factory: { ownerId: string; sessionId: string }[];
    get: number;
    update: string[];
    draft: string[];
    errors: unknown[];
  } = { factory: [], get: 0, update: [], draft: [], errors: [] };
  let output: ((state: V2ResolutionState) => V2ResolutionState) | null = null;
  let failure: Error | null = null;
  const runtime: ReworkResolutionRuntime = {
    get: async (owner, id) => {
      calls.get++;
      const state = await service.get(owner, id);
      return output ? output(state) : state;
    },
    update: async (owner, id, key, input) => {
      calls.update.push(key);
      return service.update(owner, id, input);
    },
    draft: async (owner, id, key, input) => {
      calls.draft.push(key);
      return service.prepareDraft(owner, id, input);
    },
  };
  // Parent error mapping mirrors the integration boundary; the child has none.
  const app = new Hono<ApiEnvironment>()
    .use("*", async (c, next) => {
      c.set("requestId", "synthetic-resolution");
      c.header("cache-control", "private, no-store");
      await next();
    })
    .onError((error, c) => {
      calls.errors.push(error);
      const status =
        error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : error instanceof ResolutionError
            ? error.code === "NOT_FOUND"
              ? 404
              : 409
            : 500;
      return c.json(
        errorBody(
          c,
          error instanceof ResolutionError ? error.code : "VALIDATION_ERROR",
          "합성 부모 오류 처리",
        ),
        status,
      );
    })
    .route(
      "/api/v2/cases",
      createReworkResolutionApi({
        runtime: async (_env, ownerId, sessionId) => {
          calls.factory.push({ ownerId, sessionId });
          if (failure) throw failure;
          return runtime;
        },
      }),
    );
  const path = `/api/v2/cases/${f.workspace.id}/rework/resolution`;
  const headers = {
    cookie: f.owner.cookie,
    origin: f.owner.env.BETTER_AUTH_URL,
    "content-type": "application/json",
    "idempotency-key": crypto.randomUUID(),
  };
  const request = (
    method = "GET",
    body?: unknown,
    options: { path?: string; headers?: Record<string, string>; raw?: string } = {},
  ) =>
    app.request(
      options.path ?? path,
      {
        method,
        headers: options.headers ?? headers,
        ...(body === undefined && options.raw === undefined
          ? {}
          : { body: options.raw ?? JSON.stringify(body) }),
      },
      f.owner.env,
    );
  return {
    ...f,
    h,
    service,
    calls,
    app,
    path,
    headers,
    request,
    setOutput: (fn: typeof output) => {
      output = fn;
    },
    setFailure: (error: Error) => {
      failure = error;
    },
  };
}
test("signed owner GET/PATCH/draft traverse the real Hono guards and validated service with opaque keys", async () => {
  const f = await fixture();
  const first = await f.request();
  expect(first.status).toBe(200);
  expect(first.headers.get("cache-control")).toContain("no-store");
  let state = (await first.json()) as V2ResolutionState;
  expect(f.calls.factory[0]).toEqual({ ownerId: f.owner.userId, sessionId: f.owner.sessionId });
  expect(f.h.writes).toHaveLength(0);
  const key = crypto.randomUUID();
  const selected = await f.request(
    "PATCH",
    {
      ...resolutionMutation(state),
      action: "select",
      choice: "self",
      selectedFileIds: state.selectedFileIds,
      maskIdentifiers: true,
    },
    { headers: { ...f.headers, "idempotency-key": key } },
  );
  expect(selected.status).toBe(200);
  state = (await selected.json()) as V2ResolutionState;
  expect(f.calls.update).toEqual([key]);
  const prepared = await f.request(
    "POST",
    {
      ...resolutionMutation(state),
      documentKind: "fact_statement",
      selectedFileIds: state.selectedFileIds,
      maskIdentifiers: true,
      factsConfirmed: true,
    },
    { path: `${f.path}/draft` },
  );
  expect(prepared.status).toBe(200);
  expect(((await prepared.json()) as V2ResolutionState).draft?.content).toContain("[미입력: 관할]");
  expect(f.calls.draft).toEqual([f.headers["idempotency-key"]]);
  expect(f.h.writes).toHaveLength(2);
});
test("auth and origin rejection happen before JSON parsing or runtime construction", async () => {
  const f = await fixture();
  expect((await f.request("GET", undefined, { headers: {} })).status).toBe(401);
  expect(
    (
      await f.request("GET", undefined, {
        headers: { ...f.headers, cookie: `${f.owner.cookie}forged` },
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await f.request("PATCH", undefined, {
        headers: { ...f.headers, cookie: "" },
        raw: "broken-json",
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await f.request("POST", undefined, {
        path: `${f.path}/draft`,
        headers: { ...f.headers, origin: "https://foreign.example" },
        raw: "broken-json",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await f.request("PATCH", undefined, {
        headers: { ...f.headers, origin: "" },
        raw: "broken-json",
      })
    ).status,
  ).toBe(403);
  expect(f.calls.factory).toEqual([]);
  expect(f.calls.errors).toEqual([]);
  expect(f.h.writes).toEqual([]);
});
test("withdrawn consent permits historical read and denies mutations before DI", async () => {
  const f = await fixture();
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
  const read = await f.request();
  expect(read.status).toBe(200);
  expect(f.calls.factory).toHaveLength(1);
  f.calls.factory.length = 0;
  expect((await f.request("PATCH", undefined, { raw: "broken-json" })).status).toBe(403);
  expect(
    (await f.request("POST", undefined, { path: `${f.path}/draft`, raw: "broken-json" })).status,
  ).toBe(403);
  expect(f.calls.factory).toEqual([]);
  expect(f.h.writes).toEqual([]);
});
test("case ownership and deletion are enforced by the authoritative service, never inferred from a session", async () => {
  const f = await fixture(),
    peer = await seedTestSession(f.db, { consent: true });
  const denied = await f.request("GET", undefined, {
    headers: { ...f.headers, cookie: peer.cookie },
  });
  expect(denied.status).toBe(404);
  expect(f.calls.factory[0]?.ownerId).toBe(peer.userId);
  f.db.sqlite.query("DELETE FROM v2_workspaces WHERE id=?").run(f.workspace.id);
  expect((await f.request()).status).toBe(404);
  expect(f.h.writes).toEqual([]);
});
test("strict query/id/body/key validation denies malformed authenticated requests before runtime DI", async () => {
  const f = await fixture(),
    state = await f.service.get(f.owner.userId, f.workspace.id);
  const select = {
    ...resolutionMutation(state),
    action: "select",
    choice: "self",
    selectedFileIds: state.selectedFileIds,
    maskIdentifiers: true,
  };
  const draft = {
    ...resolutionMutation(state),
    documentKind: "fact_statement",
    selectedFileIds: state.selectedFileIds,
    maskIdentifiers: true,
    factsConfirmed: true,
  };
  for (const method of ["GET", "PATCH", "POST"]) {
    const path = method === "POST" ? `${f.path}/draft` : f.path;
    expect(
      (
        await f.request(
          method,
          method === "POST" ? draft : method === "PATCH" ? select : undefined,
          { path: `${path}?refresh=true` },
        )
      ).status,
    ).toBe(400);
  }
  expect(
    (await f.request("GET", undefined, { path: "/api/v2/cases/bad%20id/rework/resolution" }))
      .status,
  ).toBe(400);
  expect(
    (await f.request("PATCH", select, { headers: { ...f.headers, "idempotency-key": "" } })).status,
  ).toBe(400);
  expect(
    (
      await f.request("POST", draft, {
        path: `${f.path}/draft`,
        headers: { ...f.headers, "idempotency-key": "not-a-key" },
      })
    ).status,
  ).toBe(400);
  expect((await f.request("PATCH", { ...select, bypass: true })).status).toBe(400);
  expect(
    (await f.request("POST", { ...draft, factsConfirmed: false }, { path: `${f.path}/draft` }))
      .status,
  ).toBe(400);
  expect((await f.request("PATCH", undefined, { raw: "not-json" })).status).toBe(400);
  expect(f.calls.factory).toEqual([]);
  expect(f.h.writes).toEqual([]);
});
test("invalid response state and service errors propagate to the parent mapper", async () => {
  const f = await fixture();
  f.setOutput((state) => ({ ...state, unexpected: "must never leak" }) as V2ResolutionState);
  const bad = await f.request();
  expect(bad.status).toBe(400);
  expect(await bad.text()).not.toContain("must never leak");
  expect(f.calls.errors).toHaveLength(1);
  f.setOutput(null);
  f.setFailure(new ResolutionError("STALE_REVISION"));
  expect((await f.request()).status).toBe(409);
  expect(f.calls.errors).toHaveLength(2);
});
test("response validation permits only the configured official guide hosts", async () => {
  const f = await fixture();
  const guide = {
    id: "guide",
    sourceId: "synthetic-source",
    title: "합성 안내",
    kind: "official_guide" as const,
    contentHash: "a".repeat(64),
    verifiedAt: f.now,
    institutionId: "moleg_easylaw",
    endpointId: "easylaw_text_section",
    section: "합성",
    publishedDate: null,
    url: "https://www.easylaw.go.kr/CSP/CnpClsMain.laf?csmSeq=568&ccfNo=4&cciNo=1&cnpClsNo=1",
  };
  f.setOutput((state) => ({ ...state, citations: [guide] }));
  expect((await f.request()).status).toBe(200);
  f.setOutput((state) => ({
    ...state,
    citations: [{ ...guide, url: "https://unapproved.example/guide" }],
  }));
  const rejected = await f.request();
  expect(rejected.status).toBe(400);
  expect(await rejected.text()).not.toContain("unapproved.example");
});
