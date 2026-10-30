import { expect, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import { createFilesApi as createClient, validateUpload } from "../src/client/api/files";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { createFilesApi } from "../src/server/api/v2/files";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { storedFileMetadataSchema } from "../src/server/db/v2-files";
import {
  DefinitiveFileRejection,
  ProcessingError,
} from "../src/server/modules/file-processing/protocol";
import { customerWorkspaceFixture } from "./helpers/customer-workspace";

async function fixture(
  probeFailure?: "DEFINITIVE_REJECTION" | "FILE_REJECTED" | "FILE_PROCESSING_FAILED",
) {
  const f = await customerWorkspaceFixture(new Date().toISOString());
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    async put(key: string, value: Uint8Array) {
      objects.set(key, value.slice());
      return { key, size: value.byteLength };
    },
    async get(key: string) {
      const value = objects.get(key);
      return value ? { key, size: value.byteLength, body: new Response(value.slice()).body } : null;
    },
    async head(key: string) {
      const value = objects.get(key);
      return value ? { key, size: value.byteLength } : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  const env = { ...f.owner.env, CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, "") };
  const app = new Hono().route("/api/v2/cases", createWorkspacesApi()).route(
    "/api/v2/cases",
    createFilesApi({
      testOnlyMissingD1Meta: true,
      dependencies: async () => ({
        bucket: bucket as any,
        testOnlyUnmeteredStorage: true,
        probe: async (input) => {
          const reader = input.open().getReader();
          while (!(await reader.read()).done) {}
          reader.releaseLock();
          if (probeFailure) {
            const failure = probeFailure;
            probeFailure = undefined;
            throw failure === "DEFINITIVE_REJECTION"
              ? new DefinitiveFileRejection()
              : new ProcessingError(failure);
          }
          return {
            category: "document",
            format: "txt",
            byteLength: input.byteLength,
            pageCount: 1,
          };
        },
      }),
    }),
  );
  const raw = async (path: string, init?: RequestInit) =>
    app.request(
      path,
      {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          cookie: f.owner.cookie,
          origin: env.BETTER_AUTH_URL,
        },
      },
      env,
    );
  return { ...f, raw, objects };
}

for (const failure of ["DEFINITIVE_REJECTION", "FILE_REJECTED", "FILE_PROCESSING_FAILED"] as const)
  test(`actual signed probe rejection reaches the client without losing stored parts: ${failure}`, async () => {
    const f = await fixture(failure);
    try {
      const calls: string[] = [];
      const client = createClient(async (path, init) => {
        calls.push(`${init?.method ?? "GET"} ${path}`);
        return f.raw(path, init);
      });
      const source = new File(["Synthetic original awaiting admission"], "original.txt", {
        type: "text/plain",
      });
      await expect(client.upload(f.workspace.id, source)).rejects.toMatchObject({
        code: failure === "DEFINITIVE_REJECTION" ? "FILE_REJECTED" : "UNAVAILABLE",
        retryable: failure !== "DEFINITIVE_REJECTION",
        ...(failure === "DEFINITIVE_REJECTION"
          ? {
              message:
                "파일 형식과 내용을 확인해 주세요. 암호·보호를 해제하거나 지원하는 형식으로 저장한 뒤 다시 추가해 주세요.",
            }
          : {}),
      });
      const stored = [...f.objects].map<[string, number[]]>(([key, bytes]) => [key, [...bytes]]);
      expect(stored).toHaveLength(1);
      const pending = await client.list(f.workspace.id);
      expect(pending).toHaveLength(1);
      const pendingFile = pending[0];
      if (!pendingFile) throw new Error("Missing synthetic pending original");
      expect(pendingFile.status).toBe("uploading");
      expect(pendingFile.canRetry).toBe(false);
      expect(pendingFile.canStartProcessing).toBe(false);
      expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_outbox").get()).toEqual({
        count: 0,
      });
      await expect(client.original(f.workspace.id, pendingFile.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect([...f.objects].map(([key, bytes]) => [key, [...bytes]])).toEqual(stored);
      expect(calls.filter((call) => call.endsWith("/complete"))).toHaveLength(1);
      if (failure !== "DEFINITIVE_REJECTION") {
        const recovered = await client.upload(f.workspace.id, source);
        expect(recovered.id).toBe(pendingFile.id);
        expect(await (await client.original(f.workspace.id, recovered.id)).text()).toBe(
          await source.text(),
        );
        expect(
          calls.filter((call) => call === `POST /api/v2/cases/${f.workspace.id}/files`),
        ).toHaveLength(1);
        expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_upload_sessions").get()).toEqual(
          { count: 1 },
        );
      } else {
        const corrected = new File(["Synthetic corrected original bytes"], source.name, {
          type: source.type,
        });
        const uploaded = await client.upload(f.workspace.id, corrected);
        expect(uploaded.id).not.toBe(pendingFile.id);
        expect(await (await client.original(f.workspace.id, uploaded.id)).text()).toBe(
          await corrected.text(),
        );
        for (const [key, bytes] of stored)
          expect(Array.from(f.objects.get(key) ?? [])).toEqual(bytes);
        expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_upload_sessions").get()).toEqual(
          { count: 2 },
        );
      }
    } finally {
      f.db.close();
    }
  });

test("persisted format refusal stops the same original after reload while a corrected file resumes normally", async () => {
  const f = await fixture("DEFINITIVE_REJECTION");
  try {
    const writes: string[] = [];
    const request = (path: string, init?: RequestInit) => {
      if (init?.method && init.method !== "GET") writes.push(`${init.method} ${path}`);
      return f.raw(path, init);
    };
    const client = createClient(request),
      source = new File(["synthetic rejected bytes"], "source.txt", { type: "text/plain" });
    await expect(client.upload(f.workspace.id, source)).rejects.toMatchObject({
      code: "FILE_REJECTED",
    });
    const row = f.db.sqlite
      .query("SELECT id,revision,encrypted_payload FROM v2_files WHERE workspace_id=?")
      .get(f.workspace.id) as { id: string; revision: number; encrypted_payload: string };
    const metadata = await f.core.decrypt(
      "v2_files",
      row.id,
      f.owner.userId,
      row.revision,
      row.encrypted_payload,
      storedFileMetadataSchema,
    );
    // The probe repository's fenced writer is tested separately; this adapter
    // fixture supplies its exact durable result to the real signed API/client.
    f.db.sqlite.query("UPDATE v2_files SET encrypted_payload=? WHERE id=?").run(
      await f.core.encrypt("v2_files", row.id, f.owner.userId, row.revision, {
        ...metadata,
        uploadRejection: "FILE_REJECTED",
      }),
      row.id,
    );
    const original = [...f.objects].map(([id, bytes]) => [id, Array.from(bytes)] as const);
    writes.length = 0;
    expect(await createClient(request).list(f.workspace.id)).toMatchObject([
      { id: row.id, uploadRejection: "FILE_REJECTED", status: "uploading" },
    ]);
    for (const current of [client, createClient(request)])
      await expect(current.upload(f.workspace.id, source)).rejects.toMatchObject({
        code: "FILE_REJECTED",
        retryable: false,
      });
    expect(writes).toEqual([]);
    const corrected = new File(["synthetic corrected bytes"], source.name, { type: source.type });
    const result = await createClient(request).upload(f.workspace.id, corrected);
    expect(result.id).not.toBe(row.id);
    expect(await (await client.original(f.workspace.id, result.id)).text()).toBe(
      await corrected.text(),
    );
    for (const [id, bytes] of original) expect(Array.from(f.objects.get(id) ?? [])).toEqual(bytes);
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_upload_sessions").get()).toEqual({ n: 2 });
    expect(
      f.db.sqlite.query("SELECT state FROM v2_upload_sessions WHERE file_id=?").get(row.id),
    ).toEqual({ state: "open" });
  } finally {
    f.db.close();
  }
});

for (const useFreshClient of [false, true])
  test(`resume interrupted whitespace-named upload without a duplicate; fresh client=${useFreshClient}`, async () => {
    const f = await fixture();
    try {
      let interrupted = false;
      let reservations = 0;
      const transport = async (path: string, init?: RequestInit) => {
        if (init?.method === "POST" && path.endsWith("/files")) reservations++;
        const response = await f.raw(path, init);
        if (!interrupted && init?.method === "PUT" && path.endsWith("/parts/0")) {
          interrupted = true;
          throw new TypeError("Synthetic lost part response");
        }
        return response;
      };
      const original = "Synthetic whitespace-name original";
      const source = new File([original], "  resume.txt", { type: "text/plain" });
      const client = createClient(transport);
      await expect(client.upload(f.workspace.id, source)).rejects.toThrow(
        "Synthetic lost part response",
      );
      const pending = (await client.list(f.workspace.id))[0];
      if (!pending) throw new Error("Missing interrupted upload");
      expect(pending.name).toBe("resume.txt");
      const retry = useFreshClient ? createClient(transport) : client;
      const uploaded = await retry.upload(f.workspace.id, source);
      expect(uploaded.id).toBe(pending.id);
      expect(uploaded.status).toBe("waiting");
      expect(reservations).toBe(1);
      expect(await retry.list(f.workspace.id)).toHaveLength(1);
      expect(await (await retry.original(f.workspace.id, uploaded.id)).text()).toBe(original);
    } finally {
      f.db.close();
    }
  });

test("a short part body retains the same original and session for explicit upload recovery", async () => {
  const f = await fixture();
  try {
    let shorten = true;
    const calls: string[] = [];
    const client = createClient(async (path, init) => {
      calls.push(`${init?.method ?? "GET"} ${path}`);
      if (shorten && init?.method === "PUT" && path.endsWith("/parts/0")) {
        shorten = false;
        const body = init.body;
        if (!(body instanceof Blob)) throw new Error("Expected synthetic part blob");
        return f.raw(path, { ...init, body: body.slice(0, body.size - 1) });
      }
      return f.raw(path, init);
    });
    const source = new File(["Synthetic full original bytes"], "interrupted.txt", {
      type: "text/plain",
    });
    await expect(client.upload(f.workspace.id, source)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      retryable: false,
    });
    expect(f.objects.size).toBe(0);
    const pending = await client.list(f.workspace.id);
    expect(pending).toHaveLength(1);
    const pendingFile = pending[0];
    if (!pendingFile) throw new Error("Missing synthetic short-part original");
    expect(pendingFile.status).toBe("uploading");
    const recovered = await client.upload(f.workspace.id, source);
    expect(recovered.id).toBe(pendingFile.id);
    expect(await (await client.original(f.workspace.id, recovered.id)).text()).toBe(
      await source.text(),
    );
    expect(
      calls.filter((call) => call === `POST /api/v2/cases/${f.workspace.id}/files`),
    ).toHaveLength(1);
    expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_upload_sessions").get()).toEqual({
      count: 1,
    });
  } finally {
    f.db.close();
  }
});

for (const useFreshClient of [false, true])
  test(`delete interrupted upload then re-add; fresh client=${useFreshClient}`, async () => {
    const f = await fixture();
    try {
      let failPart = true;
      const calls: string[] = [];
      const transport = async (path: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${path}`);
        if (failPart && init?.method === "PUT" && path.endsWith("/parts/0")) {
          failPart = false;
          throw new TypeError("Synthetic upload interruption");
        }
        return f.raw(path, init);
      };
      const client = createClient(transport),
        source = new File(["Synthetic local original"], "recovery.txt", { type: "text/plain" });
      await expect(client.upload(f.workspace.id, source)).rejects.toThrow(
        "Synthetic upload interruption",
      );
      const pending = await client.list(f.workspace.id);
      expect(pending).toHaveLength(1);
      await expect(client.original(f.workspace.id, pending[0]!.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect((await f.raw(`/api/v2/cases/${f.workspace.id}/workspace`)).status).toBe(200);
      expect(await client.remove(f.workspace.id, pending[0]!.id)).toHaveLength(0);
      const retry = useFreshClient ? createClient(transport) : client;
      {
        const uploaded = await retry.upload(f.workspace.id, source);
        expect(uploaded.status).toBe("waiting");
        expect(uploaded.id).not.toBe(pending[0]!.id);

        expect(uploaded.canStartProcessing).toBe(true);
      }
      expect(calls.filter((c) => c === `POST /api/v2/cases/${f.workspace.id}/files`)).toHaveLength(
        2,
      );
    } finally {
      f.db.close();
    }
  });

for (const sameBytes of [true, false])
  test(`fresh client resumes only the same original bytes; same=${sameBytes}`, async () => {
    const f = await fixture();
    try {
      let interrupted = false;
      const client = createClient(async (path, init) => {
        const response = await f.raw(path, init);
        if (!interrupted && init?.method === "PUT" && path.endsWith("/parts/0")) {
          interrupted = true;
          throw new TypeError("Synthetic lost part response");
        }
        return response;
      });
      const original = new File(["original"], "same.txt", { type: "text/plain" });
      await expect(client.upload(f.workspace.id, original)).rejects.toThrow("lost part response");
      const pending = (await client.list(f.workspace.id))[0];
      if (!pending) throw new Error("Synthetic pending upload missing");
      const next = new File([sameBytes ? "original" : "modified"], "same.txt", {
        type: "text/plain",
      });
      const uploaded = await createClient(f.raw).upload(f.workspace.id, next);
      expect(uploaded.status).toBe("waiting");
      expect(uploaded.id === pending.id).toBe(sameBytes);
      expect(await (await createClient(f.raw).original(f.workspace.id, uploaded.id)).text()).toBe(
        sameBytes ? "original" : "modified",
      );
    } finally {
      f.db.close();
    }
  });

test("a peer client deleting an interrupted upload clears the cached session on explicit re-add", async () => {
  const f = await fixture();
  try {
    let fail = true;
    const client = createClient(async (path, init) => {
      if (fail && init?.method === "PUT") {
        fail = false;
        throw new TypeError("Synthetic interruption");
      }
      return f.raw(path, init);
    });
    const source = new File(["original"], "peer.txt", { type: "text/plain" });
    await expect(client.upload(f.workspace.id, source)).rejects.toThrow("interruption");
    const old = (await client.list(f.workspace.id))[0];
    if (!old) throw new Error("Synthetic pending upload missing");
    await createClient(f.raw).remove(f.workspace.id, old.id);
    const next = await client.upload(f.workspace.id, source);
    expect(next.id).not.toBe(old.id);
    expect(next.status).toBe("waiting");
  } finally {
    f.db.close();
  }
});

test("legacy reservations remain readable and cannot be resumed using name and size alone", async () => {
  const f = await fixture();
  try {
    const route = `/api/v2/cases/${f.workspace.id}`;
    const revision = (
      (await (await f.raw(`${route}/workspace`)).json()) as { workspaceRevision: number }
    ).workspaceRevision;
    const response = await f.raw(`${route}/files`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
        "if-match": String(revision),
      },
      body: JSON.stringify({
        name: "legacy.txt",
        byteLength: 8,
        mediaType: "text/plain",
        autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
      }),
    });
    if (!response.ok) throw new Error(`Synthetic legacy reservation failed: ${response.status}`);
    const old = (await response.json()) as { fileId: string };
    const client = createClient(f.raw);
    expect(await client.list(f.workspace.id)).toHaveLength(1);
    const next = await client.upload(
      f.workspace.id,
      new File(["original"], "legacy.txt", { type: "text/plain" }),
    );
    expect(next.id).not.toBe(old.fileId);
    expect(next.status).toBe("waiting");
  } finally {
    f.db.close();
  }
});

for (const loseCompleteAck of [false, true])
  test(`twentieth actual upload remains discoverable without duplicate writes; lost complete ACK=${loseCompleteAck}`, async () => {
    const f = await fixture();
    try {
      const seed = createClient(f.raw);
      for (let index = 0; index < 19; index++)
        await seed.upload(
          f.workspace.id,
          new File([`Synthetic original ${index}`], `original-${index}.txt`, {
            type: "text/plain",
          }),
          undefined,
          { metadataOnly: true },
        );
      const writes: string[] = [];
      let lost = false;
      const client = createClient(async (path, init) => {
        if (init?.method) writes.push(`${init.method} ${path}`);
        const response = await f.raw(path, init);
        if (loseCompleteAck && !lost && path.endsWith("/complete")) {
          expect(response.ok).toBe(true);
          lost = true;
          throw new TypeError("Synthetic lost complete response");
        }
        return response;
      });
      const original = "Synthetic twentieth original with exact bytes";
      const source = new File([original], "twentieth.txt", { type: "text/plain" });
      if (loseCompleteAck)
        await expect(
          client.upload(f.workspace.id, source, undefined, { metadataOnly: true }),
        ).rejects.toThrow("Synthetic lost complete response");
      const uploaded = await client.upload(f.workspace.id, source, undefined, {
        metadataOnly: true,
      });
      expect(uploaded.status).toBe("waiting");
      expect(writes.filter((path) => path.endsWith("/files"))).toHaveLength(1);
      expect(writes.filter((path) => path.includes("/parts/"))).toHaveLength(1);
      expect(writes.filter((path) => path.endsWith("/complete"))).toHaveLength(1);
      expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_upload_sessions").get()).toEqual({
        count: 20,
      });
      const pageSchema = z.array(z.object({ id: z.string() }));
      const firstPage = pageSchema.parse(
        await (await f.raw(`/api/v2/cases/${f.workspace.id}/files`)).json(),
      );
      expect(firstPage).toHaveLength(20);
      expect(
        pageSchema.parse(
          await (
            await f.raw(`/api/v2/cases/${f.workspace.id}/files?afterId=${firstPage.at(-1)?.id}`)
          ).json(),
        ),
      ).toEqual([]);
      const reloaded = createClient(f.raw);
      expect(await reloaded.list(f.workspace.id, { metadataOnly: true })).toHaveLength(20);
      expect(await (await reloaded.original(f.workspace.id, uploaded.id)).text()).toBe(original);
    } finally {
      f.db.close();
    }
  });

test("both standard TIFF filename extensions pass upload validation", () => {
  for (const extension of ["tif", "tiff", "TIF", "TIFF"])
    expect(() =>
      validateUpload(
        new File([new Uint8Array([73, 73, 42, 0])], `scan.${extension}`, { type: "image/tiff" }),
      ),
    ).not.toThrow();
});

async function publishSyntheticRevision(f: Awaited<ReturnType<typeof fixture>>) {
  const current = await f.service.find(f.owner.userId, f.workspace.id);
  const guard = {
    ownerId: f.owner.userId,
    workspaceId: f.workspace.id,
    expectedRevision: current.workspaceRevision,
    now: f.now,
  };
  const claim = crypto.randomUUID();
  // The same atomic workspace revision increment used by file publication;
  // this test does not claim to execute the native processor itself.
  expect(
    await f.core.changed([
      f.core.claim(guard, claim),
      f.core.bump(guard, claim),
      f.core.finish(claim),
    ]),
  ).toBe(true);
}

for (const timing of ["during-list", "after-revision"] as const)
  test(`new upload reconciles metadata before freezing its revision, retaining later CAS: ${timing}`, async () => {
    const f = await fixture();
    try {
      let changed = false,
        reservations = 0;
      const calls: string[] = [];
      const client = createClient(async (path, init) => {
        const method = init?.method ?? "GET";
        calls.push(`${method} ${path}`);
        if (method === "POST" && path.endsWith("/files")) reservations++;
        const response = await f.raw(path, init);
        if (
          !changed &&
          method === "GET" &&
          path.endsWith(timing === "during-list" ? "/files" : "/workspace")
        ) {
          changed = true;
          await publishSyntheticRevision(f);
        }
        return response;
      });
      const source = new File(
        ["Synthetic original survives a concurrent publication"],
        "publication.txt",
        { type: "text/plain" },
      );
      if (timing === "during-list") {
        const result = await client.upload(f.workspace.id, source, undefined, {
          metadataOnly: true,
        });
        expect(result.status).toBe("waiting");
        expect(calls).toHaveLength(7); // Two revision reads, two metadata lists, no duplicate list/retry.
        expect(await (await client.original(f.workspace.id, result.id)).text()).toBe(
          await source.text(),
        );
      } else {
        await expect(
          client.upload(f.workspace.id, source, undefined, { metadataOnly: true }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(calls).toHaveLength(3);
        expect(await client.list(f.workspace.id)).toEqual([]);
        expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_upload_sessions").get()).toEqual(
          { count: 0 },
        );
      }
      expect(reservations).toBe(1);
    } finally {
      f.db.close();
    }
  });

test("an unknown reservation response retains its original key and revision across an explicit retry", async () => {
  const f = await fixture();
  try {
    const reservations: { key: string | null; revision: string | null }[] = [];
    const client = createClient(async (path, init) => {
      if (init?.method === "POST" && path.endsWith("/files")) {
        const headers = new Headers(init.headers);
        reservations.push({
          key: headers.get("idempotency-key"),
          revision: headers.get("if-match"),
        });
        if (reservations.length === 1) throw new TypeError("Synthetic unknown reservation outcome");
      }
      return f.raw(path, init);
    });
    const source = new File(["Synthetic uncertain original"], "unknown.txt", {
      type: "text/plain",
    });
    await expect(
      client.upload(f.workspace.id, source, undefined, { metadataOnly: true }),
    ).rejects.toThrow("unknown reservation outcome");
    await publishSyntheticRevision(f);
    await expect(
      client.upload(f.workspace.id, source, undefined, { metadataOnly: true }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(reservations).toHaveLength(2);
    expect(reservations[1]).toEqual(reservations[0]);
    expect(await client.list(f.workspace.id)).toEqual([]);
    // Only the definite conflict releases the old key. A further user retry
    // creates one fresh reservation, preserving the original bytes.
    const result = await client.upload(f.workspace.id, source, undefined, { metadataOnly: true });
    expect(reservations).toHaveLength(3);
    expect(reservations[2]?.key).not.toBe(reservations[0]?.key);
    expect(reservations[2]?.revision).not.toBe(reservations[0]?.revision);
    expect(await (await client.original(f.workspace.id, result.id)).text()).toBe(
      await source.text(),
    );
  } finally {
    f.db.close();
  }
});

for (const lost of ["reservation", "complete"] as const)
  test(`unstable metadata read preserves an unknown ${lost} attempt until explicit recovery`, async () => {
    const f = await fixture();
    try {
      let loseAck = true,
        rejectList = false;
      const reservations: { key: string | null; revision: string | null }[] = [];
      const writes: string[] = [];
      const client = createClient(async (path, init) => {
        if (!init?.method && path.endsWith("/files") && rejectList) {
          rejectList = false;
          return Response.json(
            { error: { code: "STORAGE_UNAVAILABLE", retryable: true } },
            { status: 503 },
          );
        }
        if (init?.method) writes.push(`${init.method} ${path}`);
        if (init?.method === "POST" && path.endsWith("/files")) {
          const headers = new Headers(init.headers);
          reservations.push({
            key: headers.get("idempotency-key"),
            revision: headers.get("if-match"),
          });
          if (loseAck && lost === "reservation") {
            loseAck = false;
            throw new TypeError("Synthetic unknown reservation outcome");
          }
        }
        const response = await f.raw(path, init);
        if (loseAck && lost === "complete" && path.endsWith("/complete")) {
          expect(response.ok).toBe(true);
          loseAck = false;
          throw new TypeError("Synthetic unknown complete outcome");
        }
        return response;
      });
      const source = new File(["Synthetic preserved recovery bytes"], "preserved.txt", {
        type: "text/plain",
      });
      await expect(
        client.upload(f.workspace.id, source, undefined, { metadataOnly: true }),
      ).rejects.toThrow(`Synthetic unknown ${lost} outcome`);
      rejectList = true;
      const before = writes.length;
      await expect(
        client.upload(f.workspace.id, source, undefined, { metadataOnly: true }),
      ).rejects.toMatchObject({ code: "UNAVAILABLE", retryable: true });
      expect(writes).toHaveLength(before); // No mutation or automatic retry after the denied page.
      const saved = await client.upload(f.workspace.id, source, undefined, { metadataOnly: true });
      expect(reservations).toHaveLength(lost === "reservation" ? 2 : 1);
      if (lost === "reservation") expect(reservations[1]).toEqual(reservations[0]);
      expect(writes.filter((path) => path.includes("/parts/"))).toHaveLength(1);
      expect(writes.filter((path) => path.endsWith("/complete"))).toHaveLength(1);
      expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_upload_sessions").get()).toEqual({
        count: 1,
      });
      expect(await (await client.original(f.workspace.id, saved.id)).text()).toBe(
        await source.text(),
      );
    } finally {
      f.db.close();
    }
  });
