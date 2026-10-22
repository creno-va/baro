import { expect, test } from "bun:test";
import { ApiError } from "@baro/api-client";
import type { DirectoryPage } from "@baro/contracts/v2/directory";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import { createDirectoryModel } from "../apps/mobile/src/features/directory/model";
import { createMobileApi } from "../apps/mobile/src/platform/http";

function page(name: string, nextCursor: string | null = null): DirectoryPage {
  return {
    items: [
      {
        id: "synthetic_profile_a",
        revision: 1,
        name,
        officeName: "합성 사무소",
        introduction: "합성 공개 소개",
        region: "seoul",
        practiceAreas: ["civil"],
        photoUrl: null,
        photoAssetId: null,
        verificationStatus: "self_declared",
      },
    ],
    nextCursor,
    expiresAt: "2026-10-23T00:00:00.000Z",
    rotation: { day: "2026-10-22", algorithm: "daily_sha256_pivot_v1" },
  };
}

test("a newer directory search fences old responses even when transport ignores abort", async () => {
  const pending: { resolve: (page: DirectoryPage) => void; signal?: AbortSignal }[] = [];
  const model = createDirectoryModel({
    listPage: async (_filters, _cursor, signal) =>
      new Promise((resolve) => {
        pending.push({ resolve, ...(signal ? { signal } : {}) });
      }),
  });
  const old = model.search("이전");
  const fresh = model.search("현재");
  expect(pending[0]?.signal?.aborted).toBe(true);
  pending[1]?.resolve(page("현재"));
  await fresh;
  pending[0]?.resolve(page("이전"));
  await old;
  expect(model.getSnapshot().items.map((item) => item.name)).toEqual(["현재"]);
  expect(model.getSnapshot().query).toBe("현재");
  const last = model.search("종료 후 응답");
  model.stop();
  pending[2]?.resolve(page("닫힘"));
  await last;
  expect(model.getSnapshot().items).toEqual([]);
});

test("paging retains prior data on failure and a rejected cursor restarts from a fresh page", async () => {
  const cursors: (string | undefined)[] = [];
  const cursor = "synthetic_cursor_abcdefghijklmnopqrstuvwxyz";
  const model = createDirectoryModel({
    listPage: async (_filters, value) => {
      cursors.push(value);
      if (cursors.length === 1) return page("기존", cursor);
      if (cursors.length === 2)
        throw new ApiError("VALIDATION_ERROR", "검색 조건을 확인해 주세요.");
      return page("새 페이지");
    },
  });
  await model.search("");
  await model.more();
  expect(model.getSnapshot().phase).toBe("error");
  expect(model.getSnapshot().items[0]?.name).toBe("기존");
  await model.retry();
  expect(cursors).toEqual([undefined, cursor, undefined]);
  expect(model.getSnapshot().items[0]?.name).toBe("새 페이지");
});

test("native transport uses the configured API origin and never silently sends ambient cookies", async () => {
  const calls: { input: string; init: RequestInit }[] = [];
  const api = createMobileApi({
    config: resolveMobileConfig({ environment: "preview" }),
    newKey: () => "synthetic-key",
    fetch: async (input, init) => {
      calls.push({ input, init });
      return Response.json(page("공개"));
    },
  });
  await api.directory.listPage();
  expect(calls[0]?.input).toBe("https://preview.baro.site/api/v2/lawyers/directory?limit=20");
  expect(calls[0]?.init.credentials).toBe("omit");
  expect(calls[0]?.init.redirect).toBe("error");
  expect(new Headers(calls[0]?.init.headers).get("cookie")).toBeNull();
  const redirected = createMobileApi({
    config: resolveMobileConfig({ environment: "preview" }),
    newKey: () => "key",
    fetch: async () => {
      const response = Response.json(page("비정상"));
      Object.defineProperty(response, "url", { value: "https://other.invalid/api/list" });
      return response;
    },
  });
  await expect(redirected.directory.listPage()).rejects.toMatchObject({ code: "UNAVAILABLE" });
});

test("auth transitions do not abort an unrelated anonymous directory read", async () => {
  let resolve!: (value: Response) => void;
  let signal: AbortSignal | null | undefined;
  const api = createMobileApi({
    config: resolveMobileConfig({ environment: "preview" }),
    newKey: () => "synthetic",
    fetch: async (_input, init) => {
      signal = init.signal;
      return new Promise<Response>((done) => {
        resolve = done;
      });
    },
  });
  const pending = api.directory.listPage();
  api.scope.invalidate();
  expect(signal?.aborted).not.toBe(true);
  resolve(Response.json(page("공개 유지")));
  expect((await pending).items[0]?.name).toBe("공개 유지");
});

test("region/field/query filters stay bound to paging/retry and fresh failed searches clear old cards", async () => {
  const seen: unknown[] = [];
  const cursor = "synthetic_cursor_abcdefghijklmnopqrstuvwxyz";
  const model = createDirectoryModel({
    listPage: async (filters, next) => {
      seen.push({ ...filters, cursor: next });
      if (seen.length === 2) throw new ApiError("VALIDATION_ERROR", "만료된 검색");
      if (seen.length === 4) throw new ApiError("UNAVAILABLE", "서버 연결 실패");
      return page("서울 민사", cursor);
    },
  });
  const filters = { query: " 이름 ", region: "seoul", practiceArea: "civil" };
  await model.search(filters);
  filters.region = "busan";
  await model.more();
  await model.retry();
  expect(seen).toEqual([
    { query: "이름", region: "seoul", practiceArea: "civil", cursor: undefined },
    { query: "이름", region: "seoul", practiceArea: "civil", cursor },
    { query: "이름", region: "seoul", practiceArea: "civil", cursor: undefined },
  ]);
  await model.refresh();
  expect(model.getSnapshot()).toMatchObject({
    phase: "error",
    region: "seoul",
    practiceArea: "civil",
    items: [],
    nextCursor: null,
  });
});
