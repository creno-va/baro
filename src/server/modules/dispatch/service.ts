type Pending = {
  id: string;
  analysis_id: string;
  attempt: number;
  instance_id: string;
  revision: number;
  attempts: number;
  created_at: string;
  owner_id: string;
  status: string;
};
export async function reconcileDispatch(env: Env, now = new Date().toISOString()) {
  const rows = await env.DB.prepare(
    `SELECT o.*,c.user_id AS owner_id,a.status FROM dispatch_outbox o JOIN analyses a ON a.id=o.analysis_id JOIN cases c ON c.current_analysis_id=a.id AND c.input_revision=o.revision AND c.id=a.case_id WHERE o.state='pending' AND o.next_attempt_at<=? AND a.attempt=o.attempt ORDER BY o.next_attempt_at LIMIT 100`,
  )
    .bind(now)
    .all<Pending>();
  for (const row of rows.results) {
    const lease = new Date(Date.parse(now) + 60_000).toISOString();
    const claim = await env.DB.prepare(
      "UPDATE dispatch_outbox SET attempts=attempts+1,next_attempt_at=? WHERE id=? AND state='pending' AND attempts=? AND next_attempt_at<=?",
    )
      .bind(lease, row.id, row.attempts, now)
      .run();
    if (claim.meta.changes !== 1) continue;
    const guard = `EXISTS(SELECT 1 FROM cases c JOIN analyses a ON a.id=c.current_analysis_id WHERE a.id=? AND c.input_revision=? AND a.attempt=?)`;
    if (row.status !== "queued") {
      // D1 execution progress proves dispatch happened, including a post-create crash.
      await env.DB.prepare(
        "UPDATE dispatch_outbox SET state='dispatched' WHERE id=? AND attempts=?",
      )
        .bind(row.id, row.attempts + 1)
        .run();
      continue;
    }
    if (Date.parse(now) - Date.parse(row.created_at) >= 86_400_000) {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE cases SET status='failed',updated_at=? WHERE current_analysis_id=? AND ${guard}`,
        ).bind(now, row.analysis_id, row.analysis_id, row.revision, row.attempt),
        env.DB.prepare(
          `UPDATE analyses SET status='failed',failure_code='DISPATCH_FAILED',completed_at=?,updated_at=? WHERE id=? AND status='queued' AND ${guard}`,
        ).bind(now, now, row.analysis_id, row.analysis_id, row.revision, row.attempt),
        env.DB.prepare("UPDATE dispatch_outbox SET state='failed' WHERE id=? AND attempts=?").bind(
          row.id,
          row.attempts + 1,
        ),
      ]);
      continue;
    }
    const alive = await env.DB.prepare(`SELECT 1 AS alive WHERE ${guard}`)
      .bind(row.analysis_id, row.revision, row.attempt)
      .first();
    if (!alive) continue;
    try {
      try {
        await env.ANALYSIS_WORKFLOW.create({
          id: row.instance_id,
          params: { analysisId: row.analysis_id, inputRevision: row.revision },
        });
      } catch {
        const instance = await env.ANALYSIS_WORKFLOW.get(row.instance_id);
        await instance.status();
      }
      await env.DB.prepare(
        "UPDATE dispatch_outbox SET state='dispatched' WHERE id=? AND state='pending' AND attempts=?",
      )
        .bind(row.id, row.attempts + 1)
        .run();
    } catch {
      const delay = Math.min(15, 2 ** Math.min(row.attempts, 4)) * 60_000;
      await env.DB.prepare(
        "UPDATE dispatch_outbox SET next_attempt_at=? WHERE id=? AND state='pending' AND attempts=?",
      )
        .bind(new Date(Date.parse(now) + delay).toISOString(), row.id, row.attempts + 1)
        .run();
    }
  }
  await env.DB.prepare("DELETE FROM dispatch_outbox WHERE state!='pending' AND created_at<?")
    .bind(new Date(Date.parse(now) - 7 * 86_400_000).toISOString())
    .run();
}
