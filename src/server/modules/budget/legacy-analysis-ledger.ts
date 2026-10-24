import { z } from "zod";
import { CURRENT_POLICY_VERSIONS } from "../../../contracts/consent";
import { createCaseDataCipher } from "../../crypto";
import { usageDateKst } from "../../db/repository";
import { runtimeDigest } from "../../db/v2-paid-runtime";
import { reportCostObservationFailure } from "../../dependency-diagnostics";
import type {
  GatewayAttemptHandle,
  GatewayAttemptLedger,
  GatewayAttemptRequest,
  GatewayTransportReceipt,
} from "../llm-gateway/attempts";
import { invocationIdSchema } from "../llm-gateway/attempts";
import { MODEL_ID } from "../llm-gateway/prompts";
import { createGatewayExecutionPlanner, type TokenBounds } from "./execution-plan";
import { configuredBounds } from "./model-configuration";

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
const receiptSchema = z.strictObject({
  transport: z.enum(["response", "provider_error", "unknown", "not_sent"]),
  providerRequestId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .nullable(),
  inputTokens: count,
  outputTokens: count,
  cachedInputTokens: count,
  cacheWriteInputTokens: count,
  serviceTier: z.enum(["default", "flex", "scale", "priority"]).nullable(),
  meteringStatus: z.enum(["complete", "incomplete", "invalid"]),
  observedAt: z.string().datetime(),
  definitiveNoCharge: z.boolean(),
});
type Source = {
  owner_id: string;
  case_id: string;
  encrypted_input: string;
  attempt: number;
  created_at: string;
  started_at: string | null;
};
const currentSource = `FROM analyses a JOIN cases c ON c.current_analysis_id=a.id AND c.id=a.case_id AND c.input_revision=a.input_revision
 WHERE a.id=? AND a.input_revision=? AND a.workflow_instance_id=?
 AND a.status IN ('queued','screening','retrieving','generating','validating')
 AND EXISTS(SELECT 1 FROM user u WHERE u.id=c.user_id)
 AND EXISTS(SELECT 1 FROM user_consents s WHERE s.user_id=c.user_id AND s.terms_version=? AND s.privacy_version=? AND s.ai_notice_version=? AND s.over_14_confirmed=1)
 AND coalesce((SELECT value FROM app_metadata WHERE key='account-type:'||c.user_id AND value IN ('customer','lawyer')),
 CASE WHEN EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=c.user_id AND role IN ('lawyer_applicant','verified_lawyer')) THEN 'lawyer' ELSE 'customer' END)='customer'
 AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=c.user_id)
 AND NOT EXISTS(SELECT 1 FROM deletion_jobs WHERE (target_type='case' AND target_id=c.id) OR (target_type='account' AND target_id=c.user_id))
 AND NOT EXISTS(SELECT 1 FROM v2_workspaces WHERE legacy_case_id=c.id)`;

/** Concrete legacy target authorization; no invented v2 workspace/operation.
 * Monetary observations are independent of mandatory dispatch/source integrity.
 */
export async function createLegacyAnalysisLedger(options: {
  env: Env;
  params: { analysisId: string; inputRevision: number };
  instanceId: string;
  input(request: GatewayAttemptRequest): Promise<unknown>;
  waitUntil(work: Promise<void>): void;
  clock?: () => string;
}): Promise<GatewayAttemptLedger> {
  const { env, params, instanceId } = options;
  const clock = options.clock ?? (() => new Date().toISOString());
  const statement = (sql: string, values: unknown[] = []) => env.DB.prepare(sql).bind(...values);
  const sourceArgs = [
    params.analysisId,
    params.inputRevision,
    instanceId,
    CURRENT_POLICY_VERSIONS.termsVersion,
    CURRENT_POLICY_VERSIONS.privacyVersion,
    CURRENT_POLICY_VERSIONS.aiNoticeVersion,
  ];
  const cipher = await createCaseDataCipher(env);
  async function readSource(lockedOwner?: string) {
    const row = await statement(
      `SELECT c.user_id AS owner_id,c.id AS case_id,c.encrypted_input,a.attempt,a.created_at,a.started_at ${currentSource}`,
      sourceArgs,
    ).first<Source>();
    if (!row || (lockedOwner && row.owner_id !== lockedOwner)) return null;
    const input = await cipher.decrypt(row.encrypted_input, {
      table: "cases",
      column: "encrypted_input",
      rowId: row.case_id,
      userId: row.owner_id,
    });
    return { ...row, hash: await runtimeDigest({ inputRevision: params.inputRevision, input }) };
  }
  // An unavailable source denies the later gateway reservation. Do not expose
  // DB/crypto diagnostics as an uncaught Workflow factory error.
  const original = await readSource().catch(() => null);
  async function source() {
    if (!original) return null;
    const row = await readSource(original.owner_id);
    return row &&
      original &&
      row.owner_id === original.owner_id &&
      row.case_id === original.case_id &&
      row.hash === original.hash &&
      row.attempt === original.attempt
      ? row
      : null;
  }
  const config = configuredBounds(env);
  const planner = createGatewayExecutionPlanner({
    applicationCostLimitsEnabled: false,
    input: options.input,
    bounds: async (wire) => {
      if (!config || config.bounds.vision) return null;
      if (config.bounds.basis !== "verified_model_context_limit")
        return config.bounds as TokenBounds;
      const inputLimit = config.bounds.modelContextTokenLimit - wire.max_completion_tokens;
      return inputLimit > 0 && inputLimit <= config.bounds.modelInputTokenLimit
        ? ({
            ...config.bounds,
            modelInputTokenLimit: inputLimit,
            textTokensUpperBound: inputLimit,
            framingTokensUpperBound: 0,
          } as TokenBounds)
        : null;
    },
    verifyBounds: async (_descriptor, digest, now) =>
      config && Date.parse(config.verifiedAt) <= Date.parse(now)
        ? { digest, evidenceHash: config.evidenceHash, verifiedAt: config.verifiedAt }
        : null,
  });
  const handles = new Map<
    string,
    { invocationId: string; token: string; operationId: string; phase: string }
  >();
  const sourcePredicate = `${currentSource} AND c.user_id=? AND c.id=? AND c.encrypted_input=? AND a.attempt=? AND a.started_at=?`;
  function guardValues(row: NonNullable<Awaited<ReturnType<typeof source>>>) {
    return [
      ...sourceArgs,
      row.owner_id,
      row.case_id,
      row.encrypted_input,
      row.attempt,
      row.started_at,
    ];
  }
  const sourceExists = `EXISTS(SELECT 1 ${sourcePredicate})`;
  const active =
    "NOT EXISTS(SELECT 1 FROM legacy_ai_attempts WHERE operation_id=o.id AND state IN ('prepared','dispatched','unknown'))";
  return {
    waitUntil: options.waitUntil,
    async beforeDispatch(request) {
      if (
        request.requestId !== params.analysisId ||
        request.model !== MODEL_ID ||
        !invocationIdSchema.test(request.invocationId) ||
        !Number.isInteger(request.attemptOrdinal) ||
        request.attemptOrdinal < 1 ||
        request.attemptOrdinal > 3 ||
        !["minimize", "screening", "structure", "questions", "generation", "validation"].includes(
          request.phase,
        )
      )
        return null;
      const now = clock(),
        row = await source();
      if (!row?.started_at || Date.parse(now) + 60000 >= Date.parse(row.started_at) + 600000)
        return null;
      const verified = await planner.verify(request, now);
      if (!verified) return null;
      const day = usageDateKst(row.created_at),
        values = guardValues(row);
      await env.DB.batch([
        statement(
          `INSERT INTO v2_billing_principals(id,owner_id,created_at) SELECT ?,?,? WHERE ${sourceExists} ON CONFLICT(owner_id) DO NOTHING`,
          [crypto.randomUUID(), row.owner_id, now, ...values],
        ),
        statement(
          `INSERT INTO v2_daily_usage(owner_id,day) SELECT ?,? WHERE ${sourceExists} ON CONFLICT(owner_id,day) DO NOTHING`,
          [row.owner_id, day, ...values],
        ),
        statement(
          `INSERT INTO legacy_ai_operations(id,principal_id,analysis_id,case_id,input_revision,source_hash,day,workflow_attempt,quota_state,created_at)
          SELECT ?,p.id,?,?,?,?,?,?,'reserved',? FROM v2_billing_principals p JOIN v2_daily_usage u ON u.owner_id=p.owner_id AND u.day=?
          WHERE p.owner_id=? AND u.responses_used+u.responses_reserved<200 AND ${sourceExists}
          AND NOT EXISTS(SELECT 1 FROM legacy_ai_operations WHERE analysis_id=?)`,
          [
            crypto.randomUUID(),
            params.analysisId,
            row.case_id,
            params.inputRevision,
            row.hash,
            day,
            row.attempt,
            now,
            day,
            row.owner_id,
            ...values,
            params.analysisId,
          ],
        ),
      ]);
      // A newer explicit retry fences the old Workflow before cancelling only
      // provably unsent preparations. Dispatched/unknown attempts are retained.
      await statement(
        `UPDATE legacy_ai_attempts SET state='final',transport='not_sent',observed_at=?
        WHERE state='prepared' AND dispatch_token IS NULL AND workflow_attempt<?
        AND operation_id IN (SELECT id FROM legacy_ai_operations WHERE analysis_id=? AND source_hash=? AND quota_state='released')
        AND ${sourceExists}`,
        [now, row.attempt, params.analysisId, row.hash, ...values],
      ).run();
      // An explicit higher Workflow attempt may reclaim a released logical
      // response, but cannot overlap a dispatched/ambiguous provider request.
      await statement(
        `UPDATE legacy_ai_operations AS o SET workflow_attempt=?,quota_state='reserved'
        WHERE analysis_id=? AND source_hash=? AND input_revision=? AND quota_state='released' AND workflow_attempt<?
        AND ${active} AND ${sourceExists} AND principal_id=(SELECT id FROM v2_billing_principals WHERE owner_id=?)
        AND EXISTS(SELECT 1 FROM v2_daily_usage WHERE owner_id=? AND day=o.day AND responses_used+responses_reserved<200)`,
        [
          row.attempt,
          params.analysisId,
          row.hash,
          params.inputRevision,
          row.attempt,
          ...values,
          row.owner_id,
          row.owner_id,
        ],
      ).run();
      const op = await statement(
        `SELECT o.id FROM legacy_ai_operations o JOIN v2_billing_principals p ON p.id=o.principal_id
        WHERE o.analysis_id=? AND o.case_id=? AND o.source_hash=? AND o.input_revision=? AND o.workflow_attempt=? AND o.quota_state='reserved' AND p.owner_id=?`,
        [params.analysisId, row.case_id, row.hash, params.inputRevision, row.attempt, row.owner_id],
      ).first<{ id: string }>();
      if (!op) return null;
      const attemptId = crypto.randomUUID(),
        token = crypto.randomUUID();
      const result = await statement(
        `INSERT INTO legacy_ai_attempts(id,operation_id,invocation_id,workflow_attempt,phase,ordinal,correction,model,wire_hash,input_bytes,output_cap,evidence_hash,bounds_json,deadline_at,created_at)
        SELECT ?,o.id,?,?,?,?,?,?,?,?,?,?,?,?,? FROM legacy_ai_operations o WHERE o.id=? AND o.quota_state='reserved' AND ${active} AND ${sourceExists}
        AND NOT EXISTS(SELECT 1 FROM legacy_ai_attempts WHERE operation_id=o.id AND workflow_attempt=? AND phase=? AND (ordinal=? OR (correction=1 AND ?=1)))
        AND (?=1 OR EXISTS(SELECT 1 FROM legacy_ai_attempts WHERE operation_id=o.id AND workflow_attempt=? AND phase=? AND invocation_id=? AND ordinal=? AND state='final' AND transport IN ('response','provider_error')))`,
        [
          attemptId,
          request.invocationId,
          row.attempt,
          request.phase,
          request.attemptOrdinal,
          Number(request.correction),
          request.model,
          request.wireInputSha256,
          request.inputBytes,
          request.outputTokenUpperBound,
          verified.evidenceHash,
          JSON.stringify(verified.descriptor),
          new Date(Date.parse(row.started_at) + 600000).toISOString(),
          now,
          op.id,
          ...values,
          row.attempt,
          request.phase,
          request.attemptOrdinal,
          Number(request.correction),
          request.attemptOrdinal,
          row.attempt,
          request.phase,
          request.invocationId,
          request.attemptOrdinal - 1,
        ],
      ).run();
      if (result.meta.changes !== 1) return null;
      handles.set(attemptId, {
        invocationId: request.invocationId,
        token,
        operationId: op.id,
        phase: request.phase,
      });
      return { invocationId: request.invocationId, attemptId };
    },
    async confirmDispatch(handle) {
      const own = handles.get(handle.attemptId),
        row = await source(),
        now = clock();
      if (!own || own.invocationId !== handle.invocationId || !row) return false;
      const result = await statement(
        `UPDATE legacy_ai_attempts SET state='dispatched',dispatch_token=?,dispatched_at=?
        WHERE id=? AND invocation_id=? AND operation_id=? AND state='prepared' AND deadline_at>?
        AND EXISTS(SELECT 1 FROM legacy_ai_operations o JOIN v2_billing_principals p ON p.id=o.principal_id WHERE o.id=operation_id AND o.quota_state='reserved' AND o.workflow_attempt=? AND o.source_hash=? AND p.owner_id=?)
        AND ${sourceExists}`,
        [
          own.token,
          now,
          handle.attemptId,
          handle.invocationId,
          own.operationId,
          new Date(Date.parse(now) + 60000).toISOString(),
          row.attempt,
          row.hash,
          row.owner_id,
          ...guardValues(row),
        ],
      ).run();
      return result.meta.changes === 1;
    },
    async afterTransport(handle: GatewayAttemptHandle, value: GatewayTransportReceipt) {
      const own = handles.get(handle.attemptId);
      if (!own || own.invocationId !== handle.invocationId)
        throw new Error("LEGACY_ATTEMPT_HANDLE_INVALID");
      const receipt = receiptSchema.parse(value);
      if (
        Date.parse(receipt.observedAt) > Date.parse(clock()) ||
        receipt.definitiveNoCharge !== (receipt.transport === "not_sent")
      )
        throw new Error("LEGACY_RECEIPT_INVALID");
      const unsent = receipt.transport === "not_sent";
      const result = await statement(
        `UPDATE legacy_ai_attempts SET state=?,transport=?,observed_at=?
        WHERE id=? AND invocation_id=? AND operation_id=? AND ${unsent ? "state='prepared' AND dispatch_token IS NULL" : "state IN ('dispatched','unknown') AND dispatch_token=?"}
        ${receipt.transport === "unknown" ? "AND state='dispatched'" : ""}`,
        [
          receipt.transport === "unknown" ? "unknown" : "final",
          receipt.transport,
          receipt.observedAt,
          handle.attemptId,
          handle.invocationId,
          own.operationId,
          ...(unsent ? [] : [own.token]),
        ],
      ).run();
      if (!result.meta.changes) {
        const existing = await statement(
          "SELECT state,transport,dispatch_token FROM legacy_ai_attempts WHERE id=? AND invocation_id=? AND operation_id=?",
          [handle.attemptId, handle.invocationId, own.operationId],
        ).first<{ state: string; transport: string; dispatch_token: string | null }>();
        if (
          !existing ||
          existing.transport !== receipt.transport ||
          (unsent ? existing.dispatch_token !== null : existing.dispatch_token !== own.token)
        )
          throw new Error("LEGACY_RECEIPT_CONFLICT");
      }
      // Transport is durably terminal before optional numerical observations.
      // A missing usage row truthfully means unknown, never a zero-cost charge.
      const digest = await runtimeDigest(receipt);
      const observe = () =>
        statement(
          "INSERT INTO legacy_ai_observations(id,attempt_id,digest,payload_json,observed_at) VALUES(?,?,?,?,?) ON CONFLICT(attempt_id,digest) DO NOTHING",
          [
            crypto.randomUUID(),
            handle.attemptId,
            digest,
            JSON.stringify(receipt),
            receipt.observedAt,
          ],
        )
          .run()
          .then(() => {});
      const report = (error: unknown) => {
        try {
          reportCostObservationFailure(own.phase, error);
        } catch {
          /* Optional diagnostics. */
        }
      };
      try {
        await observe();
      } catch (error) {
        report(error);
        try {
          options.waitUntil(observe().catch(report));
        } catch (error) {
          report(error);
        }
      }
    },
  };
}
