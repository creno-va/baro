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
