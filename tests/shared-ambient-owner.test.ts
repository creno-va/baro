import { expect, test } from "bun:test";
import {
  ApiError,
  createAccountClient,
  createFilesClient,
  createReportsClient,
  createWorkspaceClient,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function deadline<T>(value: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  const promise = Promise.race([
    value,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("AMBIENT_OWNER_CHECK_SKIPPED")), 1000);
    }),
  ]);
  return { promise, clear: () => clearTimeout(timer) };
}
const missing = () => new ApiError("NOT_FOUND", "합성 다른 계정의 요청");

test("a new ambient-cookie caller cannot join an old workspace mutation before owner notification", async () => {
  let owner = "a",
    calls = 0;
  const gate = deferred<Response>();
  const client = createWorkspaceClient({
    scope: createSessionScope(),
    newKey: () => crypto.randomUUID(),
    listFiles: async () => [],
    request: async () => {
      calls++;
      if (owner === "b") return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
      return gate.promise;
    },
  });
  const input = { expectedRevision: 1, text: "합성 입력", selectedFileIds: [] };
  const old = client.sendMessage("synthetic_case", input);
  void old.catch(() => {});
  owner = "b";
  const current = deadline(client.sendMessage("synthetic_case", input));
  try {
    await expect(current.promise).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls).toBe(2);
  } finally {
    current.clear();
    gate.resolve(Response.json({ error: { code: "UNAVAILABLE" } }, { status: 503 }));
    await old.catch(() => {});
  }
});

test("a new ambient-cookie caller cannot join an old report generation", async () => {
  let owner = "a",
    calls = 0;
  const gate = deferred<unknown>();
  const client = createReportsClient({
    scope: createSessionScope(),
    newKey: () => crypto.randomUUID(),
    download: async () => {
      throw new Error("SYNTHETIC_UNUSED");
    },
    request: async <T>() => {
      calls++;
      if (owner === "b") throw missing();
      return gate.promise as Promise<T>;
    },
  });
  const old = client.generate("synthetic_case");
  void old.catch(() => {});
  owner = "b";
  const current = deadline(client.generate("synthetic_case"));
  try {
    await expect(current.promise).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls).toBe(2);
  } finally {
    current.clear();
    gate.resolve({
      id: "synthetic_report",
      caseId: "synthetic_case",
      revision: 1,
      title: "합성",
      content: "합성",
      updatedAt: "2026-10-22T00:00:00Z",
      stale: false,
      excludedFileIds: [],
      maskIdentifiers: false,
    });
    await old.catch(() => {});
  }
});

test("a new ambient-cookie caller cannot join an old account deletion", async () => {
  let owner = "a",
    calls = 0;
  const gate = deferred<unknown>();
  const client = createAccountClient({
    scope: createSessionScope(),
    newKey: () => crypto.randomUUID(),
    readReauthentication: async () => null,
    reauthenticate: async () => {},
    request: async <T>() => {
      calls++;
      if (owner === "b") throw missing();
      return gate.promise as Promise<T>;
    },
  });
  const old = client.deleteCase("synthetic_case", "DELETE");
  void old.catch(() => {});
  owner = "b";
  const current = deadline(client.deleteCase("synthetic_case", "DELETE"));
  try {
    await expect(current.promise).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls).toBe(2);
  } finally {
    current.clear();
    gate.resolve({ status: "accepted" });
    await old.catch(() => {});
  }
});

test("a new ambient-cookie caller independently authorizes an upload instead of joining old byte work", async () => {
  const gate = deferred<string>();
  let hashes = 0;
  const file = { name: "synthetic.txt", type: "text/plain", size: 3 };
  const client = createFilesClient({
    scope: createSessionScope(),
    newKey: () => crypto.randomUUID(),
    request: async () => Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 }),
    download: async () => "synthetic-unused",
    openUpload: async () => ({
      fingerprint: () => (++hashes === 1 ? gate.promise : Promise.resolve("a".repeat(64))),
      part: async () => {
        throw new Error("SYNTHETIC_UNUSED");
      },
      close: () => {},
    }),
  });
  const old = client.upload("synthetic_case", file);
  void old.catch(() => {});
  await Promise.resolve();
  const current = deadline(client.upload("synthetic_case", file));
  try {
    await expect(current.promise).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(hashes).toBe(2);
  } finally {
    current.clear();
    gate.resolve("a".repeat(64));
    await old.catch(() => {});
  }
});
