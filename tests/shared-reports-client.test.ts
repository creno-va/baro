import { expect, test } from "bun:test";
import {
  ApiError,
  createReportsClient,
  type DomainRequest,
  type ReportArtifact,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";

const id = "synthetic_case";
const report = (revision = 1) => ({
  id: "synthetic_report",
  caseId: id,
  revision,
  title: "합성 리포트",
  content: "합성 리포트 내용",
  updatedAt: "2026-10-22T00:00:00.000Z",
  stale: false,
  excludedFileIds: [],
  maskIdentifiers: false,
});
function artifact(overrides: Partial<ReportArtifact<string>> = {}) {
  let discarded = 0,
    reads = 0,
    texts = 0;
  const value: ReportArtifact<string> = {
    value: "synthetic-private-uri",
    mimeType: "application/pdf",
    size: 100,
    read: async (start, end) => {
      reads++;
      expect([start, end]).toEqual([0, 5]);
      return new TextEncoder().encode("%PDF-");
    },
    text: async () => {
      texts++;
      return '<!doctype html><html data-baro-report="1"></html>';
    },
    discard: () => {
      discarded++;
    },
    ...overrides,
  };
  return { value, discarded: () => discarded, reads: () => reads, texts: () => texts };
}
function client(
  download: () => Promise<ReportArtifact<string>>,
  request: DomainRequest = async <T>() => report() as T,
  coalesceWrites?: "credential-scope",
) {
  const scope = createSessionScope();
  return {
    scope,
    api: createReportsClient({
      request,
      download,
      scope,
      newKey: () => crypto.randomUUID(),
      ...(coalesceWrites ? { coalesceWrites } : {}),
    }),
  };
}

test("a platform artifact verifies a bounded PDF header without a browser Blob", async () => {
  const file = artifact();
  expect(await client(async () => file.value).api.pdf("synthetic_report")).toBe(
    "synthetic-private-uri",
  );
  expect(file.reads()).toBe(1);
  expect(file.discarded()).toBe(0);
});
for (const kind of ["mime", "signature", "html-size", "html-content"] as const)
  test(`an invalid ${kind} artifact is discarded before it reaches a view`, async () => {
    const file = artifact({
      ...(kind === "mime" ? { mimeType: "text/plain" } : {}),
      ...(kind === "signature" ? { read: async () => new Uint8Array([1, 2]) } : {}),
      ...(kind.startsWith("html")
        ? { mimeType: "text/html", size: kind === "html-size" ? 30_000_001 : 20 }
        : {}),
      ...(kind === "html-content" ? { text: async () => "<html>unverified</html>" } : {}),
    });
    const f = client(async () => file.value);
    await expect(
      kind.startsWith("html") ? f.api.html("synthetic_report") : f.api.pdf("synthetic_report"),
    ).rejects.toThrow();
    expect(file.discarded()).toBe(1);
    if (kind === "html-size") expect(file.texts()).toBe(0);
  });

test("an account change during artifact verification discards private bytes and rejects the old result", async () => {
  let release!: (bytes: Uint8Array) => void, entered!: () => void;
  const ready = new Promise<void>((done) => {
    entered = done;
  });
  const file = artifact({
    read: () => {
      entered();
      return new Promise((done) => {
        release = done;
      });
    },
  });
  const f = client(async () => file.value);
  const result = f.api.pdf("synthetic_report");
  await ready;
  f.scope.invalidate();
  release(new TextEncoder().encode("%PDF-"));
  await expect(result).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(file.discarded()).toBe(1);
});

test("switching an ambiguous generation selection away and back retains each original body/key", async () => {
  let revision = 1;
  const writes: { body: unknown; key: string | undefined }[] = [];
  const f = client(
    async () => artifact().value,
    async <T>(_path: string, init = {}) => {
      const options = init as import("@baro/api-client").DomainRequestInit;
      if (options.method === "POST") {
        writes.push({ body: options.body, key: options.headers?.["idempotency-key"] });
        throw new ApiError("UNAVAILABLE", "합성 응답 유실", true);
      }
      return report(revision++) as T;
    },
  );
  await f.api.get(id);
  await expect(f.api.generate(id, ["one"])).rejects.toThrow();
  await f.api.get(id);
  await expect(f.api.generate(id, ["two"])).rejects.toThrow();
  await f.api.get(id);
  await expect(f.api.generate(id, ["one"])).rejects.toThrow();
  expect(writes[0]).toEqual(writes[2]);
  expect(writes[0]?.key).not.toBe(writes[1]?.key);
});

test("parallel generations share one admission and a foreign case projection is rejected", async () => {
  let release!: (value: unknown) => void;
  let writes = 0;
  const f = client(
    async () => artifact().value,
    async <T>(_path: string, init = {}) => {
      if ((init as import("@baro/api-client").DomainRequestInit).method === "POST") {
        writes++;
        return new Promise<T>((done) => {
          release = (value) => done(value as T);
        });
      }
      return { ...report(), caseId: "foreign_case" } as T;
    },
    "credential-scope",
  );
  const first = f.api.generate(id),
    second = f.api.generate(id);
  expect(writes).toBe(1);
  release(report());
  expect(await first).toEqual(await second);
  await expect(f.api.get(id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
});

test("an owner change aborts JSON requests and prevents further private writes", async () => {
  let release!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  let calls = 0;
  const f = client(
    async () => artifact().value,
    async <T>(_path: string, init = {}) => {
      calls++;
      signal = (init as import("@baro/api-client").DomainRequestInit).signal;
      return new Promise<T>((done) => {
        release = (value) => done(value as T);
      });
    },
  );
  const pending = f.api.get(id);
  f.scope.invalidate();
  expect(signal?.aborted).toBe(true);
  release(report());
  await expect(pending).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(f.api.generate(id)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(calls).toBe(1);
});
