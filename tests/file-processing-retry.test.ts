import { expect, test } from "bun:test";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createFileRetry } from "../src/server/modules/file-processing/retry";
import { fixture, uploaded } from "./helpers/file-processing-fixture";
import { seedTestSession } from "./helpers/session";

async function failedFile() {
  const f = await fixture(),
    u = await uploaded(f),
    jobs = createV2JobsRepository(f.core),
    jobId = `file-processing-${crypto.randomUUID()}`;
  expect(
    await jobs.admitFile(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      {
        fileId: u.session.fileId,
        fileRevision: 2,
        jobId,
        admission: {
          operationId: crypto.randomUUID(),
          key: crypto.randomUUID(),
          requestHash: u.manifest.contentHash,
        },
        quotas: [{ kind: "visible_ai_response", units: 1, responseKind: "file_interpretation" }],
      },
    ),
  ).toBe(true);
  const acquired = await jobs.acquire(
    f.actor,
    jobId,
    crypto.randomUUID(),
    new Date(Date.parse(f.actor.now) + 60000).toISOString(),
  );
  if (!acquired) throw new Error("synthetic lease missing");
  expect(await jobs.fail(f.actor, acquired.lease, "FILE_PROCESSING_FAILED", true)).toBe(true);
  const retry = createFileRetry(f.core, { APP_ENV: "preview" } as Env, {
    testOnlyUnmeteredStorage: true,
    clock: () => f.actor.now,
  });
  const input = () => ({ expectedRevision: f.rev(), fileRevision: 2 });
  return { ...f, u, jobs, jobId, oldLease: acquired.lease, retry, input };
}
test("actual failed file retry keeps immutable original and operation, creates one outbox and fences the old lease", async () => {
  const f = await failedFile(),
    before = f.db.sqlite
      .query("SELECT manifest_snapshot_id FROM v2_files WHERE id=?")
      .get(f.u.session.fileId),
    count = Number(
      (f.db.sqlite.query("SELECT count(*) n FROM v2_outbox").get() as { n: number }).n,
    );
  expect(
    (await f.retry(f.actor.ownerId, f.workspaceId, f.u.session.fileId, f.input()))?.status,
  ).toBe("queued");
  expect(
    (await f.retry(f.actor.ownerId, f.workspaceId, f.u.session.fileId, f.input()))?.status,
  ).toBe("queued");
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_outbox").get()).toEqual({ n: count + 1 });
  expect(
    f.db.sqlite
      .query("SELECT manifest_snapshot_id FROM v2_files WHERE id=?")
      .get(f.u.session.fileId),
  ).toEqual(before);
  expect(
    f.db.sqlite.query("SELECT runtime_instance_id FROM v2_jobs WHERE id=?").get(f.jobId),
  ).toEqual({ runtime_instance_id: `${f.jobId}-2` });
  expect(
    await f.jobs.renew(
      f.actor,
      f.oldLease,
      new Date(Date.parse(f.actor.now) + 120000).toISOString(),
    ),
  ).toBe(false);
  expect(await f.jobs.fail(f.actor, f.oldLease, "FILE_PROCESSING_FAILED", true)).toBe(false);
  const next = await f.jobs.acquire(
    f.actor,
    f.jobId,
    crypto.randomUUID(),
    new Date(Date.parse(f.actor.now) + 60000).toISOString(),
  );
  expect(next?.job.attempts).toBe(2);
});
test("peer owner, stale revisions and withdrawn processing consent cannot dispatch a retry", async () => {
  const f = await failedFile(),
    peer = await seedTestSession(f.db, { consent: true, now: Date.parse(f.actor.now) });
  await expect(f.retry(peer.userId, f.workspaceId, f.u.session.fileId, f.input())).rejects.toThrow(
    "NOT_FOUND",
  );
  await expect(
    f.retry(f.actor.ownerId, f.workspaceId, f.u.session.fileId, {
      ...f.input(),
      expectedRevision: 999,
    }),
  ).rejects.toThrow("CONFLICT");
  f.db.sqlite
    .query("UPDATE v2_consents SET version='old' WHERE file_id=? AND kind='auto_processing'")
    .run(f.u.session.fileId);
  await expect(
    f.retry(f.actor.ownerId, f.workspaceId, f.u.session.fileId, f.input()),
  ).rejects.toThrow("CONFLICT");
  f.db.sqlite
    .query("UPDATE v2_consents SET version=? WHERE file_id=? AND kind='auto_processing'")
    .run(CURRENT_POLICY_VERSIONS.aiNoticeVersion, f.u.session.fileId);
  const actual = createFileRetry(f.core, { APP_ENV: "preview" } as Env, {
    clock: () => f.actor.now,
  });
  await expect(
    actual(f.actor.ownerId, f.workspaceId, f.u.session.fileId, f.input()),
  ).rejects.toThrow("PROCESSING_UNAVAILABLE");
  expect(f.db.sqlite.query("SELECT status FROM v2_jobs WHERE id=?").get(f.jobId)).toEqual({
    status: "failed",
  });
});
test("delete and a failed retry cannot revive a job, its originals or reservations", async () => {
  const f = await failedFile(),
    input = f.input();
  expect(
    await createV2DeletionRepository(f.core).file(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      f.u.session.fileId,
      2,
    ),
  ).toBe(true);
  await expect(f.retry(f.actor.ownerId, f.workspaceId, f.u.session.fileId, input)).rejects.toThrow(
    "NOT_FOUND",
  );
  expect(
    await f.jobs.renew(
      f.actor,
      f.oldLease,
      new Date(Date.parse(f.actor.now) + 60000).toISOString(),
    ),
  ).toBe(false);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_files").get()).toEqual({ n: 0 });
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_deletion_targets WHERE kind='blob'").get(),
  ).toEqual({ n: 1 });
});
