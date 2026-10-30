import { expect, test } from "bun:test";
import type { WorkspaceTransport } from "@baro/api-client";
import {
  FILE_TARGET_UPLOAD_CONSISTENCY,
  UPLOAD_CONSISTENCY_HEADER,
  V2_LIMITS,
} from "@baro/contracts/v2";
import { seedTestSession } from "./helpers/session";
import { uploadRecoveryHttpFixture as fixture } from "./helpers/upload-recovery-http";

test("parallel browser-style chunks survive reordered ACKs through signed HTTP, encrypted R2 and final digest validation", async () => {
  const bytes = new Uint8Array(V2_LIMITS.chunkBytes * 3 + 17).fill(65);
  bytes[bytes.length - 1] = 90;
  const f = await fixture({ bytes });
  const writes: number[] = [];
  let active = 0,
    maximum = 0;
  try {
    const request: WorkspaceTransport = async (path, init) => {
      const match = /\/parts\/(\d+)$/.exec(path);
      if (!match) return f.transport(path, init);
      const index = Number(match[1]);
      if (index) expect(writes).toContain(0);
      active++;
      maximum = Math.max(maximum, active);
      const response = await f.transport(path, init);
      await Bun.sleep(index === 1 ? 30 : 1);
      writes.push(index);
      active--;
      return response;
    };
    const result = await f
      .client(request, false, undefined, { uploadConcurrency: 3 })
      .upload(f.workspace.id, f.source, undefined, { metadataOnly: true });
    expect(result.status).toBe("waiting");
    expect(maximum).toBe(3);
    expect(writes[0]).toBe(0);
    expect(writes.toSorted()).toEqual([0, 1, 2, 3]);
  } finally {
    f.db.close();
  }
}, 30_000);

for (const recover of [false, true])
  test(`versioned completion crosses actual signed HTTP and a publication race; persisted recovery=${recover}`, async () => {
    let f: Awaited<ReturnType<typeof fixture>>;
    let probes = 0;
    f = await fixture({
      onProbe: () => {
        probes++;
        f.db.sqlite
          .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
          .run(f.workspace.id);
      },
    });
    try {
      const writes: { path: string; headers: Headers }[] = [];
      const request: WorkspaceTransport = async (path, init) => {
        if (init?.method) writes.push({ path, headers: new Headers(init.headers) });
        return f.transport(path, init);
      };
      const result = await f
        .client(request, recover, undefined, {
          completionConsistency: FILE_TARGET_UPLOAD_CONSISTENCY,
        })
        .upload(f.workspace.id, f.source, undefined, { metadataOnly: true });
      expect(result.status).toBe("waiting");
      expect(probes).toBe(1);
      expect(writes.filter((w) => w.path.endsWith("/complete"))).toHaveLength(1);
      for (const write of writes)
        expect(write.headers.get(UPLOAD_CONSISTENCY_HEADER)).toBe(
          write.path.endsWith("/complete") ? FILE_TARGET_UPLOAD_CONSISTENCY : null,
        );
      expect(f.db.sqlite.query("SELECT state FROM v2_upload_sessions").get()).toEqual({
        state: "finalized",
      });
      expect(f.records.size).toBe(0);
      const original = await f.fileService.content(f.owner.userId, f.workspace.id, result.id);
      expect(new Uint8Array(await new Response(original.body).arrayBuffer())).toEqual(f.bytes);
    } finally {
      f.db.close();
    }
  });

for (const mode of ["absent", "unsupported"] as const)
  test(`HTTP completion ${mode} does not silently opt in to file-target consistency`, async () => {
    let f: Awaited<ReturnType<typeof fixture>>;
    let probes = 0;
    f = await fixture({
      onProbe: () => {
        probes++;
        f.db.sqlite
          .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
          .run(f.workspace.id);
      },
    });
    try {
      const request: WorkspaceTransport = (path, init) => {
        if (mode !== "unsupported" || !path.endsWith("/complete")) return f.transport(path, init);
        const headers = new Headers(init?.headers);
        headers.set(UPLOAD_CONSISTENCY_HEADER, "file-target-unsupported");
        return f.transport(path, { ...init, headers });
      };
      await expect(
        f
          .client(request, false)
          .upload(f.workspace.id, f.source, undefined, { metadataOnly: true }),
      ).rejects.toMatchObject({ code: mode === "absent" ? "CONFLICT" : "VALIDATION_ERROR" });
      expect(probes).toBe(mode === "absent" ? 1 : 0);
      expect(f.db.sqlite.query("SELECT state FROM v2_upload_sessions").get()).toEqual({
        state: "open",
      });
    } finally {
      f.db.close();
    }
  });

for (const failure of ["reservation", "part", "complete", "projection"] as const)
  test(`real signed Hono/SQL/AES upload survives lost ${failure} across client recreation with one stored original`, async () => {
    const f = await fixture();
    try {
      let lost = false,
        committed = false;
      const writes: { path: string; init: RequestInit }[] = [];
      const request: WorkspaceTransport = async (path, init = {}) => {
        if (init.method && init.method !== "GET") writes.push({ path, init });
        const response = await f.transport(path, init);
        if (path.endsWith("/complete") && response.ok) committed = true;
        if (
          !lost &&
          response.ok &&
          ((failure === "reservation" && path.endsWith("/files") && init.method === "POST") ||
            (failure === "part" && path.includes("/parts/")) ||
            (failure === "complete" && path.endsWith("/complete")) ||
            (failure === "projection" && committed && path.endsWith("/files") && !init.method))
        ) {
          lost = true;
          throw new Error("SYNTHETIC_COMMITTED_RESPONSE_LOST");
        }
        return response;
      };
      await expect(
        f.client(request).upload(f.workspace.id, f.source, undefined, { metadataOnly: true }),
      ).rejects.toBeDefined();
      expect(lost).toBe(true);
      expect(f.records.size).toBe(1);
      const oldWrites = writes.length;
      const value = await f
        .client(request)
        .upload(f.workspace.id, { ...f.source }, undefined, { metadataOnly: true });
      expect(value.status).toBe("waiting");
      expect(f.records.size).toBe(0);
      if (failure === "complete" || failure === "projection") expect(writes.length).toBe(oldWrites);
      const originals = f.db.sqlite
        .query(
          "SELECT stored_count,reserved_count,stored_bytes FROM v2_case_original_usage WHERE workspace_id=?",
        )
        .get(f.workspace.id);
      expect(originals).toEqual({
        stored_count: 1,
        reserved_count: 0,
        stored_bytes: f.bytes.byteLength,
      });
      expect(
        f.db.sqlite.query("SELECT id FROM v2_files WHERE workspace_id=?").all(f.workspace.id),
      ).toHaveLength(1);
      const content = await f.fileService.content(f.owner.userId, f.workspace.id, value.id);
      expect(new Uint8Array(await new Response(content.body).arrayBuffer())).toEqual(f.bytes);
      for (const raw of f.records.values()) expect(raw.includes("uploadSession")).toBe(false);
    } finally {
      f.db.close();
    }
  });
test("a different real signed owner cannot consume or rewrite an uncertain reservation's operation or original bytes", async () => {
  const f = await fixture();
  try {
    let lost = false;
    const request: WorkspaceTransport = async (path, init) => {
      const response = await f.transport(path, init);
      if (!lost && response.ok && init?.method === "POST" && path.endsWith("/files")) {
        lost = true;
        throw new Error("SYNTHETIC_LOST_RESERVATION");
      }
      return response;
    };
    await expect(f.client(request).upload(f.workspace.id, f.source)).rejects.toBeDefined();
    const before = [...f.records.values()];
    const other = await seedTestSession(f.db, { consent: true });
    f.cookie(other.cookie);
    await expect(f.client().upload(f.workspace.id, f.source)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect([...f.records.values()]).toEqual(before);
    expect(f.receipts).toHaveLength(0);
    f.cookie(f.owner.cookie);
    const value = await f
      .client()
      .upload(f.workspace.id, f.source, undefined, { metadataOnly: true });
    expect(value.status).toBe("waiting");
    expect(
      f.db.sqlite.query("SELECT id FROM v2_files WHERE workspace_id=?").all(f.workspace.id),
    ).toHaveLength(1);
  } finally {
    f.db.close();
  }
});

test("real complete CAS remains frozen across ordinary retries and changes only on explicit conflict resolution", async () => {
  const f = await fixture();
  try {
    let changed = false;
    const commits: string[] = [];
    const request: WorkspaceTransport = async (path, init = {}) => {
      if (path.endsWith("/complete")) {
        commits.push(String(init.body));
        if (!changed) {
          changed = true;
          f.db.sqlite
            .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
            .run(f.workspace.id);
        }
      }
      return f.transport(path, init);
    };
    await expect(f.client(request).upload(f.workspace.id, f.source)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(f.client(request).upload(f.workspace.id, f.source)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(commits[0]).toBe(commits[1]);
    const result = await f
      .client(request)
      .upload(f.workspace.id, f.source, undefined, { resolveConflict: true, metadataOnly: true });
    expect(result.status).toBe("waiting");
    expect(commits[2]).not.toBe(commits[1]);
    expect(
      f.db.sqlite.query("SELECT id FROM v2_files WHERE workspace_id=?").all(f.workspace.id),
    ).toHaveLength(1);
  } finally {
    f.db.close();
  }
});

for (const knownId of [false, true])
  test(`expired upload ${knownId ? "with" : "without"} persisted file ID needs explicit restart and preserves the old server reservation`, async () => {
    const f = await fixture();
    try {
      let lost = false;
      const request: WorkspaceTransport = async (path, init) => {
        const response = await f.transport(path, init);
        if (
          !lost &&
          response.ok &&
          (knownId ? path.includes("/parts/") : path.endsWith("/files") && init?.method === "POST")
        ) {
          lost = true;
          throw new Error("SYNTHETIC_LOST_UPLOAD_ACK");
        }
        return response;
      };
      await expect(f.client(request).upload(f.workspace.id, f.source)).rejects.toBeDefined();
      f.setNow(new Date(Date.parse(f.now) + 2 * 3600000).toISOString());
      await expect(f.client().upload(f.workspace.id, f.source)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(
        f.db.sqlite.query("SELECT id FROM v2_files WHERE workspace_id=?").all(f.workspace.id),
      ).toHaveLength(1);
      const result = await f
        .client()
        .upload(f.workspace.id, f.source, undefined, { resolveConflict: true, metadataOnly: true });
      expect(result.status).toBe("waiting");
      expect(
        f.db.sqlite.query("SELECT id FROM v2_files WHERE workspace_id=?").all(f.workspace.id),
      ).toHaveLength(2);
      expect(
        f.db.sqlite
          .query(
            "SELECT id FROM v2_upload_sessions WHERE state='open' AND file_id IN (SELECT id FROM v2_files WHERE workspace_id=?)",
          )
          .all(f.workspace.id),
      ).toHaveLength(1);
    } finally {
      f.db.close();
    }
  });

test("a deleted accepted file is not silently replaced, but its confirmed exact 404 permits explicit reattachment", async () => {
  const f = await fixture();
  try {
    let lost = false;
    const request: WorkspaceTransport = async (path, init) => {
      const response = await f.transport(path, init);
      if (!lost && response.ok && path.endsWith("/complete")) {
        lost = true;
        throw new Error("SYNTHETIC_LOST_COMPLETE_ACK");
      }
      return response;
    };
    await expect(f.client(request).upload(f.workspace.id, f.source)).rejects.toBeDefined();
    const row = f.db.sqlite
      .query("SELECT id FROM v2_files WHERE workspace_id=?")
      .get(f.workspace.id) as { id: string };
    await f.client().remove(f.workspace.id, row.id);
    await expect(f.client().upload(f.workspace.id, f.source)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const result = await f
      .client()
      .upload(f.workspace.id, f.source, undefined, { resolveConflict: true, metadataOnly: true });
    expect(result.id).not.toBe(row.id);
    expect(result.status).toBe("waiting");
  } finally {
    f.db.close();
  }
});

test("a lost mobile reservation receipt recovers the exact file already completed by the default web client, even after session expiry", async () => {
  const f = await fixture();
  try {
    let lost = false;
    const request: WorkspaceTransport = async (path, init) => {
      const response = await f.transport(path, init);
      if (!lost && response.ok && init?.method === "POST" && path.endsWith("/files")) {
        lost = true;
        throw new Error("SYNTHETIC_LOST_MOBILE_RESERVATION");
      }
      return response;
    };
    await expect(f.client(request).upload(f.workspace.id, f.source)).rejects.toBeDefined();
    const original = [...f.records.values()];
    expect(JSON.parse(original[0] ?? "{}").fileId).toBeUndefined();
    const web = await f
      .client(f.transport, false)
      .upload(f.workspace.id, f.source, undefined, { metadataOnly: true });
    f.setNow(new Date(Date.parse(f.now) + 2 * 3600000).toISOString());
    const mobile = await f
      .client()
      .upload(f.workspace.id, f.source, undefined, { metadataOnly: true });
    expect(mobile.id).toBe(web.id);
    expect(mobile.status).toBe("waiting");
    expect(
      f.db.sqlite.query("SELECT id FROM v2_files WHERE workspace_id=?").all(f.workspace.id),
    ).toHaveLength(1);
    expect(f.records.size).toBe(0);
    expect(
      f.db.sqlite
        .query(
          "SELECT stored_count,reserved_count FROM v2_case_original_usage WHERE workspace_id=?",
        )
        .get(f.workspace.id),
    ).toEqual({ stored_count: 1, reserved_count: 0 });
  } finally {
    f.db.close();
  }
});
