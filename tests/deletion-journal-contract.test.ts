import { expect, test } from "bun:test";
import {
  createIsolatedJournalManifest,
  isolatedDrillResourceSchema,
  prepareReplay,
  validateIsolatedJournalManifest,
} from "../scripts/deletion-journal";

const resource = {
  environment: "isolated-test" as const,
  syntheticOnly: true as const,
  databaseId: "11111111-1111-4111-8111-111111111111",
  databaseName: "baro-drill-restore",
  workerName: "baro-drill-worker",
  workflowName: "baro-drill-workflow",
};
const job = {
  id: "22222222-2222-4222-8222-222222222222",
  target_type: "account" as const,
  target_id: "33333333-3333-4333-8333-333333333333",
  deleted_at: "2026-10-06T00:00:00.000Z",
  expires_at: "2026-11-10T00:00:00.000Z",
  workflow_instance_ids: ["44444444-4444-4444-8444-444444444444-1"],
};
const content = {
  version: 1 as const,
  candidateSha: "a".repeat(40),
  resource,
  exportedAt: "2026-10-06T01:00:00.000Z",
  journal: [job],
};
const expected = {
  resource,
  candidateSha: content.candidateSha,
  exportedNotBefore: "2026-10-06T00:30:00.000Z",
  now: "2026-10-06T02:00:00.000Z",
};

test("isolated journal checks metadata and payload integrity; JSON formatting does not alter the checksum", async () => {
  const manifest = await createIsolatedJournalManifest(content);
  expect(
    await validateIsolatedJournalManifest(JSON.parse(JSON.stringify(manifest, null, 4)), expected),
  ).toEqual(manifest);
  expect(prepareReplay(manifest.journal)).toContain("DELETE FROM user");
  for (const change of [
    { exportedAt: "2026-10-06T01:30:00.000Z" },
    { journal: [{ ...job, target_id: "55555555-5555-4555-8555-555555555555" }] },
    { journal: [] },
    { checksumSha256: "b".repeat(64) },
  ])
    await expect(
      validateIsolatedJournalManifest({ ...manifest, ...change }, expected),
    ).rejects.toThrow("JOURNAL_CHECKSUM_MISMATCH");
});

test("isolated journal cannot target ordinary preview, production or a different trusted resource/release", async () => {
  const manifest = await createIsolatedJournalManifest(content);
  for (const change of [
    { environment: "production" },
    { environment: "preview" },
    { syntheticOnly: false },
    { databaseName: "baro-preview" },
    { workerName: "baro-production" },
    { workflowName: "baro-analysis-preview" },
    { databaseId: "e8cdcf75-5bd8-469e-848e-f31816df4327" },
    { databaseId: "E8CDCF75-5BD8-469E-848E-F31816DF4327" },
    { databaseId: "d315e93f-2fac-4cc2-bf99-e9d6eb31523f" },
    { databaseId: "D315E93F-2FAC-4CC2-BF99-E9D6EB31523F" },
    { credentials: "forbidden" },
  ]) {
    expect(isolatedDrillResourceSchema.safeParse({ ...resource, ...change }).success).toBe(false);
    await expect(
      createIsolatedJournalManifest({ ...content, resource: { ...resource, ...change } }),
    ).rejects.toThrow();
  }
  for (const change of [
    { candidateSha: "b".repeat(40) },
    { resource: { ...resource, databaseId: "55555555-5555-4555-8555-555555555555" } },
    { resource: { ...resource, workerName: "baro-drill-other" } },
    { resource: { ...resource, workflowName: "baro-drill-other" } },
  ])
    await expect(
      validateIsolatedJournalManifest(manifest, { ...expected, ...change }),
    ).rejects.toThrow("JOURNAL_SCOPE_MISMATCH");
});

test("isolated journal rejects stale/future exports, post-export deletions and malformed retention or duplicates", async () => {
  const manifest = await createIsolatedJournalManifest(content);
  for (const change of [
    { exportedNotBefore: "2026-10-06T01:01:00.000Z" },
    { now: "2026-10-06T00:59:00.000Z" },
  ])
    await expect(
      validateIsolatedJournalManifest(manifest, { ...expected, ...change }),
    ).rejects.toThrow("JOURNAL_EXPORT_OUTSIDE_WINDOW");
  await expect(
    validateIsolatedJournalManifest(manifest, { ...expected, now: "2026-10-06T00:00:00.000Z" }),
  ).rejects.toThrow("JOURNAL_INVALID_EXPORT_WINDOW");
  await expect(
    createIsolatedJournalManifest({ ...content, exportedAt: "2026-10-05T23:59:00.000Z" }),
  ).rejects.toThrow("JOURNAL_EXPORT_PRECEDES_DELETION");
  for (const journal of [
    [job, job],
    [job, { ...job, target_id: "55555555-5555-4555-8555-555555555555" }],
    [{ ...job, expires_at: job.deleted_at }],
    [
      {
        ...job,
        workflow_instance_ids: [...job.workflow_instance_ids, ...job.workflow_instance_ids],
      },
    ],
    [{ ...job, narrative: "forbidden case payload" }],
  ])
    await expect(createIsolatedJournalManifest({ ...content, journal })).rejects.toThrow();
  await expect(
    validateIsolatedJournalManifest({ ...manifest, operatorApproved: true }, expected),
  ).rejects.toThrow();
  await expect(validateIsolatedJournalManifest([job], expected)).rejects.toThrow();
});

test("canonical journal checksum preserves all jobs and workflow IDs without depending on input order", async () => {
  const second = {
    ...job,
    id: "55555555-5555-4555-8555-555555555555",
    target_type: "case" as const,
  };
  const ids = [...job.workflow_instance_ids, "44444444-4444-4444-8444-444444444444-2"];
  const first = await createIsolatedJournalManifest({
    ...content,
    journal: [{ ...job, workflow_instance_ids: ids }, second],
  });
  const reordered = await createIsolatedJournalManifest({
    ...content,
    journal: [second, { ...job, workflow_instance_ids: [...ids].reverse() }],
  });
  expect(first.checksumSha256).toBe(reordered.checksumSha256);
  expect((await validateIsolatedJournalManifest(reordered, expected)).journal).toHaveLength(2);
});
