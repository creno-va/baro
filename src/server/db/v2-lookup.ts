import { opaqueIdSchema } from "../../contracts";
import { CURRENT_POLICY_VERSIONS } from "../../contracts/consent";
import { type V2LookupRequest, v2LookupToolIdSchema } from "../../contracts/v2";
import { storedUserMessageSchema } from "../modules/workspace/stored-message";
import { type Actor, actorSchema, parse, safe, type V2Core } from "./v2-core";
import { jobAlive } from "./v2-jobs";
import { runtimeDigest } from "./v2-paid-runtime";
import { type JobLease, leaseSchema } from "./v2-workspace";

export interface LookupPermit {
  readonly request: V2LookupRequest;
}
type Transport = "response" | "provider_error" | "unknown" | "not_sent";
const customerConsent = `coalesce((SELECT value FROM app_metadata WHERE key='account-type:'||o.owner_id AND value IN ('customer','lawyer')),
  CASE WHEN EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=o.owner_id AND role IN ('lawyer_applicant','verified_lawyer')) THEN 'lawyer' ELSE 'customer' END) IN ('customer','lawyer')
  AND EXISTS(SELECT 1 FROM user_consents WHERE user_id=o.owner_id AND terms_version=? AND privacy_version=? AND ai_notice_version=? AND over_14_confirmed=1)`;
const policies = () => [
  CURRENT_POLICY_VERSIONS.termsVersion,
  CURRENT_POLICY_VERSIONS.privacyVersion,
  CURRENT_POLICY_VERSIONS.aiNoticeVersion,
];

/** A single immutable operation/tool claim covers all job retries and leases.
 * Possession of a JSON consent flag alone never issues a dispatch capability. */
export function createV2LookupRepository(
  core: V2Core,
  clock: () => string = () => new Date().toISOString(),
) {
  const permits = new WeakMap<
    LookupPermit,
    {
      id: string;
      actor: Actor;
      lease: JobLease;
      messageId: string;
      envelope: string;
      dispatchedAt: string;
      operationId: string;
      requestHash: string;
      workspaceId: string;
      targetRevision: number;
    }
  >();
  const source = async (actor: Actor, lease: JobLease, envelope?: string) =>
    core
      .statement(
        `SELECT o.id AS operation_id,i.request_hash,j.target_id,j.target_revision,m.id AS message_id,m.revision AS message_revision,m.encrypted_payload
      FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id
      JOIN v2_idempotency i ON i.operation_id=o.id AND i.route='/api/v2/cases/'||j.target_id||'/chat'
      JOIN v2_messages m ON m.operation_id=o.id AND m.workspace_id=j.target_id AND m.role='user'
      WHERE j.id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND o.owner_id=? AND o.state='admitted'
      AND j.kind='chat_response' AND j.target_kind='workspace' AND j.status IN ('running','validating')
      AND ${jobAlive} AND ${customerConsent}${envelope === undefined ? "" : " AND m.encrypted_payload=?"}`,
        [
          lease.jobId,
          lease.token,
          lease.fencing,
          actor.now,
          actor.ownerId,
          ...policies(),
          ...(envelope === undefined ? [] : [envelope]),
        ],
      )
      .first<{
        operation_id: string;
        request_hash: string;
        target_id: string;
        target_revision: number;
        message_id: string;
        message_revision: number;
        encrypted_payload: string;
      }>();
  return {
    claim(actor: Actor, lease: JobLease, tool: string): Promise<LookupPermit | null> {
      return safe(async () => {
        actor = parse(actorSchema, actor);
        lease = parse(leaseSchema, lease);
        parse(v2LookupToolIdSchema, tool);
        const row = await source(actor, lease);
        if (!row) return null;
        const stored = await core.decrypt(
          "v2_messages",
          row.message_id,
          actor.ownerId,
          row.message_revision,
          row.encrypted_payload,
          storedUserMessageSchema,
        );
        const request = stored.lookupRequests?.find((item) => item.tool === tool);
        if (
          !request ||
          stored.precedentComparisonRequest ||
          stored.operationId !== row.operation_id ||
          stored.id !== row.message_id ||
          stored.workspaceRevision > row.target_revision ||
          row.request_hash !==
            (await runtimeDigest({
              expectedRevision: stored.workspaceRevision - 1,
              text: stored.text,
              selectedFileIds: stored.selectedFileIds,
              lookupRequests: stored.lookupRequests,
            }))
        )
          return null;
        const id = crypto.randomUUID();
        const claimed = await core
          .statement(
            `INSERT INTO v2_lookup_executions(id,operation_id,job_id,tool,request_hash,transport,dispatched_at)
          SELECT ?,o.id,j.id,?,i.request_hash,'unknown',? FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id
          JOIN v2_idempotency i ON i.operation_id=o.id AND i.route='/api/v2/cases/'||j.target_id||'/chat'
          WHERE j.id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND o.owner_id=? AND o.state='admitted'
          AND j.kind='chat_response' AND j.target_kind='workspace' AND j.status IN ('running','validating')
          AND o.id=? AND i.request_hash=? AND j.target_id=? AND j.target_revision=? AND ${jobAlive} AND ${customerConsent}
          AND EXISTS(SELECT 1 FROM v2_messages WHERE id=? AND operation_id=o.id AND workspace_id=j.target_id AND role='user' AND revision=? AND encrypted_payload=?)
          ON CONFLICT(operation_id,tool) DO NOTHING RETURNING id`,
            [
              id,
              tool,
              actor.now,
              lease.jobId,
              lease.token,
              lease.fencing,
              actor.now,
              actor.ownerId,
              row.operation_id,
              row.request_hash,
              row.target_id,
              row.target_revision,
              ...policies(),
              row.message_id,
              row.message_revision,
              row.encrypted_payload,
            ],
          )
          .first<{ id: string }>();
        if (!claimed) return null;
        Object.freeze(request.target);
        Object.freeze(request.consent);
        Object.freeze(request);
        const permit: LookupPermit = Object.freeze({ request });
        permits.set(permit, {
          id,
          actor,
          lease,
          messageId: row.message_id,
          envelope: row.encrypted_payload,
          dispatchedAt: actor.now,
          operationId: row.operation_id,
          requestHash: row.request_hash,
          workspaceId: row.target_id,
          targetRevision: row.target_revision,
        });
        return permit;
      });
    },
    authorize(permit: LookupPermit): Promise<boolean> {
      return safe(async () => {
        const issued = permits.get(permit);
        if (!issued) return false;
        const now = parse(actorSchema, { ownerId: issued.actor.ownerId, now: clock() });
        const row = await source(now, issued.lease, issued.envelope);
        return (
          !!row &&
          row.message_id === issued.messageId &&
          row.operation_id === issued.operationId &&
          row.request_hash === issued.requestHash &&
          row.target_id === issued.workspaceId &&
          row.target_revision === issued.targetRevision
        );
      });
    },
    observe(permit: LookupPermit, transport: Transport): Promise<boolean> {
      return safe(async () => {
        const issued = permits.get(permit);
        if (!issued || !["response", "provider_error", "unknown", "not_sent"].includes(transport))
          return false;
        parse(opaqueIdSchema, issued.id);
        const observedAt = parse(actorSchema, { ownerId: issued.actor.ownerId, now: clock() }).now;
        if (observedAt < issued.dispatchedAt) return false;
        // Real late transport observations survive revocation/deletion; they
        // confer no authorization and can never replace a terminal receipt.
        const row = await core
          .statement(
            `UPDATE v2_lookup_executions SET transport=?,observed_at=? WHERE id=? AND transport='unknown'
          AND (observed_at IS NULL OR observed_at<=?) RETURNING id`,
            [transport, observedAt, issued.id, observedAt],
          )
          .first();
        if (row) return true;
        const previous = await core
          .statement("SELECT transport FROM v2_lookup_executions WHERE id=?", [issued.id])
          .first<{ transport: string }>();
        return previous?.transport === transport;
      });
    },
  };
}
