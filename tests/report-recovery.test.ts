import { expect, test } from "bun:test";
import {
  ApiError,
  createJsonRequester,
  createReportsClient,
  type DomainRequest,
  type DomainRequestInit,
  type ReportArtifact,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { EXPECTED_OWNER_HEADER } from "@baro/contracts/session";
import { reportHttpFixture } from "./helpers/report-http-fixture";

const fingerprint = async (value: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString(
    "hex",
  );
const review = {
  content: "합성 검토 내용",
  maskIdentifiers: true,
  excludedFileIds: [],
  includedPhotoIds: [],
};
async function fixture() {
  const f = await reportHttpFixture(),
    records = new Map<string, string>();
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value);
    },
    removeItem: (key: string) => {
      records.delete(key);
    },
  };
  const writes: { path: string; body: string; key: string | null }[] = [];
  let lose = false;
  const create = (owner = f.actor.ownerId) => {
    const scope = createSessionScope();
    const transport = async (path: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      headers.set("cookie", f.cookie);
      headers.set("origin", f.env.BETTER_AUTH_URL);
      if (init.method === "POST" || init.method === "PATCH")
        writes.push({ path, body: String(init.body), key: headers.get("idempotency-key") });
      const response = await f.app.request(path, { ...init, headers }, f.env);
      if (lose && response.ok && (init.method === "POST" || init.method === "PATCH")) {
        lose = false;
        await response.body?.cancel();
        throw new ApiError("UNAVAILABLE", "합성 응답 유실", true);
      }
      return response;
    };
    const json = createJsonRequester({ scope, newKey: () => crypto.randomUUID(), transport });
    const request: DomainRequest = (path, options = {}) =>
      json({
        path,
        ...options,
        ...(options.headers?.["idempotency-key"]
          ? { key: options.headers["idempotency-key"] }
          : {}),
      });
    return {
      scope,
      api: createReportsClient({
        scope,
        request,
        newKey: () => crypto.randomUUID(),
        coalesceWrites: "credential-scope",
        recovery: { ownerId: owner, storage, fingerprint },
        download: async (path, options): Promise<ReportArtifact<Uint8Array>> => {
          const response = await transport(path, {
            method: options.method ?? "GET",
            headers: options.headers ?? {},
            signal: options.signal,
            ...(options.body ? { body: JSON.stringify(options.body) } : {}),
          });
          if (!response.ok) throw new Error("SYNTHETIC_DOWNLOAD_FAILED");
          const bytes = new Uint8Array(await response.arrayBuffer());
          return {
            value: bytes,
            size: bytes.length,
            mimeType: response.headers.get("content-type") ?? "",
            read: async (start, end) => bytes.slice(start, end),
            text: async () => new TextDecoder().decode(bytes),
            discard: () => {},
          };
        },
      }),
    };
  };
  return {
    ...f,
    records,
    storage,
    writes,
    create,
    lose: () => {
      lose = true;
    },
  };
}
for (const method of ["save", "generate"] as const)
  test(`native report ${method} replays a lost ACK after client/scope recreation with original revision and key`, async () => {
    const f = await fixture(),
      first = f.create(),
      displayed = await first.api.get(f.workspaceId);
    const invoke = (api: typeof first.api) =>
      method === "save"
        ? api.save(f.workspaceId, review, displayed.revision)
        : api.generate(f.workspaceId, [], displayed.revision);
    f.lose();
    await expect(invoke(first.api)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(f.records.size).toBe(1);
    const physical = [...f.records.entries()][0];
    expect(physical?.[0]).toMatch(/^baro-reports-request:[a-f0-9]{64}$/);
    expect(physical?.[1]).toMatch(/^[a-f0-9-]{36}$/);
    expect(JSON.stringify([...f.records])).not.toContain(review.content);
    first.scope.invalidate();
    const fresh = f.create(),
      committed = await fresh.api.get(f.workspaceId);
    const replay = await invoke(fresh.api);
    expect(replay.id).toBe(committed.id);
    expect(replay.revision).toBe(displayed.revision + 1);
    expect(f.writes[1]).toEqual(f.writes[0]);
    expect(f.records.size).toBe(0);
    await expect(invoke(fresh.api)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await fresh.api.get(f.workspaceId)).revision).toBe(replay.revision);
  });

test("native ZIP retry/repeated download across recreation retains one immutable selection receipt", async () => {
  const f = await fixture(),
    first = f.create(),
    report = await first.api.get(f.workspaceId);
  f.lose();
  await expect(first.api.zip(report.id, [f.selectedFileId])).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  first.scope.invalidate();
  const fresh = f.create(),
    bytes = await fresh.api.zip(report.id, [f.selectedFileId]);
  expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 3, 4]);
  expect(f.writes[1]).toEqual(f.writes[0]);
  expect(await f.create().api.zip(report.id, [f.selectedFileId])).toEqual(bytes);
  expect(f.writes[2]).toEqual(f.writes[0]);
  expect(f.records.size).toBe(1);
  expect((await fresh.api.get(f.workspaceId)).savedZip?.fileCount).toBe(1);
});

function smallFixture() {
  const records = new Map<string, string>();
  let calls = 0,
    mode = "",
    captured: DomainRequestInit | undefined;
  const scope = createSessionScope();
  const create = (ownerId = "owner_a") =>
    createReportsClient({
      scope,
      newKey: () => crypto.randomUUID(),
      recovery: {
        ownerId,
        fingerprint,
        storage: {
          getItem: (key) => {
            if (mode === "locked") throw new Error("SYNTHETIC_PRIVATE_STACK");
            return records.get(key) ?? null;
          },
          setItem: (key, value) => {
            if (mode !== "silent") records.set(key, value);
          },
          removeItem: (key) => {
            if (mode !== "retain") records.delete(key);
          },
        },
      },
      request: async <T>(_path: string, options: DomainRequestInit = {}) => {
        captured = options;
        calls++;
        if (mode === "unknown") throw new ApiError("UNAVAILABLE", "합성 응답 유실");
        return {
          id: "report_a",
          caseId: "case_a",
          revision: 2,
          title: "합성",
          content: review.content,
          updatedAt: "2026-10-23T00:00:00.000Z",
          stale: false,
          excludedFileIds: [],
          maskIdentifiers: true,
        } as T;
      },
      download: async () => {
        throw new Error("DOWNLOAD_NOT_EXPECTED");
      },
    });
  return {
    records,
    scope,
    create,
    calls: () => calls,
    captured: () => captured,
    mode: (value: string) => {
      mode = value;
    },
  };
}
test("locked, silently lost or corrupt recovery storage stops report dispatch without exposing its error", async () => {
  for (const mode of ["locked", "silent", "corrupt"]) {
    const f = smallFixture();
    if (mode === "corrupt") {
      f.mode("unknown");
      await expect(f.create().save("case_a", review, 1)).rejects.toBeDefined();
      f.records.set([...f.records.keys()][0] ?? "missing", "SYNTHETIC_PRIVATE_TOKEN");
      f.mode("");
    } else f.mode(mode);
    const calls = f.calls();
    await expect(f.create().save("case_a", review, 1)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(f.calls()).toBe(calls);
  }
});
test("native report writes require the displayed revision and isolate otherwise identical owner requests", async () => {
  const f = smallFixture();
  await expect(f.create().save("case_a", review)).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  await expect(f.create().generate("case_a")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(f.calls()).toBe(0);
  const loaded = f.create();
  await loaded.get("case_a");
  const before = f.calls();
  await expect(loaded.save("case_a", review)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(loaded.generate("case_a")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(f.calls()).toBe(before);
  f.mode("unknown");
  await expect(f.create().save("case_a", review, 1)).rejects.toBeDefined();
  const first = f.captured();
  expect(first?.headers?.[EXPECTED_OWNER_HEADER]).toBe("owner_a");
  await expect(f.create("owner_b").save("case_a", review, 1)).rejects.toBeDefined();
  expect(f.captured()?.headers?.[EXPECTED_OWNER_HEADER]).toBe("owner_b");
  expect(f.captured()?.headers?.["idempotency-key"]).not.toBe(first?.headers?.["idempotency-key"]);
  expect(f.records.size).toBe(2);
});
test("failed ACK-key cleanup preserves the successful report projection and same replay key", async () => {
  const f = smallFixture();
  f.mode("retain");
  expect((await f.create().save("case_a", review, 1)).revision).toBe(2);
  const key = f.captured()?.headers?.["idempotency-key"];
  expect(f.records.size).toBe(1);
  expect((await f.create().save("case_a", review, 1)).revision).toBe(2);
  expect(f.captured()?.headers?.["idempotency-key"]).toBe(key);
});

test("explicit initial intent recovers an oversized first report by exclusion and replays null CAS after a lost ACK", async () => {
  const f = await fixture();
  for (let ordinal = 0; ordinal < 20; ordinal++) {
    const row = crypto.randomUUID(),
      observation = crypto.randomUUID();
    const payload = await f.core.encrypt("v2_file_observations", row, f.actor.ownerId, 2, {
      id: observation,
      text: `${ordinal} 합성 자료 ${"가".repeat(1900)}`,
      position: { kind: "document", page: 1, paragraph: ordinal + 1, table: null },
      certainty: "uncertain",
      userEdited: true,
      included: true,
    });
    f.db.sqlite
      .query(
        "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload) VALUES(?,?,?,2,2,?,?)",
      )
      .run(row, observation, f.selectedFileId, ordinal, payload);
  }
  const response = await f.app.request(
    `/api/v2/cases/${f.workspaceId}/reports`,
    { headers: { cookie: f.cookie } },
    f.env,
  );
  expect(response.status).toBe(413);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    "EXPORT_LIMIT_EXCEEDED",
  );
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_reports").get()).toEqual({ n: 0 });
  const first = f.create();
  f.lose();
  await expect(first.api.generate(f.workspaceId, [f.selectedFileId], null)).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  first.scope.invalidate();
  const fresh = f.create(),
    committed = await fresh.api.get(f.workspaceId);
  const replay = await fresh.api.generate(f.workspaceId, [f.selectedFileId], null);
  expect(replay.id).toBe(committed.id);
  expect(replay.revision).toBe(1);
  expect(replay.excludedFileIds).toEqual([f.selectedFileId]);
  expect(replay.content).not.toContain("가".repeat(100));
  expect(JSON.parse(f.writes[0]?.body ?? "{}").expectedRevision).toBeNull();
  expect(f.writes[1]).toEqual(f.writes[0]);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_reports").get()).toEqual({ n: 1 });
  await expect(fresh.api.generate(f.workspaceId, [f.selectedFileId], null)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_reports").get()).toEqual({ n: 1 });
});

test("an explicit initial report intent cannot replace a peer-created report or admit another owner", async () => {
  const f = await fixture();
  const peer = await f.reports.get(f.actor.ownerId, f.workspaceId);
  await expect(f.create().api.generate(f.workspaceId, [], null)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await expect(
    f.create("foreign_owner").api.generate(f.workspaceId, [], null),
  ).rejects.toBeDefined();
  expect((await f.reports.get(f.actor.ownerId, f.workspaceId)).id).toBe(peer.id);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_reports").get()).toEqual({ n: 1 });
});
