import { createCaseDataCipher } from "../../crypto";
import { createV2Core } from "../../db/v2-core";
import { createV2DeletionRepository } from "../../db/v2-deletion";
import { createFilesService } from "./service";

export async function reconcileFileUploads(env: Env): Promise<{
  recovered: number;
  acquired: number;
  completed: number;
  retry: number;
  unavailable: boolean;
}> {
  const result = { recovered: 0, acquired: 0, completed: 0, retry: 0, unavailable: false };
  const now = () => new Date().toISOString();
  if (!env.CASE_PRIVATE_R2) return { ...result, unavailable: true };
  try {
    const core = createV2Core(env.DB, await createCaseDataCipher(env));
    const deletion = createV2DeletionRepository(core);
    const files = createFilesService(core, {
      environment: env.APP_ENV === "production" ? "production" : "preview",
      bucket: env.CASE_PRIVATE_R2,
    });
    result.recovered = await files.recoverInterruptedUploads(4);
    // Only isolated original-blob journals belong here. Job stops and reservation
    // inventory remain with #67, including expired file journals containing them.
    const journals = await core
      .statement(
        `SELECT j.id FROM v2_deletion_journals j WHERE j.target_kind='blob' AND j.state IN ('pending','failed','running') AND j.next_attempt_at<=? AND (j.lease_until IS NULL OR j.lease_until<=?) AND EXISTS(SELECT 1 FROM v2_deletion_targets t WHERE t.journal_id=j.id) AND NOT EXISTS(SELECT 1 FROM v2_deletion_targets t LEFT JOIN v2_blobs b ON b.id=t.target_id WHERE t.journal_id=j.id AND (t.kind!='blob' OR b.id IS NULL OR b.kind!='original' OR b.visibility!='private')) ORDER BY j.created_at,j.id LIMIT 4`,
        [now(), now()],
      )
      .all<{ id: string }>();
    for (const journal of journals.results) {
      const started = now();
      const lease = await deletion.acquire(
        journal.id,
        crypto.randomUUID(),
        started,
        new Date(Date.parse(started) + 60000).toISOString(),
      );
      if (!lease) continue;
      result.acquired++;
      try {
        await files.cleanup(lease);
        if (await deletion.finish(lease, now())) {
          result.completed++;
          continue;
        }
      } catch {
        // R2 failure or incomplete receipts retain targets and storage exposure.
      }
      result.retry++;
      const failedAt = now();
      await deletion.fail(lease, failedAt, new Date(Date.parse(failedAt) + 60000).toISOString());
    }
  } catch {
    result.unavailable = true;
  }
  return result;
}
