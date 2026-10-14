import type { V2Core } from "../db/v2-core";
import { usageReceiptSchema } from "../db/v2-paid-contracts";
import { runtimeDigest } from "../db/v2-paid-runtime";

const historical = `SELECT h.attempt_id,h.dispatch_token,h.dispatched_at FROM v2_paid_holds h JOIN v2_cost_attempts a ON a.id=h.attempt_id WHERE a.operation_id=? AND h.state IN ('dispatched','unknown')
  UNION ALL SELECT h.attempt_id,h.dispatch_token,h.dispatched_at FROM v2_storage_paid_executions h WHERE h.operation_id=? AND h.state IN ('dispatched','unknown')`;

/** A known transport can permit another user-requested attempt even if monetary
 * settlement remains unknown. This reads immutable receipts; it never settles,
 * releases or manufactures an external execution observation. */
export async function stoppedJobRetryPredicate(core: V2Core, operationId: string, now: string) {
  const rows = (
    await core
      .statement(
        `SELECT h.*,a.invocation_id,u.id AS receipt_id,u.digest,u.payload_json,u.observed_at
    FROM (${historical}) h JOIN v2_cost_attempts a ON a.id=h.attempt_id
    LEFT JOIN v2_runtime_usage u ON u.id=(SELECT id FROM v2_runtime_usage WHERE attempt_id=h.attempt_id ORDER BY observed_at DESC,id DESC LIMIT 1)`,
        [operationId, operationId],
      )
      .all<{
        attempt_id: string;
        dispatch_token: string;
        dispatched_at: string;
        invocation_id: string;
        receipt_id: string | null;
        digest: string | null;
        payload_json: string | null;
        observed_at: string | null;
      }>()
  ).results;
  const verified: {
    attemptId: string;
    receiptId: string;
    digest: string;
    dispatchToken: string;
  }[] = [];
  let complete = true;
  for (const row of rows) {
    if (!complete) break;
    let raw: unknown;
    try {
      raw = JSON.parse(row.payload_json ?? "null");
    } catch {
      complete = false;
      break;
    }
    const parsed = usageReceiptSchema.safeParse(raw);
    if (
      !parsed.success ||
      !row.receipt_id ||
      !row.digest ||
      parsed.data.id !== row.receipt_id ||
      parsed.data.attemptId !== row.attempt_id ||
      parsed.data.invocationId !== row.invocation_id ||
      parsed.data.dispatchToken !== row.dispatch_token ||
      parsed.data.observedAt !== row.observed_at ||
      parsed.data.transport === "unknown" ||
      Date.parse(parsed.data.observedAt) < Date.parse(row.dispatched_at) ||
      Date.parse(parsed.data.observedAt) > Date.parse(now) ||
      (await runtimeDigest(parsed.data)) !== row.digest
    ) {
      complete = false;
      break;
    }
    verified.push({
      attemptId: row.attempt_id,
      receiptId: row.receipt_id,
      digest: row.digest,
      dispatchToken: row.dispatch_token,
    });
  }
  return {
    sql: `?=1
      AND NOT EXISTS(SELECT 1 FROM v2_execution_admissions WHERE operation_id=? AND state IN ('dispatched','unknown'))
      AND NOT EXISTS(SELECT 1 FROM v2_physical_blob_bindings p JOIN v2_blobs b ON b.id=p.blob_id JOIN v2_storage_reservations r ON r.id=b.reservation_id WHERE r.operation_id=? AND p.writer_state='running')
      AND NOT EXISTS(SELECT 1 FROM (${historical}) h WHERE NOT EXISTS(
        SELECT 1 FROM json_each(?) proof JOIN v2_runtime_usage u ON u.id=json_extract(proof.value,'$.receiptId')
        WHERE json_extract(proof.value,'$.attemptId')=h.attempt_id AND json_extract(proof.value,'$.dispatchToken')=h.dispatch_token
        AND u.attempt_id=h.attempt_id AND u.digest=json_extract(proof.value,'$.digest')
        AND u.id=(SELECT id FROM v2_runtime_usage WHERE attempt_id=h.attempt_id ORDER BY observed_at DESC,id DESC LIMIT 1)))`,
    values: [
      complete ? 1 : 0,
      operationId,
      operationId,
      operationId,
      operationId,
      JSON.stringify(verified),
    ],
  };
}
