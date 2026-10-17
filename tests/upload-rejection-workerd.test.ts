import { afterEach, expect, test } from "bun:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { createV2UploadProbeRepository } from "../src/server/db/v2-upload-probe";
import { fixture } from "./helpers/file-processing-fixture";
import { copySyntheticD1 } from "./helpers/native-d1";
import { nativeD1Transport, nativeD1TransportWorker } from "./helpers/native-d1-transport";
import { createNativeTestRegistry } from "./helpers/native-lifetime";

const native = createNativeTestRegistry();
afterEach(() => native.stop());

test("workerd D1 atomically publishes upload refusal and fences session/metadata races", () =>
  native.run(async (lifetime) => {
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        host: "127.0.0.1",
        modules: true,
        script: nativeD1TransportWorker,
        compatibilityDate: "2026-10-01",
        d1Databases: ["ACCEPT", "SESSION", "METADATA"],
        cf: false,
        unsafeRegisterWorker: false,
      }),
    );
    lifetime.own(() => mf.dispose());
    await mf.ready;

    for (const changed of ["ACCEPT", "SESSION", "METADATA"] as const) {
      lifetime.check();
      const f = await fixture();
      const upload = await f.service.reserve(
        f.actor.ownerId,
        f.workspaceId,
        f.rev(),
        crypto.randomUUID(),
        {
          name: "synthetic-protected.xls",
          byteLength: 3,
          mediaType: "application/vnd.ms-excel",
          autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
        },
      );
      // Real encrypted synthetic part/storage reservation; no native/provider call.
      await f.service.putPart(
        f.actor.ownerId,
        f.workspaceId,
        upload.fileId,
        upload.uploadSession,
        0,
        new Response(new Uint8Array([1, 2, 3])).body,
      );
      const row = f.db.sqlite
        .query("SELECT operation_id,revision FROM v2_files WHERE id=?")
        .get(upload.fileId) as { operation_id: string; revision: number };
      const session = f.db.sqlite
        .query("SELECT id FROM session WHERE user_id=?")
        .get(f.actor.ownerId) as { id: string };
      const lease = { jobId: crypto.randomUUID(), token: crypto.randomUUID(), fencing: 1 };
      const until = new Date(Date.parse(f.actor.now) + 300_000).toISOString();
      // Paid attach is covered separately in SQLite; isolate the exact native
      // final SQL/transaction using a schema-valid synthetic inline probe lease.
      f.db.sqlite
        .query(`INSERT INTO v2_jobs(id,operation_id,runtime_instance_id,workspace_id,
        target_kind,target_id,target_revision,kind,status,phase,attempts,fencing,lease_token,lease_until,created_at,updated_at)
        VALUES(?,?,?,?,'file',?,?,'file_processing','running','extracting',1,1,?,?,?,?)`)
        .run(
          lease.jobId,
          row.operation_id,
          `${lease.jobId}-1`,
          f.workspaceId,
          upload.fileId,
          row.revision,
          lease.token,
          until,
          f.actor.now,
          f.actor.now,
        );
      f.db.sqlite
        .query("UPDATE v2_files SET current_job_id=? WHERE id=?")
        .run(lease.jobId, upload.fileId);

      const db = nativeD1Transport(mf, changed);
      await copySyntheticD1(db, f.db.sqlite);
      const core = createV2Core(db, f.core.cipher);
      const probes = createV2UploadProbeRepository(core);
      const fileBefore = await db
        .prepare("SELECT state,revision,failure_code FROM v2_files WHERE id=?")
        .bind(upload.fileId)
        .first<Record<string, unknown>>();
      const uploadBefore = await db
        .prepare("SELECT * FROM v2_upload_sessions WHERE id=?")
        .bind(upload.uploadSession)
        .first<Record<string, unknown>>();
      const retainedTables = [
        "v2_storage_reservations",
        "v2_upload_parts",
        "v2_blobs",
        "v2_operations",
      ];
      const retained = await Promise.all(
        retainedTables.map(
          async (table) => (await db.prepare(`SELECT * FROM ${table}`).all()).results,
        ),
      );
      const reservations = retained[0],
        parts = retained[1];
      if (!reservations || !parts) throw new Error("Synthetic retained upload rows missing");
      expect(reservations.length).toBeGreaterThan(0);
      expect(parts.length).toBeGreaterThan(0);

      let raced = false;
      const encrypt = core.encrypt;
      if (changed !== "ACCEPT")
        core.encrypt = async (...args: Parameters<typeof encrypt>) => {
          const envelope = await encrypt(...args);
          expect(raced).toBe(false);
          raced = true;
          if (changed === "SESSION")
            await db.prepare("DELETE FROM session WHERE id=?").bind(session.id).run();
          else {
            const replacement = await encrypt(args[0], args[1], args[2], args[3], {
              name: "synthetic-concurrent.xls",
              declaredMediaType: "application/vnd.ms-excel",
              probe: null,
            });
            await db
              .prepare("UPDATE v2_files SET encrypted_payload=? WHERE id=?")
              .bind(replacement, upload.fileId)
              .run();
          }
          return envelope;
        };
      expect(
        await probes.finish(f.actor, upload.uploadSession, 1, lease, "rejected", session.id),
      ).toBe(changed === "ACCEPT");
      expect(raced).toBe(changed !== "ACCEPT");
      const metadata = await createV2FilesRepository(core).metadata(f.actor, upload.fileId);
      expect(metadata?.uploadRejection).toBe(changed === "ACCEPT" ? "FILE_REJECTED" : undefined);
      if (changed === "METADATA") expect(metadata?.name).toBe("synthetic-concurrent.xls");
      expect(
        await db
          .prepare("SELECT state,revision,failure_code FROM v2_files WHERE id=?")
          .bind(upload.fileId)
          .first<Record<string, unknown>>(),
      ).toEqual(fileBefore);
      expect(
        await db
          .prepare("SELECT * FROM v2_upload_sessions WHERE id=?")
          .bind(upload.uploadSession)
          .first<Record<string, unknown>>(),
      ).toEqual(uploadBefore);
      for (const [index, table] of retainedTables.entries()) {
        const previous = retained[index];
        if (!previous) throw new Error("Synthetic retained table missing");
        expect((await db.prepare(`SELECT * FROM ${table}`).all()).results).toEqual(previous);
      }
      expect(
        await db
          .prepare("SELECT current_job_id FROM v2_files WHERE id=?")
          .bind(upload.fileId)
          .first<string>("current_job_id"),
      ).toBe(changed === "ACCEPT" ? null : lease.jobId);
      expect(
        await db
          .prepare("SELECT status,lease_token,fencing FROM v2_jobs WHERE id=?")
          .bind(lease.jobId)
          .first<{ status: string; lease_token: string | null; fencing: number }>(),
      ).toEqual(
        changed === "ACCEPT"
          ? { status: "cancelled", lease_token: null, fencing: 2 }
          : { status: "running", lease_token: lease.token, fencing: 1 },
      );
      expect((await db.prepare("SELECT * FROM v2_mutation_claims").all()).results).toEqual([]);
      expect((await db.prepare("SELECT * FROM v2_outbox").all()).results).toEqual([]);
    }
  }));
