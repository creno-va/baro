import { expect, test } from "bun:test";
import { ApiError } from "@baro/api-client";
import {
  type V2PrecedentReadResponse,
  v2PrecedentSearchResponseSchema,
} from "@baro/contracts/v2/precedent-research";
import { createPrecedentsModel } from "../apps/mobile/src/features/precedents/model";
import type { SessionState } from "../apps/mobile/src/features/session/model";
import fixtureResult from "./fixtures/legal/research/synthetic-search.json";

const result = v2PrecedentSearchResponseSchema.parse(fixtureResult);
const context = {
  schemaVersion: "2" as const,
  workspaceRevision: 7,
  summaryRevision: 2,
  caseTitle: "합성 비공개 사건",
  recommendedTopics: ["loan" as const],
};
const owner = (id = "a"): SessionState => ({
  phase: "ready",
  busy: false,
  role: "customer",
  session: { user: { id, name: "합성 계정", accountType: "customer" }, needsConsent: false },
  consent: null,
  error: null,
});
async function settled() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (value: T) => resolve(value),
  };
}
function fixture() {
  let session = owner(),
    fail: unknown,
    searchDelay: Promise<typeof result> | undefined,
    readDelay: Promise<V2PrecedentReadResponse> | undefined;
  let reads = 0,
    searches = 0,
    sessionReads = 0;
  const listeners = new Set<() => void>(),
    signals: AbortSignal[] = [],
    calls: unknown[] = [],
    urls: string[] = [];
  const first = result.items[0];
  if (!first) throw new Error("MISSING_SYNTHETIC_FIXTURE");
  const article: V2PrecedentReadResponse = {
    schemaVersion: "2",
    workspaceRevision: 7,
    citation: first.citation,
    excerpt: first.excerpt,
  };
  const model = createPrecedentsModel({
    caseId: "case_a",
    session: {
      getSnapshot: () => session,
      subscribe: (notify) => {
        listeners.add(notify);
        return () => {
          listeners.delete(notify);
        };
      },
      refresh: async () => {
        sessionReads++;
      },
    },
    createClient: (signal, id) => {
      signals.push(signal);
      calls.push({ owner: id });
      return {
        context: async () => {
          if (fail) throw fail;
          return structuredClone(context);
        },
        search: async (_id, body) => {
          searches++;
          calls.push(body);
          if (fail) throw fail;
          return searchDelay
            ? await searchDelay
            : structuredClone({
                ...result,
                topics: body.topics,
                items: result.items.map((item) => ({ ...item, matchedTopics: body.topics })),
              });
        },
        read: async (_id, body) => {
          reads++;
          calls.push(body);
          if (fail) throw fail;
          return readDelay ? await readDelay : structuredClone(article);
        },
      };
    },
    openUrl: async (url) => {
      urls.push(url);
    },
  });
  const stop = model.start();
  return {
    model,
    stop,
    calls,
    signals,
    urls,
    first,
    article,
    fail: (error: unknown) => {
      fail = error;
    },
    delaySearch: (value: Promise<typeof result> | undefined) => {
      searchDelay = value;
    },
    delayRead: (value: Promise<V2PrecedentReadResponse> | undefined) => {
      readDelay = value;
    },
    session: (value: SessionState) => {
      session = value;
      for (const notify of listeners) notify();
    },
    counts: () => ({ reads, searches, sessionReads }),
  };
}

test("context does not automatically search; topic limit and exact revisions/proof are preserved", async () => {
  const f = fixture();
  await settled();
  expect(f.model.getSnapshot()).toMatchObject({ gate: "ready", topics: ["loan"], result: null });
  expect(f.counts().searches).toBe(0);
  f.model.select("contract");
  f.model.select("wages");
  expect(f.model.getSnapshot().topics).toEqual(["loan", "contract"]);
  expect(f.model.getSnapshot().error).toContain("2개");
  await f.model.search();
  expect(f.calls[1]).toEqual({
    expectedRevision: 7,
    summaryRevision: 2,
    topics: ["loan", "contract"],
  });
  await f.model.read(f.first.id);
  expect(f.calls[2]).toEqual({ expectedRevision: 7, readToken: f.first.readToken });
  expect(f.model.getSnapshot().article?.citation.id).toBe(f.first.id);
  await f.model.openOfficial(f.first.id);
  expect(f.urls).toEqual([f.first.citation.url]);
  expect(f.urls[0]).not.toContain(f.first.readToken);
  f.stop();
});

test("new topic/search takes priority even if the old transport ignores abort", async () => {
  const f = fixture();
  await settled();
  const delay = deferred<typeof result>();
  f.delaySearch(delay.promise);
  const old = f.model.search();
  f.delaySearch(undefined);
  f.model.select("loan");
  f.model.select("wages");
  await f.model.search();
  expect(f.model.getSnapshot().result?.topics).toEqual(["wages"]);
  delay.resolve(result);
  await old;
  expect(f.model.getSnapshot().result?.topics).toEqual(["wages"]);
  f.stop();
});

test("fresh auth checking, consent, role, signout and owner switch discard case title/results and old native scopes", async () => {
  const f = fixture();
  await settled();
  await f.model.search();
  for (const next of [
    { ...owner(), phase: "checking" as const },
    { ...owner(), phase: "consent" as const, session: { ...owner().session!, needsConsent: true } },
    {
      ...owner(),
      session: {
        ...owner().session!,
        user: { ...owner().session!.user!, accountType: "lawyer" as const },
      },
    },
    { ...owner(), phase: "anonymous" as const, session: null },
  ]) {
    f.session(next);
    expect(f.model.getSnapshot().context).toBeNull();
    expect(f.model.getSnapshot().result).toBeNull();
    expect(f.signals[0]?.aborted).toBe(true);
  }
  f.session(owner("b"));
  await settled();
  expect(f.calls).toContainEqual({ owner: "b" });
  expect(f.model.getSnapshot().result).toBeNull();
  f.stop();
});

test("conflict/deletion fail closed and require a new context; raw errors never reach feature state", async () => {
  const f = fixture();
  await settled();
  await f.model.search();
  f.fail(new ApiError("CONFLICT", "stale"));
  await f.model.read(f.first.id);
  expect(f.model.getSnapshot()).toMatchObject({
    context: null,
    article: null,
    result: null,
    conflict: true,
  });
  f.fail(undefined);
  await f.model.refresh();
  expect(f.model.getSnapshot().context).not.toBeNull();
  expect(f.model.getSnapshot().result).toBeNull();
  f.fail(new ApiError("NOT_FOUND", "삭제된 사건"));
  await f.model.search();
  expect(f.model.getSnapshot().context).toBeNull();
  f.fail(new Error("private SQL native secret"));
  await f.model.refresh();
  expect(f.model.getSnapshot().error).not.toContain("secret");
  f.stop();
});

test("cancellation or changed owner during signed read cannot open an external original", async () => {
  for (const action of ["cancel", "owner", "stop"] as const) {
    const f = fixture();
    await settled();
    await f.model.search();
    const delay = deferred<V2PrecedentReadResponse>();
    f.delayRead(delay.promise);
    const pending = f.model.openOfficial(f.first.id);
    if (action === "cancel") f.model.cancel();
    else if (action === "owner") f.session(owner("b"));
    else f.stop();
    delay.resolve(f.article);
    await pending;
    expect(f.urls).toEqual([]);
    expect(f.model.getSnapshot().article).toBeNull();
    f.stop();
  }
});

test("a changed signed source/revision cannot be displayed or handed to the OS", async () => {
  const f = fixture();
  await settled();
  await f.model.search();
  f.delayRead(
    Promise.resolve({
      ...f.article,
      citation: { ...f.article.citation, url: "https://evil.invalid/private?token=secret" },
    }),
  );
  await f.model.openOfficial(f.first.id);
  expect(f.urls).toEqual([]);
  expect(f.model.getSnapshot()).toMatchObject({ conflict: true, article: null, result: null });
  f.stop();
});
