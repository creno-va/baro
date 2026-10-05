import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../contracts";
import {
  V2_LIMITS,
  type V2CostAttempt,
  type V2CostQuote,
  type V2OperationQuota,
  type V2Usage,
  v2CostAttemptSchema,
  v2CostQuoteSchema,
  v2OperationQuotaSchema,
  v2UsageSchema,
} from "../../contracts/v2";
import { usageDateKst } from "./repository";
import {
  type Actor,
  actorSchema,
  aliveWorkspace,
  hashSchema,
  parse,
  safe,
  sqlClaim,
  type V2Core,
} from "./v2-core";

export function quotaColumns(
  quota: V2OperationQuota,
): { used: string; reserved: string; units: number } | null {
  if (quota.kind === "new_case")
    return { used: "cases_used", reserved: "cases_reserved", units: 1 };
  if (quota.kind === "visible_ai_response")
    return { used: "responses_used", reserved: "responses_reserved", units: 1 };
  if (quota.kind === "media_processing")
    return { used: "media_used", reserved: "media_reserved", units: quota.originalDurationSeconds };
  return null;
}
export function quotaPredicate(
  quota: V2OperationQuota,
  ownerId: string,
  day: string,
): { sql: string; values: unknown[] } {
  parse(v2OperationQuotaSchema, quota);
  const columns = quotaColumns(quota);
  if (!columns) return { sql: "1", values: [] };
  const limit =
    quota.kind === "new_case"
      ? V2_LIMITS.dailyCases
      : quota.kind === "visible_ai_response"
        ? V2_LIMITS.dailyAiResponses
        : V2_LIMITS.dailyMediaSeconds;
  const observed =
    quota.kind === "new_case"
      ? "max(coalesce(u.cases_used,0),coalesce((SELECT analysis_count FROM daily_usage WHERE user_id=? AND usage_date_kst=?),0))"
      : `coalesce(u.${columns.used},0)`;
  return {
    sql: `coalesce((SELECT ${observed}+coalesce(u.${columns.reserved},0)+? <= ? FROM (SELECT 1) LEFT JOIN v2_daily_usage u ON u.owner_id=? AND u.day=?),0)`,
    values: [
      ...(quota.kind === "new_case" ? [ownerId, day] : []),
      columns.units,
      limit,
      ownerId,
      day,
    ],
  };
}
export function quotaStatements(
  core: V2Core,
  actor: Actor,
  operationId: string,
  quota: V2OperationQuota,
  claimId: string,
): D1PreparedStatement[] {
  const columns = quotaColumns(quota);
  if (!columns) return [];
  const day = usageDateKst(actor.now);
  const responseKind = quota.kind === "visible_ai_response" ? quota.responseKind : null;
  const kind =
    quota.kind === "new_case"
      ? "new_case"
      : quota.kind === "visible_ai_response"
        ? "visible_response"
        : "media";
  return [
    core.statement(
      `INSERT INTO v2_daily_usage(owner_id,day,cases_used) SELECT ?,?,coalesce((SELECT analysis_count FROM daily_usage WHERE user_id=? AND usage_date_kst=?),0) WHERE ${sqlClaim} ON CONFLICT(owner_id,day) DO NOTHING`,
      [actor.ownerId, day, actor.ownerId, day, claimId],
    ),
    core.statement(
      `INSERT INTO v2_quota_reservations(id,owner_id,operation_id,day,kind,response_kind,units,state,created_at) SELECT ?,?,?,?,?,?,?,'reserved',? WHERE ${sqlClaim}`,
      [
        crypto.randomUUID(),
        actor.ownerId,
        operationId,
        day,
        kind,
        responseKind,
        columns.units,
        actor.now,
        claimId,
      ],
    ),
    core.statement(
      `UPDATE v2_daily_usage SET ${columns.reserved}=${columns.reserved}+? WHERE owner_id=? AND day=? AND ${sqlClaim}`,
      [columns.units, actor.ownerId, day, claimId],
    ),
  ];
}
export function operationStatements(
  core: V2Core,
  actor: Actor,
  input: {
    id: string;
    workspaceId: string | null;
    kind: string;
    revision: number;
    route: string;
    key: string;
    requestHash: string;
  },
  claimId: string,
): D1PreparedStatement[] {
  return [
    core.statement(
      `DELETE FROM v2_idempotency WHERE owner_id=? AND route=? AND key=? AND expires_at<=? AND ${sqlClaim}`,
      [actor.ownerId, input.route, input.key, actor.now, claimId],
    ),
    core.statement(
      `INSERT INTO v2_operations(id,owner_id,workspace_id,kind,revision,created_at) SELECT ?,?,?,?,?,? WHERE ${sqlClaim}`,
      [input.id, actor.ownerId, input.workspaceId, input.kind, input.revision, actor.now, claimId],
    ),
    core.statement(
      `INSERT INTO v2_idempotency(owner_id,route,key,request_hash,operation_id,created_at,expires_at) SELECT ?,?,?,?,?,?,? WHERE ${sqlClaim}`,
      [
        actor.ownerId,
        input.route,
        input.key,
        input.requestHash,
        input.id,
        actor.now,
        new Date(Date.parse(actor.now) + 86400000).toISOString(),
        claimId,
      ],
    ),
  ];
}
export function quotaTransitionStatements(
  core: V2Core,
  operationId: string,
  claimId: string,
  outcome: "consumed" | "released",
  onlyKind?: "media",
  fromJob = false,
): D1PreparedStatement[] {
  const filter = onlyKind ? " AND kind='media'" : "";
  const operationValue = fromJob ? "(SELECT operation_id FROM v2_jobs WHERE id=?)" : "?";
  const assignments = ["cases", "responses", "media"].flatMap((prefix) => {
    const kind =
      prefix === "cases" ? "new_case" : prefix === "responses" ? "visible_response" : "media";
    const sum = `coalesce((SELECT sum(q.units) FROM v2_quota_reservations q WHERE q.operation_id=${operationValue} AND q.owner_id=v2_daily_usage.owner_id AND q.day=v2_daily_usage.day AND q.state='reserved' AND q.kind='${kind}'${filter}),0)`;
    return [
      `${prefix}_reserved=${prefix}_reserved-${sum}`,
      `${prefix}_used=${prefix}_used+${outcome === "consumed" ? sum : "0"}`,
    ];
  });
  const binds = Array.from({ length: outcome === "consumed" ? 6 : 3 }, () => operationId);
  return [
    core.statement(
      `UPDATE v2_daily_usage SET ${assignments.join(",")} WHERE EXISTS(SELECT 1 FROM v2_quota_reservations WHERE operation_id=${operationValue} AND owner_id=v2_daily_usage.owner_id AND day=v2_daily_usage.day AND state='reserved'${filter}) AND ${sqlClaim}`,
      [...binds, operationId, claimId],
    ),
    core.statement(
      `UPDATE v2_quota_reservations SET state=? WHERE operation_id=${operationValue} AND state='reserved'${filter} AND ${sqlClaim}`,
      [outcome, operationId, claimId],
    ),
  ];
}
export const quotaRetryPredicate = `NOT EXISTS(SELECT 1 FROM v2_quota_reservations q JOIN v2_daily_usage u ON u.owner_id=q.owner_id AND u.day=q.day WHERE q.operation_id=j.operation_id AND q.state='released' AND ((q.kind='visible_response' AND u.responses_used+u.responses_reserved+q.units>30) OR (q.kind='media' AND u.media_used+u.media_reserved+q.units>3600) OR (q.kind='new_case' AND u.cases_used+u.cases_reserved+q.units>3)))`;
export function quotaRetryStatements(
  core: V2Core,
  jobId: string,
  claimId: string,
): D1PreparedStatement[] {
  return [
    core.statement(
      `UPDATE v2_daily_usage SET responses_reserved=responses_reserved+coalesce((SELECT sum(units) FROM v2_quota_reservations q WHERE q.operation_id=(SELECT operation_id FROM v2_jobs WHERE id=?) AND q.owner_id=v2_daily_usage.owner_id AND q.day=v2_daily_usage.day AND q.state='released' AND q.kind='visible_response'),0),media_reserved=media_reserved+coalesce((SELECT sum(units) FROM v2_quota_reservations q WHERE q.operation_id=(SELECT operation_id FROM v2_jobs WHERE id=?) AND q.owner_id=v2_daily_usage.owner_id AND q.day=v2_daily_usage.day AND q.state='released' AND q.kind='media'),0) WHERE EXISTS(SELECT 1 FROM v2_quota_reservations q WHERE q.operation_id=(SELECT operation_id FROM v2_jobs WHERE id=?) AND q.owner_id=v2_daily_usage.owner_id AND q.day=v2_daily_usage.day AND q.state='released') AND ${sqlClaim}`,
      [jobId, jobId, jobId, claimId],
    ),
    core.statement(
      `UPDATE v2_quota_reservations SET state='reserved' WHERE operation_id=(SELECT operation_id FROM v2_jobs WHERE id=?) AND state='released' AND ${sqlClaim}`,
      [jobId, claimId],
    ),
  ];
}

export const allocationSchema = z
  .strictObject({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    version: z.number().int().positive(),
    previewKrw: z.number().int().min(0).max(1000000),
    productionKrw: z.number().int().min(0).max(1000000),
    sharedFixedKrw: z.number().int().min(0).max(1000000),
    maintenanceReserveKrw: z.number().int().min(0).max(1000000),
    pricingProvenance: z.string().min(1).max(2048),
    fxProvenance: z.string().min(1).max(2048),
    fundingProvenance: z.string().min(1).max(2048),
    reviewedAt: timestampSchema,
    validUntil: timestampSchema,
    fundingState: z.enum(["funded", "trial_credit", "unavailable"]),
    fundingValidUntil: timestampSchema,
    manifestHash: hashSchema,
  })
  .refine(
    (a) =>
      a.previewKrw + a.productionKrw + a.sharedFixedKrw + a.maintenanceReserveKrw <= 1000000 &&
      Date.parse(a.validUntil) > Date.parse(a.reviewedAt),
  );
export type BudgetAllocation = z.infer<typeof allocationSchema>;
export function createV2AccountingRepository(core: V2Core, environment?: "preview" | "production") {
  return {
    ensurePrincipal(actor: Actor) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const principalId = crypto.randomUUID();
        await core.binding.batch([
          core.statement(
            "INSERT INTO v2_billing_principals(id,owner_id,created_at) SELECT ?,id,? FROM user WHERE id=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=?) ON CONFLICT(owner_id) DO NOTHING",
            [principalId, actor.now, actor.ownerId, actor.ownerId],
          ),
          core.statement(
            "INSERT INTO v2_storage_usage(principal_id) SELECT id FROM v2_billing_principals WHERE owner_id=? ON CONFLICT(principal_id) DO NOTHING",
            [actor.ownerId],
          ),
        ]);
        return await core
          .statement("SELECT id FROM v2_billing_principals WHERE owner_id=?", [actor.ownerId])
          .first<string>("id");
      });
    },
    findOperation(actor: Actor, route: string, key: string, requestHash: string) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const record = await core
          .statement(
            "SELECT i.request_hash,o.id,o.state,o.workspace_id,o.revision FROM v2_idempotency i JOIN v2_operations o ON o.id=i.operation_id WHERE i.owner_id=? AND i.route=? AND i.key=? AND i.expires_at>?",
            [actor.ownerId, route, key, actor.now],
          )
          .first<{
            request_hash: string;
            id: string;
            state: string;
            workspace_id: string | null;
            revision: number;
          }>();
        return record
          ? record.request_hash === requestHash
            ? { kind: "replay" as const, operation: record }
            : { kind: "conflict" as const }
          : null;
      });
    },
    usage(actor: Actor): Promise<V2Usage> {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const day = usageDateKst(actor.now);
        const row = await core
          .statement("SELECT * FROM v2_daily_usage WHERE owner_id=? AND day=?", [
            actor.ownerId,
            day,
          ])
          .first<Record<string, number>>();
        const legacy = await core
          .statement(
            "SELECT analysis_count FROM daily_usage WHERE user_id=? AND usage_date_kst=?",
            [actor.ownerId, day],
          )
          .first<number>("analysis_count");
        const storage = await core
          .statement(
            "SELECT s.* FROM v2_storage_usage s JOIN v2_billing_principals p ON p.id=s.principal_id WHERE p.owner_id=?",
            [actor.ownerId],
          )
          .first<{ stored_bytes: number; reserved_bytes: number }>();
        const counter = (limit: number, used: number, reserved: number) => ({
          limit,
          used,
          reserved,
          remaining: Math.max(0, limit - used - reserved),
        });
        return parse(v2UsageSchema, {
          schemaVersion: "2",
          day,
          timezone: "Asia/Seoul",
          resetAt: `${day}T15:00:00.000Z`,
          newCases: counter(
            3,
            Math.max(row?.cases_used ?? 0, legacy ?? 0),
            row?.cases_reserved ?? 0,
          ),
          aiResponses: counter(30, row?.responses_used ?? 0, row?.responses_reserved ?? 0),
          mediaSeconds: counter(3600, row?.media_used ?? 0, row?.media_reserved ?? 0),
          storageBytes: counter(
            10000000000,
            storage?.stored_bytes ?? 0,
            storage?.reserved_bytes ?? 0,
          ),
          waitReasons: [],
        });
      });
    },
    settleQuota(actor: Actor, operationId: string, outcome: "consumed" | "released") {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, operationId);
        parse(z.enum(["consumed", "released"]), outcome);
        const claimId = crypto.randomUUID();
        const rows = await core
          .statement(
            "SELECT * FROM v2_quota_reservations WHERE owner_id=? AND operation_id=? AND state='reserved'",
            [actor.ownerId, operationId],
          )
          .all<{ id: string; day: string; kind: string; units: number }>();
        if (rows.results.length === 0) return false;
        const statements = [
          core.statement(
            "INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,owner_id,id,revision FROM v2_operations WHERE id=? AND owner_id=? AND EXISTS(SELECT 1 FROM v2_quota_reservations WHERE operation_id=? AND state='reserved')",
            [claimId, operationId, actor.ownerId, operationId],
          ),
        ];
        for (const row of rows.results) {
          const prefix =
            row.kind === "new_case"
              ? "cases"
              : row.kind === "visible_response"
                ? "responses"
                : "media";
          statements.push(
            core.statement(
              `UPDATE v2_daily_usage SET ${prefix}_reserved=${prefix}_reserved-?,${prefix}_used=${prefix}_used+? WHERE owner_id=? AND day=? AND EXISTS(SELECT 1 FROM v2_quota_reservations WHERE id=? AND state='reserved') AND ${sqlClaim}`,
              [
                row.units,
                outcome === "consumed" ? row.units : 0,
                actor.ownerId,
                row.day,
                row.id,
                claimId,
              ],
            ),
            core.statement(
              `UPDATE v2_quota_reservations SET state=? WHERE id=? AND state='reserved' AND ${sqlClaim}`,
              [outcome, row.id, claimId],
            ),
          );
        }
        statements.push(core.finish(claimId));
        return core.changed(statements);
      });
    },
    putQuote(quote: V2CostQuote) {
      return safe(async () => {
        const q = parse(v2CostQuoteSchema, quote);
        await core
          .statement(
            "INSERT INTO v2_cost_quotes VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
            [
              q.id,
              q.version,
              new Date(q.reviewedAt).toISOString(),
              new Date(q.validUntil).toISOString(),
              q.currency,
              q.providerPricingVersion,
              q.exchangeRateKrwPerUsd,
              q.safetyMarginRatio,
              q.estimatedKrw,
            ],
          )
          .run();
      });
    },
    reserveCost(actor: Actor, attempt: V2CostAttempt) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const a = parse(v2CostAttemptSchema, attempt);
        if (
          !environment ||
          a.state !== "reserved" ||
          Date.parse(a.createdAt) !== Date.parse(actor.now)
        )
          return false;
        const month = usageDateKst(actor.now).slice(0, 7);
        const claimId = crypto.randomUUID();
        const statements = [
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,o.owner_id,o.id,o.revision FROM v2_operations o JOIN v2_billing_principals p ON p.owner_id=o.owner_id JOIN v2_cost_quotes q ON q.id=? JOIN v2_monthly_budget b ON b.month=? JOIN v2_budget_allocations a ON a.month=b.month AND a.version=b.allocation_version WHERE o.id=? AND o.owner_id=? AND o.state IN ('admitted','ambiguous') AND q.reviewed_at<=? AND q.valid_until>? AND q.estimated_krw=? AND b.settled_krw+b.reserved_krw+b.ambiguous_krw+b.fixed_maintenance_krw+?<=b.limit_krw AND b.environment=? AND a.reviewed_at<=? AND a.valid_until>? AND a.funding_valid_until>? AND a.funding_state IN ('funded','trial_credit') AND NOT EXISTS(SELECT 1 FROM v2_cost_attempts WHERE invocation_id=? AND attempt=?) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=o.owner_id) AND (o.workspace_id IS NULL OR EXISTS(SELECT 1 FROM v2_workspaces w WHERE w.id=o.workspace_id AND w.owner_id=o.owner_id AND ${aliveWorkspace}))`,
            [
              claimId,
              a.quoteId,
              month,
              a.operationId,
              actor.ownerId,
              actor.now,
              actor.now,
              a.reservedKrw,
              a.reservedKrw,
              environment,
              actor.now,
              actor.now,
              actor.now,
              a.invocationId,
              a.attempt,
            ],
          ),
          core.statement(
            `INSERT INTO v2_cost_attempts(id,principal_id,operation_id,invocation_id,attempt,month,quote_id,service,state,reserved_krw,created_at) SELECT ?,p.id,?,?,?,?,?,?,'reserved',?,? FROM v2_billing_principals p WHERE p.owner_id=? AND ${sqlClaim}`,
            [
              a.id,
              a.operationId,
              a.invocationId,
              a.attempt,
              month,
              a.quoteId,
              a.service,
              a.reservedKrw,
              actor.now,
              actor.ownerId,
              claimId,
            ],
          ),
          core.statement(
            `UPDATE v2_monthly_budget SET reserved_krw=reserved_krw+? WHERE month=? AND ${sqlClaim}`,
            [a.reservedKrw, month, claimId],
          ),
          core.finish(claimId),
        ];
        return core.changed(statements);
      });
    },
    // Settlement is an internal provider receipt primitive. An ambiguous request is never automatically released.
    settleCost(
      attemptId: string,
      outcome: "settled" | "ambiguous" | "released",
      chargedKrw: number | null,
    ) {
      return safe(async () => {
        parse(opaqueIdSchema, attemptId);
        parse(z.enum(["settled", "ambiguous", "released"]), outcome);
        if ((outcome === "settled") !== (chargedKrw !== null)) return false;
        if (chargedKrw !== null)
          parse(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), chargedKrw);
        const row = await core
          .statement("SELECT * FROM v2_cost_attempts WHERE id=?", [attemptId])
          .first<{ state: string; month: string; reserved_krw: number }>();
        if (
          !row ||
          !["reserved", "ambiguous"].includes(row.state) ||
          (row.state === "ambiguous" && outcome !== "settled")
        )
          return false;
        const oldColumn = row.state === "reserved" ? "reserved_krw" : "ambiguous_krw";
        const newColumn =
          outcome === "settled" ? "settled_krw" : outcome === "ambiguous" ? "ambiguous_krw" : null;
        // Updated state is the CAS witness; a dedicated receipt id prevents a second writer from using it.
        const receiptId = crypto.randomUUID();
        const results = await core.binding.batch([
          core.statement(
            "INSERT INTO v2_cost_receipts(id,attempt_id,previous_state,next_state) SELECT ?,id,state,? FROM v2_cost_attempts WHERE id=? AND state=?",
            [receiptId, outcome, attemptId, row.state],
          ),
          core.statement(
            `UPDATE v2_monthly_budget SET ${oldColumn}=${oldColumn}-?${newColumn ? `,${newColumn}=${newColumn}+?` : ""} WHERE month=? AND EXISTS(SELECT 1 FROM v2_cost_receipts WHERE id=?)`,
            [
              row.reserved_krw,
              ...(newColumn ? [outcome === "settled" ? chargedKrw : row.reserved_krw] : []),
              row.month,
              receiptId,
            ],
          ),
          core.statement(
            "UPDATE v2_cost_attempts SET state=?,charged_krw=? WHERE id=? AND state=? AND EXISTS(SELECT 1 FROM v2_cost_receipts WHERE id=?)",
            [outcome, chargedKrw, attemptId, row.state, receiptId],
          ),
        ]);
        return results[0]?.meta.changes === 1;
      });
    },
    budget(now: string) {
      return safe(async () => {
        parse(timestampSchema, now);
        const month = usageDateKst(now).slice(0, 7);
        const row = await core
          .statement("SELECT * FROM v2_monthly_budget WHERE month=?", [month])
          .first<{
            settled_krw: number;
            reserved_krw: number;
            ambiguous_krw: number;
            fixed_maintenance_krw: number;
          }>();
        const ledger = await core
          .statement(
            "SELECT limit_krw,allocation_version,environment FROM v2_monthly_budget WHERE month=?",
            [month],
          )
          .first<{ limit_krw: number; allocation_version: number; environment: string }>();
        return {
          month,
          environment: ledger?.environment ?? environment ?? null,
          allocationVersion: ledger?.allocation_version ?? null,
          allocatedLimitKrw: ledger?.limit_krw ?? 0,
          settledKrw: row?.settled_krw ?? 0,
          reservedKrw: row?.reserved_krw ?? 0,
          ambiguousKrw: row?.ambiguous_krw ?? 0,
          fixedAndMaintenanceKrw: row?.fixed_maintenance_krw ?? 0,
          availableKrw: Math.max(
            0,
            (ledger?.limit_krw ?? 0) -
              (row?.settled_krw ?? 0) -
              (row?.reserved_krw ?? 0) -
              (row?.ambiguous_krw ?? 0) -
              (row?.fixed_maintenance_krw ?? 0),
          ),
        };
      });
    },
    // Trusted operator primitives. Both environments must exchange authenticated receipts before increases.
    recordAllocation(input: BudgetAllocation) {
      return safe(async () => {
        const a = parse(allocationSchema, input);
        return (
          (
            await core
              .statement(
                "INSERT INTO v2_budget_allocations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(month,version) DO NOTHING",
                [
                  a.month,
                  a.version,
                  a.previewKrw,
                  a.productionKrw,
                  a.sharedFixedKrw,
                  a.maintenanceReserveKrw,
                  a.pricingProvenance,
                  a.fxProvenance,
                  a.fundingProvenance,
                  new Date(a.reviewedAt).toISOString(),
                  new Date(a.validUntil).toISOString(),
                  a.fundingState,
                  new Date(a.fundingValidUntil).toISOString(),
                  a.manifestHash,
                ],
              )
              .run()
          ).meta.changes === 1
        );
      });
    },
    recordAllocationAcknowledgment(input: {
      month: string;
      version: number;
      environment: "preview" | "production";
      manifestHash: string;
      drainReceiptId: string;
      now: string;
    }) {
      return safe(async () => {
        parse(z.enum(["preview", "production"]), input.environment);
        parse(hashSchema, input.manifestHash);
        parse(opaqueIdSchema, input.drainReceiptId);
        parse(timestampSchema, input.now);
        return (
          (
            await core
              .statement(
                "INSERT INTO v2_allocation_acknowledgments SELECT month,version,?,?,?,? FROM v2_budget_allocations WHERE month=? AND version=? AND manifest_hash=? ON CONFLICT(month,version,environment) DO NOTHING",
                [
                  input.environment,
                  input.manifestHash,
                  input.drainReceiptId,
                  new Date(input.now).toISOString(),
                  input.month,
                  input.version,
                  input.manifestHash,
                ],
              )
              .run()
          ).meta.changes === 1
        );
      });
    },
    activateAllocation(month: string, version: number, now: string) {
      return safe(async () => {
        if (!environment) return false;
        parse(timestampSchema, now);
        now = new Date(now).toISOString();
        parse(z.number().int().positive(), version);
        const amount = environment === "preview" ? "preview_krw" : "production_krw";
        return (
          (
            await core
              .statement(
                `INSERT INTO v2_monthly_budget(month,allocation_version,environment,limit_krw) SELECT a.month,a.version,?,a.${amount} FROM v2_budget_allocations a WHERE a.month=? AND a.version=? AND a.reviewed_at<=? AND a.valid_until>? AND a.funding_valid_until>? AND a.funding_state IN ('funded','trial_credit') AND (SELECT count(*) FROM v2_allocation_acknowledgments k WHERE k.month=a.month AND k.version=a.version AND k.manifest_hash=a.manifest_hash)=2 ON CONFLICT(month) DO UPDATE SET allocation_version=excluded.allocation_version,limit_krw=excluded.limit_krw WHERE v2_monthly_budget.environment=excluded.environment AND v2_monthly_budget.allocation_version<excluded.allocation_version AND v2_monthly_budget.settled_krw+v2_monthly_budget.reserved_krw+v2_monthly_budget.ambiguous_krw+v2_monthly_budget.fixed_maintenance_krw<=excluded.limit_krw`,
                [environment, month, version, now, now, now],
              )
              .run()
          ).meta.changes === 1
        );
      });
    },
  };
}
