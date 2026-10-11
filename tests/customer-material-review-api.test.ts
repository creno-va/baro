import { expect, test } from "bun:test";
import { createFilesApi } from "../src/client/api/files";
import type { V2FileObservation } from "../src/contracts/v2";
import { reportHttpFixture } from "./helpers/report-http-fixture";
import { seedTestSession } from "./helpers/session";

test("customer adapter uses real bounded file corrections, recovers lost acknowledgements and preserves read permissions", async () => {
  const f = await reportHttpFixture();
  try {
    const fileId = f.selectedFileId;
    const meta = f.db.sqlite
      .query("SELECT revision,coverage_snapshot_id FROM v2_files WHERE id=?")
      .get(fileId) as { revision: number; coverage_snapshot_id: string };
    for (let ordinal = 0; ordinal < 9; ordinal++) {
      const id = crypto.randomUUID();
      const value: V2FileObservation = {
        id: `observation-${ordinal}`,
        text: `합성 원본 ${ordinal}`,
        position: { kind: "document", page: 1, paragraph: ordinal + 1, table: null },
        certainty: "observed",
        userEdited: false,
        included: true,
      };
      const envelope = await f.core.encrypt(
        "v2_file_observations",
        id,
        f.actor.ownerId,
        meta.revision,
        value,
      );
      f.db.sqlite
        .query(
          "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload,snapshot_id) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          value.id,
          fileId,
          meta.revision,
          meta.revision,
          ordinal,
          envelope,
          meta.coverage_snapshot_id,
        );
    }
    let cookie = f.cookie,
      lostStart = true,
      lostContinue = true;
    const starts: RequestInit[] = [];
    const transport = async (path: string, init?: RequestInit) => {
      const response = await f.app.request(
        path,
        {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            cookie,
            origin: f.env.BETTER_AUTH_URL,
          },
        },
        f.env,
      );
      if (init?.method === "PATCH") {
        starts.push(init);
        if (response.ok && lostStart) {
          lostStart = false;
          throw new Error("Synthetic response loss after durable start");
        }
      }
      if (path.endsWith("/continue") && response.ok && lostContinue) {
        lostContinue = false;
        throw new Error("Synthetic response loss after continuation");
      }
      return response;
    };
    const client = createFilesApi(transport);
    const before = await client.review(f.workspaceId, fileId);
    expect(before.observations).toHaveLength(4);
    expect(before.coverage).toMatchObject({ category: "document", pageCount: 1 });
    const second = await client.review(f.workspaceId, fileId, before.nextAfterOrdinal ?? -1);
    expect(second.observations[0]?.ordinal).toBe(4);
    const input = {
      expectedRevision: before.file.revision,
      edits: [{ observationId: "observation-0", text: "교정한 첫 자료", included: false }],
    };
    await expect(
      client.saveReview(f.workspaceId, fileId, input, before.workspaceRevision),
    ).rejects.toThrow("Synthetic response loss");
    let result = await client.saveReview(f.workspaceId, fileId, input, before.workspaceRevision);
    expect(starts[0]?.body).toBe(starts[1]?.body);
    expect(new Headers(starts[0]?.headers).get("idempotency-key")).toBe(
      new Headers(starts[1]?.headers).get("idempotency-key"),
    );
    expect(new Headers(starts[0]?.headers).get("if-match")).toBe(String(before.workspaceRevision));
    const reconnect = createFilesApi(transport);
    expect((await reconnect.review(f.workspaceId, fileId)).pendingReview?.reviewId).toBe(
      result.reviewId,
    );
    await expect(reconnect.continueReview(f.workspaceId, fileId, result.reviewId)).rejects.toThrow(
      "Synthetic response loss",
    );
    do {
      result = await reconnect.continueReview(f.workspaceId, fileId, result.reviewId);
    } while (result.status === "saving");
    expect(result.status).toBe("ready");
    const saved = await createFilesApi(transport).review(f.workspaceId, fileId);
    expect(saved.pendingReview).toBeNull();
    expect(saved.observations[0]).toMatchObject({
      value: { text: "교정한 첫 자료", included: false },
      original: { text: "합성 원본 0", included: true },
    });
    expect(saved.file.revision).toBe(before.file.revision + 1);
    await expect(
      client.saveReview(f.workspaceId, fileId, input, before.workspaceRevision),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
    expect((await reconnect.review(f.workspaceId, fileId)).observations[0]?.value.included).toBe(
      false,
    );
    await expect(
      reconnect.saveReview(
        f.workspaceId,
        fileId,
        { ...input, expectedRevision: saved.file.revision },
        saved.workspaceRevision,
      ),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    const peer = await seedTestSession(f.db, { consent: true });
    cookie = peer.cookie;
    await expect(reconnect.review(f.workspaceId, fileId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  } finally {
    f.db.close();
  }
});

test("large multibyte corrections use bounded batches and recover a lost later-batch acknowledgement", async () => {
  const f = await reportHttpFixture();
  try {
    const fileId = f.selectedFileId;
    const source = f.db.sqlite
      .query("SELECT revision,coverage_snapshot_id FROM v2_files WHERE id=?")
      .get(fileId) as { revision: number; coverage_snapshot_id: string };
    const edits = [];
    for (let ordinal = 0; ordinal < 5; ordinal++) {
      const id = crypto.randomUUID();
      const value: V2FileObservation = {
        id: `large-observation-${ordinal}`,
        text: `합성 원본 ${ordinal}`,
        position: { kind: "document", page: 1, paragraph: ordinal + 1, table: null },
        certainty: "observed",
        userEdited: false,
        included: true,
      };
      const envelope = await f.core.encrypt(
        "v2_file_observations",
        id,
        f.actor.ownerId,
        source.revision,
        value,
      );
      f.db.sqlite
        .query(
          "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload,snapshot_id) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          value.id,
          fileId,
          source.revision,
          source.revision,
          ordinal,
          envelope,
          source.coverage_snapshot_id,
        );
      edits.push({ observationId: value.id, text: "가".repeat(5000), included: ordinal !== 4 });
    }
    const starts: RequestInit[] = [];
    const transport = async (path: string, init?: RequestInit) => {
      const response = await f.app.request(
        path,
        {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            cookie: f.cookie,
            origin: f.env.BETTER_AUTH_URL,
          },
        },
        f.env,
      );
      if (init?.method === "PATCH") {
        starts.push(init);
        expect(new TextEncoder().encode(String(init.body)).byteLength).toBeLessThanOrEqual(
          64 * 1024,
        );
        if (starts.length === 2 && response.ok)
          throw new Error("Synthetic later-batch acknowledgement loss");
      }
      return response;
    };
    const client = createFilesApi(transport);
    const before = await client.review(f.workspaceId, fileId);
    const input = { expectedRevision: before.file.revision, edits };
    expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBeGreaterThan(64 * 1024);
    await expect(
      client.saveReview(f.workspaceId, fileId, input, before.workspaceRevision),
    ).rejects.toThrow("later-batch");
    const result = await client.saveReview(f.workspaceId, fileId, input, before.workspaceRevision);
    expect(result.status).toBe("ready");
    expect(result.revision).toBe(before.file.revision + 2);
    expect(starts).toHaveLength(3);
    expect(starts[1]?.body).toBe(starts[2]?.body);
    expect(new Headers(starts[1]?.headers).get("idempotency-key")).toBe(
      new Headers(starts[2]?.headers).get("idempotency-key"),
    );
    const first = await client.review(f.workspaceId, fileId);
    const last = await client.review(f.workspaceId, fileId, first.nextAfterOrdinal ?? -1);
    for (const row of [...first.observations, ...last.observations]) {
      expect(row.value.text).toBe("가".repeat(5000));
      expect(row.original.text).toBe(`합성 원본 ${row.ordinal}`);
      expect(row.value.included).toBe(row.ordinal !== 4);
    }
  } finally {
    f.db.close();
  }
});

test("peer edits between bounded batches preserve committed corrections and reject the remainder", async () => {
  const f = await reportHttpFixture();
  try {
    const fileId = f.selectedFileId;
    const source = f.db.sqlite
      .query("SELECT revision,coverage_snapshot_id FROM v2_files WHERE id=?")
      .get(fileId) as { revision: number; coverage_snapshot_id: string };
    const edits = [];
    for (let ordinal = 0; ordinal < 5; ordinal++) {
      const id = crypto.randomUUID();
      const value: V2FileObservation = {
        id: `large-observation-${ordinal}`,
        text: `합성 원본 ${ordinal}`,
        position: { kind: "document", page: 1, paragraph: ordinal + 1, table: null },
        certainty: "observed",
        userEdited: false,
        included: true,
      };
      const envelope = await f.core.encrypt(
        "v2_file_observations",
        id,
        f.actor.ownerId,
        source.revision,
        value,
      );
      f.db.sqlite
        .query(
          "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload,snapshot_id) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          value.id,
          fileId,
          source.revision,
          source.revision,
          ordinal,
          envelope,
          source.coverage_snapshot_id,
        );
      edits.push({ observationId: value.id, text: "가".repeat(5000), included: ordinal !== 4 });
    }
    const starts: RequestInit[] = [];
    const transport = async (path: string, init?: RequestInit) => {
      if (init?.method === "PATCH" && starts.length === 1)
        f.db.sqlite
          .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
          .run(f.workspaceId);
      const response = await f.app.request(
        path,
        {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            cookie: f.cookie,
            origin: f.env.BETTER_AUTH_URL,
          },
        },
        f.env,
      );
      if (init?.method === "PATCH") {
        starts.push(init);
        expect(new TextEncoder().encode(String(init.body)).byteLength).toBeLessThanOrEqual(
          64 * 1024,
        );
      }
      return response;
    };
    const client = createFilesApi(transport);
    const before = await client.review(f.workspaceId, fileId);
    const input = { expectedRevision: before.file.revision, edits };
    expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBeGreaterThan(64 * 1024);
    await expect(
      client.saveReview(f.workspaceId, fileId, input, before.workspaceRevision),
    ).rejects.toMatchObject({ code: "CONFLICT", completedReviewEdits: 4 });
    expect(starts).toHaveLength(2);
    const first = await client.review(f.workspaceId, fileId);
    const last = await client.review(f.workspaceId, fileId, first.nextAfterOrdinal ?? -1);
    for (const row of [...first.observations, ...last.observations]) {
      expect(row.value.text).toBe(row.ordinal < 4 ? "가".repeat(5000) : "합성 원본 4");
      expect(row.original.text).toBe(`합성 원본 ${row.ordinal}`);
      expect(row.value.included).toBe(true);
    }
  } finally {
    f.db.close();
  }
});
