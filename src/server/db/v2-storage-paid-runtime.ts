import { z } from "zod";
import {
  COMPATIBLE_FILE_AI_NOTICE_VERSION,
  CURRENT_POLICY_VERSIONS,
  opaqueIdSchema,
} from "../../contracts";
import { usageDateKst } from "./repository";
import { type Actor, actorSchema, parse, safe, sqlClaim, type V2Core } from "./v2-core";
import { recordExecutionTransport, recordExecutionUsage } from "./v2-execution-runtime";
import {
  estimatePlanKrw,
  fundingProofSchema,
  pricingProofSchema,
  type RuntimeProofVerifier,
  type UsageReceipt,
  verifiedEvidenceSchema,
} from "./v2-paid-contracts";
import { createV2PaidRuntimeRepository, runtimeDigest } from "./v2-paid-runtime";
import { budgetAdmissionPredicate } from "./v2-paid-statements";
import { recordRuntimeUsage } from "./v2-paid-usage";
import {
  type StoragePaidHoldRequest,
  storagePaidHoldRequestSchema,
} from "./v2-storage-paid-contracts";

export interface PreparedStoragePaidHold {
  readonly actor: Readonly<Actor>;
  readonly request: Readonly<StoragePaidHoldRequest>;
  readonly reservedKrw: number | null;
  readonly predicate: { readonly sql: string; readonly values: readonly unknown[] };
  // Compose after the matching guarded pending intent INSERT, before core.finish.
  // The exact pending binding is verified in this same batch. Failure rolls back
  // storage intent, capacity counters, financial hold and source publication.
  statements(
    core: V2Core,
    actor: Actor,
    claimId: string,
    encryptedPayload: string,
  ): Promise<D1PreparedStatement[]>;
}
const trusted = new WeakSet<object>();
export function isPreparedStoragePaidHold(value: unknown): value is PreparedStoragePaidHold {
  return typeof value === "object" && value !== null && trusted.has(value);
}
function freeze(value: unknown): void {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
}

async function envelopeDigest(value: string) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength === 0 || bytes.byteLength > 1048576)
    throw new Error("RUNTIME_ANCHOR_TOO_LARGE");
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function sourceQuery(r: StoragePaidHoldRequest, actor: Actor, pending: boolean) {
  const req = (path: string) => `json_extract(q.req,'$.${path}')`;
  const consent = `EXISTS(SELECT 1 FROM user_consents c WHERE c.user_id=q.owner AND c.terms_version=json_extract(q.policy,'$.termsVersion') AND c.privacy_version=json_extract(q.policy,'$.privacyVersion') AND c.ai_notice_version=json_extract(q.policy,'$.aiNoticeVersion') AND c.over_14_confirmed=1 AND julianday(c.consented_at)<=julianday(q.now))`;
  // A separately authenticated action may use the same exact pending object.
  // It adds another financial hold, but cannot reserve its storage twice or
  // substitute an object with different physical metadata.
  const existingPending = `EXISTS(SELECT 1 FROM v2_blobs existing WHERE existing.id=${req("blobId")} AND existing.reservation_id=r.id AND existing.principal_id=principal.id AND existing.state='pending' AND existing.logical_bytes=${req("pending.logicalBytes")} AND existing.cipher_bytes=${req("pending.cipherBytes")} AND existing.cipher_hash IS ${req("pending.cipherHash")} AND existing.key_version IS ${req("pending.keyVersion")})`;
  const additionalBytes = pending
    ? "0"
    : `CASE WHEN ${existingPending} THEN 0 ELSE ${req("pending.logicalBytes")} END`;
  const common = `o.id=${req("plan.operationId")} AND o.owner_id=q.owner AND o.revision=${req("plan.operationRevision")} AND o.state='admitted' AND principal.owner_id=q.owner AND ${r.intent.kind === "approved_public_copy" && !pending ? "r.state='stored'" : `r.id=${req("reservationId")} AND r.state='reserved'`} AND r.principal_id=principal.id AND EXISTS(SELECT 1 FROM v2_storage_usage usage WHERE usage.principal_id=principal.id AND usage.stored_bytes+usage.reserved_bytes+${r.intent.kind === "approved_public_copy" && !pending ? req("pending.logicalBytes") : "0"}<=10000000000) AND ${r.intent.kind === "approved_public_copy" && !pending ? "1" : `r.live_blob_bytes+${additionalBytes}<=r.byte_length`} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=q.owner) AND (EXISTS(SELECT 1 FROM v2_idempotency i WHERE i.operation_id=o.id AND i.request_hash=${req("plan.requestHash")}) OR EXISTS(SELECT 1 FROM v2_execution_storage_holds prior WHERE prior.operation_id=o.id AND json_extract(prior.payload_json,'$.plan.requestHash')=${req("plan.requestHash")}))`;
  let from: string, guard: string, fields: string, blobKind: string, visibility: string;
  if (r.intent.kind === "case_original") {
    from =
      "v2_storage_reservations r JOIN v2_billing_principals principal ON principal.id=r.principal_id JOIN v2_files f ON f.id=r.entity_id JOIN v2_workspaces w ON w.id=f.workspace_id JOIN v2_upload_sessions u ON u.file_id=f.id JOIN v2_operations o ON o.id=f.operation_id";
    guard = `r.kind='case_original' AND r.target_id=f.id AND r.workspace_id=w.id AND r.operation_id=o.id AND o.kind='file_extract' AND f.id=${req("targetId")} AND f.revision=${req("targetRevision")} AND w.owner_id=q.owner AND f.state IN ('reserved','uploading') AND f.current_job_id IS NULL AND w.status!='archived' AND EXISTS(SELECT 1 FROM v2_consents c WHERE c.owner_id=q.owner AND c.file_id=f.id AND c.kind='auto_processing' AND c.version IN (json_extract(q.policy,'$.aiNoticeVersion'), '${COMPATIBLE_FILE_AI_NOTICE_VERSION}')) AND u.id=${req("intent.uploadId")} AND u.revision=${req("intent.uploadRevision")} AND u.state='open' AND u.expires_at>q.now AND ${req("intent.ordinal")}<ceil(u.reserved_bytes/8388608.0) AND ${req("pending.logicalBytes")}=min(8388608,u.reserved_bytes-${req("intent.ordinal")}*8388608) AND NOT EXISTS(SELECT 1 FROM v2_upload_parts WHERE upload_id=u.id AND ordinal=${req("intent.ordinal")}) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='workspace' AND target_id=w.id) OR (target_kind='file' AND target_id=f.id))`;
    fields =
      "'file',f.encrypted_payload,'fileRevision',f.revision,'workspace',w.id,'upload',u.id,'uploadRevision',u.revision,'uploadExpiry',u.expires_at";
    blobKind = "original";
    visibility = "private";
  } else if (r.intent.kind === "lawyer_original") {
    from =
      "v2_storage_reservations r JOIN v2_billing_principals principal ON principal.id=r.principal_id JOIN v2_assets a ON a.id=r.entity_id JOIN v2_profiles profile ON profile.id=a.profile_id JOIN v2_operations o ON o.id=r.operation_id";
    guard = `r.kind='lawyer_asset' AND r.target_id=a.id AND r.workspace_id IS NULL AND o.kind='profile_asset' AND a.id=${req("targetId")} AND a.revision=${req("targetRevision")} AND a.owner_id=q.owner AND profile.owner_id=q.owner AND a.state='reserved' AND a.current_job_id IS NULL AND a.original_blob_id IS NULL AND r.byte_length=${req("pending.logicalBytes")} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='profile' AND target_id=profile.id) OR (target_kind='asset' AND target_id=a.id))`;
    fields =
      "'asset',a.encrypted_payload,'assetRevision',a.revision,'purpose',a.purpose,'profile',profile.id";
    blobKind =
      "CASE a.purpose WHEN 'profile_photo' THEN 'profile_photo_original' WHEN 'portfolio' THEN 'portfolio_original' ELSE 'verification' END";
    visibility = "private";
  } else {
    from =
      "v2_storage_reservations r JOIN v2_billing_principals principal ON principal.id=r.principal_id JOIN v2_assets a ON a.id=r.entity_id JOIN v2_profiles profile ON profile.id=a.profile_id JOIN v2_profile_revision_assets ra ON ra.asset_id=a.id AND ra.asset_revision=a.revision JOIN v2_profile_revisions revision ON revision.id=ra.revision_id JOIN v2_applications application ON application.id=revision.application_id JOIN v2_blobs source ON source.id=a.sanitized_blob_id JOIN v2_storage_reservations source_res ON source_res.id=source.reservation_id JOIN v2_outbox outbox ON outbox.target_id=profile.id AND outbox.revision=revision.revision AND outbox.kind='profile_publish' JOIN v2_operations o ON o.id=outbox.operation_id";
    guard = `r.kind='lawyer_asset' AND r.target_id=${req("blobId")} AND r.workspace_id IS NULL AND o.kind='profile_revision' AND a.id=${req("targetId")} AND a.revision=${req("targetRevision")} AND a.owner_id=q.owner AND profile.owner_id=q.owner AND a.state='ready' AND a.current_job_id IS NULL AND a.purpose IN ('profile_photo','portfolio') AND revision.id=${req("intent.approvedRevisionId")} AND revision.status='approved' AND application.owner_id=q.owner AND application.status='approved' AND source.id=${req("intent.sourceBlobId")} AND source.state='stored' AND source.visibility='staging' AND source.principal_id=principal.id AND source_res.principal_id=principal.id AND source_res.kind='lawyer_asset' AND source_res.entity_id=a.id AND source_res.target_id=source.id AND source_res.state='stored' AND source.logical_bytes=${req("pending.logicalBytes")} AND r.byte_length=source.logical_bytes AND ((a.purpose='profile_photo' AND source.kind='profile_photo_sanitized') OR (a.purpose='portfolio' AND source.kind='portfolio_sanitized')) AND EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=q.owner AND role='verified_lawyer') AND EXISTS(SELECT 1 FROM v2_moderation_decisions d WHERE d.target_kind='profile' AND d.target_id=revision.id AND d.target_revision=revision.revision AND d.decision='approve') AND NOT EXISTS(SELECT 1 FROM v2_profile_revisions newer WHERE newer.profile_id=profile.id AND newer.status='approved' AND newer.revision>revision.revision) AND outbox.state IN ('pending','dispatched') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='profile' AND target_id=profile.id) OR (target_kind='asset' AND target_id=a.id))`;
    if (!pending) {
      from = from
        .replace(
          "v2_storage_reservations r JOIN v2_billing_principals principal ON principal.id=r.principal_id JOIN v2_assets a ON a.id=r.entity_id",
          "v2_assets a",
        )
        .replace(
          " JOIN v2_outbox outbox",
          " JOIN v2_storage_reservations r ON r.id=source_res.id JOIN v2_billing_principals principal ON principal.id=r.principal_id JOIN v2_outbox outbox",
        );
      guard = guard.replace(`r.target_id=${req("blobId")}`, "r.target_id=source.id");
    }
    fields =
      "'asset',a.encrypted_payload,'assetRevision',a.revision,'profile',profile.id,'approval',revision.encrypted_payload,'approvedRevision',revision.id,'source',source.encrypted_payload,'sourceOperation',source_res.operation_id,'sourceKey',source.object_key,'sourceBytes',source.logical_bytes,'sourceCipherBytes',source.cipher_bytes,'sourceCipherHash',source.cipher_hash,'sourceKeyVersion',source.key_version";
    blobKind = "public_copy";
    visibility = "public";
  }
  const kindSql = blobKind.startsWith("CASE") ? blobKind : `'${blobKind}'`;
  const blobJoin = pending
    ? "JOIN v2_blobs b ON b.reservation_id=r.id AND b.principal_id=principal.id"
    : "";
  const blobGuard = pending
    ? `AND b.id=${req("blobId")} AND b.state='pending' AND b.kind=${kindSql} AND b.visibility='${visibility}' AND b.object_key='${visibility === "public" ? "public" : "private"}/'||b.id AND b.logical_bytes=${req("pending.logicalBytes")} AND b.cipher_bytes=${req("pending.cipherBytes")} AND b.cipher_hash IS ${req("pending.cipherHash")} AND b.key_version IS ${req("pending.keyVersion")} AND b.created_at<=q.now AND b.created_at>strftime('%Y-%m-%dT%H:%M:%fZ',q.now,'-5 minutes') ${r.intent.kind === "approved_public_copy" ? `AND b.source_blob_id=source.id AND b.source_asset_revision=a.revision AND b.approved_revision_id=revision.id` : ""}`
    : "";
  return {
    sql: `SELECT json_object('principal',principal.id,'reservationOperation',${r.intent.kind === "approved_public_copy" ? "source_res.operation_id" : "r.operation_id"},'reservedBytes',r.byte_length,${fields}) AS anchor${pending ? ",b.encrypted_payload AS blob_payload" : ""} FROM (SELECT ? AS req,? AS owner,? AS now,? AS policy) q JOIN ${from} ${blobJoin} WHERE ${common} AND ${consent} AND ${guard} ${blobGuard} LIMIT 1`,
    values: [JSON.stringify(r), actor.ownerId, actor.now, JSON.stringify(CURRENT_POLICY_VERSIONS)],
  };
}

function prepareUnpricedHold(
  core: V2Core,
  environment: "preview" | "production",
  actor: Actor,
  r: StoragePaidHoldRequest,
  digest: string,
  evidence: z.infer<typeof verifiedEvidenceSchema>,
  sourceAnchor: string,
): PreparedStoragePaidHold {
  const source = sourceQuery(r, actor, false),
    snapshot = Object.freeze({ ...actor });
  const prepared: PreparedStoragePaidHold = {
    actor: snapshot,
    request: r,
    reservedKrw: null,
    predicate: {
      sql: `EXISTS(SELECT 1 FROM (${source.sql}) WHERE anchor=?) AND NOT EXISTS(SELECT 1 FROM v2_execution_attempts WHERE id=? OR (invocation_id=? AND (attempt=? OR state IN ('reserved','ambiguous')))) AND NOT EXISTS(SELECT 1 FROM v2_execution_storage_holds WHERE plan_id=?)`,
      values: [
        ...source.values,
        sourceAnchor,
        r.attemptId,
        r.plan.invocationId,
        r.attempt,
        r.planId,
      ],
    },
    async statements(c, a, claimId, encryptedPayload) {
      if (c !== core || a.ownerId !== snapshot.ownerId || a.now !== snapshot.now)
        throw new Error("RUNTIME_HOLD_ACTOR_MISMATCH");
      const pending = sourceQuery(r, a, true);
      const anchorJson = JSON.stringify({
        source: await envelopeDigest(sourceAnchor),
        pendingPayload: await envelopeDigest(encryptedPayload),
      });
      return [
        c.statement(
          `INSERT INTO v2_execution_admissions(attempt_id,plan_id,principal_id,environment,kind,operation_id,operation_revision,request_hash,invocation_id,attempt,service,target_kind,target_id,target_revision,reservation_id,blob_id,scope,anchor_json,digest,payload_json,evidence_hash,verified_at,deadline_at,created_at) SELECT ?,?,principal.id,?,'storage',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM v2_billing_principals principal JOIN (${pending.sql}) source WHERE principal.owner_id=? AND source.anchor=? AND source.blob_payload=? AND ${sqlClaim}`,
          [
            r.attemptId,
            r.planId,
            environment,
            r.plan.operationId,
            r.plan.operationRevision,
            r.plan.requestHash,
            r.plan.invocationId,
            r.attempt,
            r.service,
            r.targetKind,
            r.targetId,
            r.targetRevision,
            r.reservationId,
            r.blobId,
            r.intent.kind,
            anchorJson,
            digest,
            JSON.stringify(r),
            evidence.evidenceHash,
            evidence.verifiedAt,
            r.plan.deadlineAt,
            a.now,
            ...pending.values,
            a.ownerId,
            sourceAnchor,
            encryptedPayload,
            claimId,
          ],
        ),
        c.statement(
          "UPDATE v2_mutation_claims SET verified=(SELECT count(*)=1 FROM v2_execution_admissions WHERE attempt_id=? AND kind='storage') WHERE id=?",
          [r.attemptId, claimId],
        ),
      ];
    },
  };
  freeze(prepared);
  trusted.add(prepared);
  return prepared;
}

async function dispatchUnpricedHold(
  core: V2Core,
  environment: "preview" | "production",
  actor: Actor,
  attemptId: string,
) {
  const row = await core
    .statement(
      "SELECT h.payload_json,h.anchor_json,h.digest,h.state FROM v2_execution_admissions h JOIN v2_billing_principals p ON p.id=h.principal_id WHERE h.attempt_id=? AND h.kind='storage' AND h.environment=? AND p.owner_id=?",
      [attemptId, environment, actor.ownerId],
    )
    .first<{ payload_json: string; anchor_json: string; digest: string; state: string }>();
  if (!row) return undefined;
  if (row.state !== "prepared") return null;
  const r = parse(storagePaidHoldRequestSchema, JSON.parse(row.payload_json));
  if ((await runtimeDigest(r)) !== row.digest) return null;
  const pending = sourceQuery(r, actor, true),
    token = crypto.randomUUID(),
    claim = crypto.randomUUID();
  const captured = await core
    .statement(pending.sql, pending.values)
    .first<{ anchor: string; blob_payload: string }>();
  if (
    !captured ||
    JSON.stringify({
      source: await envelopeDigest(captured.anchor),
      pendingPayload: await envelopeDigest(captured.blob_payload),
    }) !== row.anchor_json
  )
    return null;
  const ok = await core.changed([
    core.statement(
      `WITH captured_source AS MATERIALIZED(${pending.sql}) INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,?,h.blob_id,h.target_revision FROM v2_execution_admissions h WHERE h.attempt_id=? AND h.kind='storage' AND h.environment=? AND h.state='prepared' AND h.digest=? AND h.anchor_json=? AND h.deadline_at>? AND EXISTS(SELECT 1 FROM captured_source WHERE anchor=? AND blob_payload=?)`,
      [
        ...pending.values,
        claim,
        actor.ownerId,
        attemptId,
        environment,
        row.digest,
        row.anchor_json,
        actor.now,
        captured.anchor,
        captured.blob_payload,
      ],
    ),
    core.statement(
      `UPDATE v2_execution_admissions SET state='dispatched',dispatch_token=?,dispatched_at=? WHERE attempt_id=? AND ${sqlClaim}`,
      [token, actor.now, attemptId, claim],
    ),
    core.finish(claim),
  ]);
  if (!ok) return null;
  const final = await core
    .statement(
      `WITH captured_source AS MATERIALIZED(${pending.sql}) SELECT h.attempt_id FROM v2_execution_admissions h WHERE h.attempt_id=? AND h.environment=? AND h.state='dispatched' AND h.dispatch_token=? AND h.deadline_at>? AND EXISTS(SELECT 1 FROM captured_source WHERE anchor=? AND blob_payload=?)`,
      [
        ...pending.values,
        attemptId,
        environment,
        token,
        actor.now,
        captured.anchor,
        captured.blob_payload,
      ],
    )
    .first();
  return final
    ? {
        attemptId,
        dispatchToken: token,
        planId: r.planId,
        planHash: row.digest,
        pricingProofId: r.pricingProofId,
        fundingProofId: r.fundingProofId,
        quoteId: r.quoteId,
        invocationId: r.plan.invocationId,
        attempt: r.attempt,
      }
    : null;
}

export function createV2StoragePaidRuntimeRepository(
  core: V2Core,
  environment: "preview" | "production",
  verify?: RuntimeProofVerifier,
) {
  parse(z.enum(["preview", "production"]), environment);
  const existing = createV2PaidRuntimeRepository(core, environment, verify);
  return {
    prepareHold(
      actor: Actor,
      input: StoragePaidHoldRequest,
    ): Promise<PreparedStoragePaidHold | null> {
      return safe(async () => {
        actor = parse(actorSchema, actor);
        const r = parse(storagePaidHoldRequestSchema, input);
        const now = Date.parse(actor.now),
          deadline = Date.parse(r.plan.deadlineAt);
        if (
          !verify ||
          deadline <= now ||
          deadline - now > 300000 ||
          r.attempt > r.plan.maximumAttempts
        )
          return null;
        if (
          r.intent.kind === "case_original"
            ? r.pending.keyVersion !== "binary_v1" ||
              r.pending.cipherHash === null ||
              r.pending.cipherBytes <= r.pending.logicalBytes
            : r.pending.cipherHash !== null ||
              r.pending.cipherBytes !== 0 ||
              (r.intent.kind === "lawyer_original"
                ? r.pending.keyVersion !== "asset_binary_v1"
                : r.pending.keyVersion !== null) ||
              r.pending.logicalBytes > 100000000
        )
          return null;
        const skus = r.plan.quantities.map((q) => q.sku);
        if (
          skus.some(
            (s) =>
              ![
                "r2_storage_gb_months",
                "r2_class_a_requests",
                "r2_class_b_requests",
                "worker_requests",
                "worker_cpu_ms",
                "d1_rows_read",
                "d1_rows_written",
              ].includes(s),
          ) ||
          (r.service === "storage"
            ? !skus.includes("r2_storage_gb_months")
            : !skus.some((s) => s === "r2_class_a_requests" || s === "r2_class_b_requests"))
        )
          return null;
        const digest = await runtimeDigest(r),
          evidence = await verify("execution", r, digest);
        if (!evidence) return null;
        const e = parse(verifiedEvidenceSchema, evidence);
        if (
          e.digest !== digest ||
          e.method !== "authenticated_coordinator" ||
          Date.parse(e.verifiedAt) > now
        )
          return null;
        const source = sourceQuery(r, actor, false),
          row = await core.statement(source.sql, source.values).first<{ anchor: string }>();
        if (!row) return null;
        if (!core.applicationCostLimitsEnabled)
          return prepareUnpricedHold(core, environment, actor, r, digest, e, row.anchor);
        if (!r.quoteId || !r.pricingProofId || !r.fundingProofId) return null;
        const pricingRow = await existing.findProof(r.pricingProofId, actor.now),
          fundingRow = await existing.findProof(r.fundingProofId, actor.now);
        if (pricingRow?.kind !== "pricing" || fundingRow?.kind !== "funding") return null;
        const pricing = parse(pricingProofSchema, pricingRow.payload),
          funding = parse(fundingProofSchema, fundingRow.payload);
        if (
          (core.applicationCostLimitsEnabled && funding.state === "unavailable") ||
          Date.parse(funding.observedAt) > now ||
          (core.applicationCostLimitsEnabled && Date.parse(funding.validUntil) < deadline) ||
          [pricing, pricing.fx, ...pricing.prices].some(
            (p) =>
              Date.parse(p.checkedAt) > now ||
              (core.applicationCostLimitsEnabled && Date.parse(p.validUntil) < deadline),
          ) ||
          Date.parse(pricing.fx.asOf) > now ||
          (core.applicationCostLimitsEnabled &&
            r.plan.quantities.some(
              (q) => pricing.prices.find((p) => p.sku === q.sku)?.billingMode !== "metered",
            ))
        )
          return null;
        const amount = estimatePlanKrw(pricing, r.plan.quantities);
        if (
          core.applicationCostLimitsEnabled &&
          (amount > 1000000 || amount > funding.spendAllowanceKrw)
        )
          return null;
        await core.ensureObservationMonth(environment, actor.now);
        const budget = budgetAdmissionPredicate({
          boundedStorage: true,
          applicationCostLimitsEnabled: core.applicationCostLimitsEnabled,
          monthlyBudgetCapEnabled: core.monthlyBudgetCapEnabled,
          pricingProofId: r.pricingProofId,
          fundingProofId: r.fundingProofId,
          pricingJson: JSON.stringify(pricing),
          fundingJson: JSON.stringify(funding),
          amount,
          environment,
          now: actor.now,
        });
        const predicate = {
          sql: `EXISTS(SELECT 1 FROM (${source.sql}) WHERE anchor=?) AND (${budget.sql}) AND NOT EXISTS(SELECT 1 FROM v2_cost_attempts WHERE id=?) AND NOT EXISTS(SELECT 1 FROM v2_cost_attempts WHERE invocation_id=? AND attempt=?) AND NOT EXISTS(SELECT 1 FROM v2_cost_attempts WHERE invocation_id=? AND state IN ('reserved','ambiguous')) AND NOT EXISTS(SELECT 1 FROM v2_storage_paid_executions WHERE plan_id=?)`,
          values: [
            ...source.values,
            row.anchor,
            ...budget.values,
            r.attemptId,
            r.plan.invocationId,
            r.attempt,
            r.plan.invocationId,
            r.planId,
          ],
        };
        const snapshot = Object.freeze({ ...actor }),
          month = usageDateKst(actor.now).slice(0, 7);
        const prepared: PreparedStoragePaidHold = {
          actor: snapshot,
          request: r,
          reservedKrw: amount,
          predicate,
          async statements(c, a, claimId, encryptedPayload) {
            if (c !== core || a.ownerId !== snapshot.ownerId || a.now !== snapshot.now)
              throw new Error("RUNTIME_HOLD_ACTOR_MISMATCH");
            const pending = sourceQuery(r, a, true);
            const anchorJson = JSON.stringify({
              source: await envelopeDigest(row.anchor),
              pendingPayload: await envelopeDigest(encryptedPayload),
            });
            return [
              c.statement(
                `INSERT INTO v2_cost_quotes(id,version,reviewed_at,valid_until,currency,provider_pricing_version,exchange_rate,safety_margin,estimated_krw) SELECT ?,1,?,?,'KRW',?,?,?,? WHERE ${sqlClaim}`,
                [
                  r.quoteId,
                  a.now,
                  r.plan.deadlineAt,
                  r.pricingProofId,
                  Number(pricing.fx.krwPerUsd),
                  Number(pricing.safetyMarginRatio),
                  amount,
                  claimId,
                ],
              ),
              c.statement(
                `INSERT INTO v2_cost_attempts(id,principal_id,operation_id,invocation_id,attempt,month,quote_id,service,state,reserved_krw,created_at) SELECT ?,principal.id,?,?,?,?,?,?,'reserved',?,? FROM v2_billing_principals principal WHERE principal.owner_id=? AND ${sqlClaim}`,
                [
                  r.attemptId,
                  r.plan.operationId,
                  r.plan.invocationId,
                  r.attempt,
                  month,
                  r.quoteId,
                  r.service,
                  amount,
                  a.now,
                  a.ownerId,
                  claimId,
                ],
              ),
              c.statement(
                `INSERT INTO v2_storage_paid_executions(attempt_id,plan_id,operation_id,operation_revision,reservation_id,blob_id,target_kind,target_id,target_revision,scope,pricing_proof_id,funding_proof_id,digest,payload_json,anchor_json,evidence_hash,verified_at,deadline_at,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM (${pending.sql}) WHERE anchor=? AND blob_payload=? AND ${sqlClaim}`,
                [
                  r.attemptId,
                  r.planId,
                  r.plan.operationId,
                  r.plan.operationRevision,
                  r.reservationId,
                  r.blobId,
                  r.targetKind,
                  r.targetId,
                  r.targetRevision,
                  r.intent.kind,
                  r.pricingProofId,
                  r.fundingProofId,
                  digest,
                  JSON.stringify(r),
                  anchorJson,
                  e.evidenceHash,
                  e.verifiedAt,
                  r.plan.deadlineAt,
                  a.now,
                  ...pending.values,
                  row.anchor,
                  encryptedPayload,
                  claimId,
                ],
              ),
              c.statement(
                "UPDATE v2_mutation_claims SET verified=(SELECT count(*)=1 FROM v2_storage_paid_executions WHERE attempt_id=?) WHERE id=?",
                [r.attemptId, claimId],
              ),
              c.statement(
                `UPDATE v2_monthly_budget SET reserved_krw=reserved_krw+? WHERE month=? AND ${sqlClaim}`,
                [amount, month, claimId],
              ),
            ];
          },
        };
        freeze(prepared);
        trusted.add(prepared);
        return prepared;
      });
    },
    beforeDispatch(actor: Actor, attemptId: string) {
      return safe(async () => {
        actor = parse(actorSchema, actor);
        parse(opaqueIdSchema, attemptId);
        const unpriced = await dispatchUnpricedHold(core, environment, actor, attemptId);
        if (unpriced !== undefined) return unpriced;
        const row = await core
          .statement(
            "SELECT h.*,ca.state AS cost_state,ca.month,pp.payload_json AS pricing_json,fp.payload_json AS funding_json FROM v2_storage_paid_executions h JOIN v2_cost_attempts ca ON ca.id=h.attempt_id JOIN v2_runtime_proofs pp ON pp.id=h.pricing_proof_id JOIN v2_runtime_proofs fp ON fp.id=h.funding_proof_id WHERE h.attempt_id=? AND h.state='prepared' AND ca.state='reserved'",
            [attemptId],
          )
          .first<{
            payload_json: string;
            anchor_json: string;
            digest: string;
            month: string;
            pricing_proof_id: string;
            funding_proof_id: string;
            pricing_json: string;
            funding_json: string;
          }>();
        if (!row) return null;
        const r = parse(storagePaidHoldRequestSchema, JSON.parse(row.payload_json));
        if (
          !r.quoteId ||
          !r.pricingProofId ||
          !r.fundingProofId ||
          (await runtimeDigest(r)) !== row.digest
        )
          return null;
        const pending = sourceQuery(r, actor, true),
          token = crypto.randomUUID(),
          claim = crypto.randomUUID();
        const captured = await core
          .statement(pending.sql, pending.values)
          .first<{ anchor: string; blob_payload: string }>();
        if (
          !captured ||
          JSON.stringify({
            source: await envelopeDigest(captured.anchor),
            pendingPayload: await envelopeDigest(captured.blob_payload),
          }) !== row.anchor_json
        )
          return null;
        const budget = budgetAdmissionPredicate({
          boundedStorage: true,
          applicationCostLimitsEnabled: core.applicationCostLimitsEnabled,
          monthlyBudgetCapEnabled: core.monthlyBudgetCapEnabled,
          pricingProofId: r.pricingProofId,
          fundingProofId: r.fundingProofId,
          pricingJson: row.pricing_json,
          fundingJson: row.funding_json,
          amount: 0, // This attempt is already included in the reserved ledger.
          environment,
          now: actor.now,
        });
        const control = budget.sql;
        const args = budget.values;
        const ok = await core.changed([
          core.statement(
            `WITH captured_source AS MATERIALIZED(${pending.sql}),funded AS MATERIALIZED(SELECT 1 WHERE ${control}) INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,?,h.blob_id,h.target_revision FROM v2_storage_paid_executions h JOIN v2_cost_attempts ca ON ca.id=h.attempt_id CROSS JOIN funded WHERE h.attempt_id=? AND h.state='prepared' AND ca.state='reserved' AND h.digest=? AND h.anchor_json=? AND h.deadline_at>? AND EXISTS(SELECT 1 FROM captured_source WHERE anchor=? AND blob_payload=?)`,
            [
              ...pending.values,
              ...args,
              claim,
              actor.ownerId,
              attemptId,
              row.digest,
              row.anchor_json,
              actor.now,
              captured.anchor,
              captured.blob_payload,
            ],
          ),
          core.statement(
            `UPDATE v2_storage_paid_executions SET state='dispatched',dispatch_token=?,dispatched_at=? WHERE attempt_id=? AND ${sqlClaim}`,
            [token, actor.now, attemptId, claim],
          ),
          core.finish(claim),
        ]);
        if (!ok) return null;
        // This last guarded read closes deletion/withdrawal/control races across
        // the admission await. A denied read retains the dispatched exposure.
        const final = await core
          .statement(
            `WITH captured_source AS MATERIALIZED(${pending.sql}),funded AS MATERIALIZED(SELECT 1 WHERE ${control}) SELECT h.attempt_id FROM v2_storage_paid_executions h CROSS JOIN funded WHERE h.attempt_id=? AND h.dispatch_token=? AND h.deadline_at>? AND EXISTS(SELECT 1 FROM captured_source WHERE anchor=? AND blob_payload=?)`,
            [
              ...pending.values,
              ...args,
              attemptId,
              token,
              actor.now,
              captured.anchor,
              captured.blob_payload,
            ],
          )
          .first();
        return final
          ? {
              attemptId,
              dispatchToken: token,
              planId: r.planId,
              planHash: row.digest,
              pricingProofId: r.pricingProofId,
              fundingProofId: r.fundingProofId,
              quoteId: r.quoteId,
              invocationId: r.plan.invocationId,
              attempt: r.attempt,
            }
          : null;
      });
    },
    async recordUsage(receipt: UsageReceipt, now: string) {
      const recorded = await recordExecutionUsage(core, verify, receipt, now);
      return recorded ?? recordRuntimeUsage(core, verify, receipt, now, true);
    },
    recordTransport(input: Parameters<typeof recordExecutionTransport>[1]) {
      return recordExecutionTransport(core, input);
    },
  };
}
