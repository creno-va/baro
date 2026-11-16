import { describe, expect, test } from "bun:test";
import type { CaseView } from "@baro/client-core";
import { createWebQueryClient, queryKeys } from "../src/client/query/client";
import { ensureCaseEntry } from "../src/client/query/resources";

const item: CaseView = {
  id: "synthetic-case",
  title: "합성 사건",
  subjectContext: "individual",
  stage: "active",
  revision: 3,
  updatedAt: "2026-11-16T00:00:00Z",
  summary: "목록 미리보기",
  schemaVersion: "2",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("owner-scoped case entry metadata", () => {
  test("v2 entry joins the sidebar list without loading or caching an incomplete full detail", async () => {
    const client = createWebQueryClient(),
      pending = deferred<CaseView[]>();
    let lists = 0,
      details = 0;
    const list = () => {
      lists++;
      return pending.promise;
    };
    const sidebar = client.fetchQuery({
      queryKey: queryKeys.cases("owner-generation"),
      queryFn: list,
    });
    const entry = ensureCaseEntry({
      client,
      owner: "owner-generation",
      caseId: item.id,
      signal: new AbortController().signal,
      list,
      get: async () => {
        details++;
        return item;
      },
    });
    pending.resolve([item]);
    expect(await entry).toEqual(item);
    await sidebar;
    expect(lists).toBe(1);
    expect(details).toBe(0);
    expect(client.getQueryData(queryKeys.case("owner-generation", item.id))).toBeUndefined();
    client.clear();
  });

  test("missing and unversioned entries fall back to authoritative detail", async () => {
    const unversioned = { ...item };
    delete unversioned.schemaVersion;
    for (const list of [[], [unversioned]]) {
      const client = createWebQueryClient();
      let details = 0;
      const full = { ...item, summary: "사용자가 확인한 실제 상세 요약" };
      const entry = await ensureCaseEntry({
        client,
        owner: "owner-generation",
        caseId: item.id,
        signal: new AbortController().signal,
        list: async () => list,
        get: async () => {
          details++;
          return full;
        },
      });
      expect(entry).toEqual(full);
      expect(details).toBe(1);
      expect(client.getQueryData(queryKeys.case("owner-generation", item.id))).toBeUndefined();
      client.clear();
    }
  });

  test("legacy list metadata preserves its kind while leaving full legacy reads to their view", async () => {
    const client = createWebQueryClient();
    let details = 0;
    const legacy: CaseView = { ...item, schemaVersion: "1" };
    const entry = await ensureCaseEntry({
      client,
      owner: "owner-generation",
      caseId: item.id,
      signal: new AbortController().signal,
      list: async () => [legacy],
      get: async () => {
        details++;
        return legacy;
      },
    });
    expect(entry.schemaVersion).toBe("1");
    expect(details).toBe(0);
    client.clear();
  });

  test("cancelling an entry while its shared list loads cannot start a fallback detail", async () => {
    const client = createWebQueryClient(),
      list = deferred<CaseView[]>(),
      controller = new AbortController();
    let details = 0;
    const entry = ensureCaseEntry({
      client,
      owner: "owner-generation",
      caseId: item.id,
      signal: controller.signal,
      list: () => list.promise,
      get: async () => {
        details++;
        return item;
      },
    });
    const failure = entry.catch((error: unknown) => error);
    controller.abort();
    list.resolve([]);
    expect(await failure).toMatchObject({ name: "AbortError" });
    expect(details).toBe(0);
    client.clear();
  });

  test("a late fallback detail is discarded after owner-scoped entry cancellation", async () => {
    const client = createWebQueryClient(),
      detail = deferred<CaseView>(),
      entered = deferred<void>(),
      controller = new AbortController();
    const entry = ensureCaseEntry({
      client,
      owner: "owner-generation",
      caseId: item.id,
      signal: controller.signal,
      list: async () => [],
      get: async () => {
        entered.resolve();
        return detail.promise;
      },
    });
    const failure = entry.catch((error: unknown) => error);
    await entered.promise;
    controller.abort();
    detail.resolve(item);
    expect(await failure).toMatchObject({ name: "AbortError" });
    expect(client.getQueryData(queryKeys.case("owner-generation", item.id))).toBeUndefined();
    client.clear();
  });
});
