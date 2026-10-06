import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../contracts";
import { usageDateKst } from "./repository";
import { type Actor, actorSchema, parse, safe, sqlClaim, type V2Core } from "./v2-core";
import {
  type ExecutionPlan,
  estimatePlanKrw,
  fundingProofSchema,
  pricingProofSchema,
  type RuntimeProofVerifier,
  verifiedEvidenceSchema,
} from "./v2-paid-contracts";
import {
  allocationProofSchema,
  createV2PaidRuntimeRepository,
  runtimeDigest,
} from "./v2-paid-runtime";
import { carryoverSql } from "./v2-paid-statements";
import {
  type MaintenanceIO,
  maintenanceIOSchema,
  type PhysicalBinding,
  physicalBindingSchema,
  type StorageProjection,
  storageInventorySchema,
  storageProjectionSchema,
} from "./v2-storage-capacity-contracts";

export * from "./v2-storage-capacity-contracts";

const fin = "EXISTS(SELECT 1 FROM v2_runtime_claims WHERE id=?)";
const iso = timestampSchema.transform((value) => new Date(value).toISOString());
export type WritePermit = Readonly<{
  blobId: string;
  objectKey: string;
  byteLength: number;
  token: string;
  environment: "preview" | "production";
}>;
export type MaintenancePermit = Readonly<
  MaintenanceIO & {
    id: string;
    objectKey: string;
    environment: "preview" | "production";
    projectionId: string;
  }
>;
export interface PreparedPhysicalCapacity {
  readonly binding: Readonly<PhysicalBinding>;
  readonly predicate: { readonly sql: string; readonly values: readonly unknown[] };
  /** Compose after the actual pending INSERT and before core.finish. Missing or
   * mismatched pending objects abort the whole batch, including the paid hold. */
  statements(core: V2Core, actor: Actor, claimId: string): D1PreparedStatement[];
}
const prepared = new WeakSet<object>();
export const isPreparedPhysicalCapacity = (value: unknown): value is PreparedPhysicalCapacity =>
  typeof value === "object" && value !== null && prepared.has(value);

// The current month has already reserved the full approved physical ceiling,
// rather than prorating a newly uploaded object or imposing a retention expiry.
function currentProjection(environment: string, now: string) {
  return {
    sql: `EXISTS(SELECT 1 FROM v2_storage_projections projection JOIN v2_physical_storage_capacity capacity ON capacity.environment=projection.environment
    JOIN v2_runtime_controls control ON control.month=projection.month AND control.environment=projection.environment
    JOIN v2_monthly_budget budget ON budget.month=projection.month AND budget.environment=projection.environment
    JOIN v2_maintenance_exposure maintenance ON maintenance.id=projection.maintenance_id AND maintenance.month=projection.month
    JOIN v2_runtime_proofs pricing ON pricing.id=projection.pricing_proof_id
    JOIN v2_runtime_proofs funding ON funding.id=projection.funding_proof_id
    JOIN v2_runtime_proofs allocation ON allocation.id=projection.allocation_proof_id
    WHERE projection.environment=? AND projection.month=? AND projection.created_at<=? AND projection.valid_until>?
    AND capacity.capacity_bytes=projection.capacity_bytes AND control.phase='active' AND control.allocation_proof_id=allocation.id
    AND json_extract(allocation.payload_json,'$.allocation.version')=budget.allocation_version
    AND maintenance.state IN ('reserved','ambiguous') AND maintenance.amount_krw=projection.reserved_krw
    AND pricing.payload_json=json_extract(projection.payload_json,'$.pricingJson') AND funding.payload_json=json_extract(projection.payload_json,'$.fundingJson') AND allocation.payload_json=json_extract(projection.payload_json,'$.allocationJson')
    AND pricing.environment=projection.environment AND pricing.kind='pricing' AND funding.environment=projection.environment AND funding.kind='funding' AND allocation.environment=projection.environment AND allocation.kind='allocation'
    AND pricing.verified_at<=? AND funding.verified_at<=? AND allocation.verified_at<=? AND pricing.valid_until>? AND funding.valid_until>? AND allocation.valid_until>?
    AND budget.settled_krw+budget.reserved_krw+budget.ambiguous_krw+budget.fixed_maintenance_krw+(${carryoverSql})<=budget.limit_krw
    AND budget.settled_krw+budget.reserved_krw+budget.ambiguous_krw+budget.fixed_maintenance_krw+(${carryoverSql})<=json_extract(funding.payload_json,'$.spendAllowanceKrw')
    AND json_extract(funding.payload_json,'$.state') IN ('funded','trial_credit')
    AND NOT EXISTS(SELECT 1 FROM v2_blobs b LEFT JOIN v2_physical_blob_bindings binding ON binding.blob_id=b.id WHERE b.state!='deleted' AND (binding.blob_id IS NULL OR binding.state!='held' OR binding.environment!=projection.environment OR binding.object_key!=b.object_key OR b.cipher_bytes>binding.maximum_cipher_bytes)))`,
    values: [
      environment,
      usageDateKst(now).slice(0, 7),
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      usageDateKst(now).slice(0, 7),
      usageDateKst(now).slice(0, 7),
      usageDateKst(now).slice(0, 7),
      usageDateKst(now).slice(0, 7),
    ],
  };
}

export function createV2StorageCapacityRepository(
  core: V2Core,
  environment: "preview" | "production",
  verify?: RuntimeProofVerifier,
) {
  parse(z.enum(["preview", "production"]), environment);
  const proofs = createV2PaidRuntimeRepository(core, environment, verify);
  const permits = new WeakSet<object>(),
    writers = new WeakSet<object>();
  const finish = (claimId: string) =>
    core.statement("DELETE FROM v2_runtime_claims WHERE id=?", [claimId]);
  return {
    reserveProjection(input: StorageProjection, now: string) {
      return safe(async () => {
        const p = parse(storageProjectionSchema, input);
        now = parse(iso, now);
        if (!verify || p.month !== usageDateKst(now).slice(0, 7)) return false;
        const end = new Date(
          Date.UTC(Number(p.month.slice(0, 4)), Number(p.month.slice(5, 7)), 1) - 9 * 3600000,
        ).toISOString();
        const pr = await proofs.findProof(p.pricingProofId, now),
          fr = await proofs.findProof(p.fundingProofId, now),
          ar = await proofs.findProof(p.allocationProofId, now);
        if (pr?.kind !== "pricing" || fr?.kind !== "funding" || ar?.kind !== "allocation")
          return false;
        const pricing = parse(pricingProofSchema, pr.payload),
          funding = parse(fundingProofSchema, fr.payload),
          allocation = parse(allocationProofSchema, ar.payload);
        const count = p.getLimit + p.headLimit + p.deleteLimit;
        const quantities: ExecutionPlan["quantities"] = [
          {
            sku: "r2_storage_gb_months",
            maximumQuantity: String(Math.ceil(p.capacityBytes / 1000000000)),
          },
        ];
        // DeleteObject is officially free on R2 Standard; conservatively reserve
        // a Class-A allowance as well, without claiming a free billing receipt.
        if (p.deleteLimit)
          quantities.push({ sku: "r2_class_a_requests", maximumQuantity: String(p.deleteLimit) });
        if (p.getLimit + p.headLimit)
          quantities.push({
            sku: "r2_class_b_requests",
            maximumQuantity: String(p.getLimit + p.headLimit),
          });
        if (count)
          quantities.push(
            { sku: "worker_requests", maximumQuantity: String(count) },
            { sku: "worker_cpu_ms", maximumQuantity: String(count * p.workerCpuMsPerIO) },
            { sku: "d1_rows_read", maximumQuantity: String(count * p.d1RowsReadPerIO) },
            { sku: "d1_rows_written", maximumQuantity: String(count * p.d1RowsWrittenPerIO) },
          );
        if (
          funding.state === "unavailable" ||
          allocation.allocation.month !== p.month ||
          [pricing, pricing.fx, ...pricing.prices].some(
            (value) =>
              Date.parse(value.checkedAt) > Date.parse(now) ||
              Date.parse(value.validUntil) < Date.parse(end),
          ) ||
          Date.parse(pricing.fx.asOf) > Date.parse(now) ||
          Date.parse(funding.observedAt) > Date.parse(now) ||
          Date.parse(funding.validUntil) < Date.parse(end) ||
          Date.parse(allocation.allocation.validUntil) < Date.parse(end) ||
          quantities.some((q) => {
            const rate = pricing.prices.find((price) => price.sku === q.sku);
            return (
              rate?.provider !== "cloudflare" ||
              rate.billingMode !== "metered" ||
              (q.sku.startsWith("r2_") && rate.plan !== "standard")
            );
          })
        )
          return false;
        const amount = estimatePlanKrw(pricing, quantities),
          limit =
            environment === "preview"
              ? allocation.allocation.previewKrw
              : allocation.allocation.productionKrw;
        const payload = {
          environment,
          input: p,
          quantities,
          reservedKrw: amount,
          validUntil: end,
          pricingJson: JSON.stringify(pricing),
          fundingJson: JSON.stringify(funding),
          allocationJson: JSON.stringify(allocation),
        };
        const json = JSON.stringify(payload),
          digest = await runtimeDigest(payload);
        if (amount < 1 || amount > limit || new TextEncoder().encode(json).length > 262144)
          return false;
        const evidence = await verify("maintenance", payload, digest);
        if (!evidence) return false;
        const e = parse(verifiedEvidenceSchema, evidence);
        if (
          e.digest !== digest ||
          e.method !== "authenticated_coordinator" ||
          Date.parse(e.verifiedAt) > Date.parse(now)
        )
          return false;
        const existing = await core
          .statement(
            "SELECT digest,payload_json FROM v2_storage_projections WHERE environment=? AND month=?",
            [environment, p.month],
          )
          .first<{ digest: string; payload_json: string }>();
        if (existing) return existing.digest === digest && existing.payload_json === json;
        const claimId = crypto.randomUUID();
        const inventoryCount = await core
          .statement(
            "SELECT count(*) AS count FROM v2_blobs b LEFT JOIN v2_physical_blob_bindings binding ON binding.blob_id=b.id WHERE b.state!='deleted' AND (binding.blob_id IS NULL OR binding.state!='held' OR binding.environment!=? OR binding.maximum_cipher_bytes<b.cipher_bytes OR binding.object_key!=b.object_key)",
            [environment],
          )
          .first<number>("count");
        if (inventoryCount) return false;
        const inventoryGuard = `NOT EXISTS(SELECT 1 FROM v2_blobs live LEFT JOIN v2_physical_blob_bindings binding ON binding.blob_id=live.id WHERE live.state!='deleted' AND (binding.blob_id IS NULL OR binding.state!='held' OR binding.environment!=? OR binding.object_key!=live.object_key OR binding.maximum_cipher_bytes<live.cipher_bytes)) AND NOT EXISTS(SELECT 1 FROM v2_physical_blob_bindings WHERE environment=? AND inventory_hash IS NOT NULL AND inventory_hash!=?) AND EXISTS(SELECT 1 FROM v2_budget_allocations a WHERE a.month=b.month AND a.version=b.allocation_version AND a.version=json_extract(allocation.payload_json,'$.allocation.version') AND a.manifest_hash=json_extract(allocation.payload_json,'$.allocation.manifestHash') AND a.preview_krw=json_extract(allocation.payload_json,'$.allocation.previewKrw') AND a.production_krw=json_extract(allocation.payload_json,'$.allocation.productionKrw') AND a.valid_until>=?)`;
        return core.changed([
          core.statement(
            `INSERT INTO v2_runtime_claims(id,owner_id,target_id,revision) SELECT ?,?,b.month,c.revision FROM v2_monthly_budget b JOIN v2_runtime_controls c ON c.month=b.month JOIN v2_runtime_proofs pricing ON pricing.id=? JOIN v2_runtime_proofs funding ON funding.id=? JOIN v2_runtime_proofs allocation ON allocation.id=? WHERE b.month=? AND b.environment=? AND c.environment=b.environment AND c.revision=? AND c.phase IN ('frozen','drained') AND pricing.payload_json=? AND funding.payload_json=? AND allocation.payload_json=? AND pricing.valid_until>=? AND funding.valid_until>=? AND allocation.valid_until>=? AND NOT EXISTS(SELECT 1 FROM v2_storage_projections WHERE environment=? AND month=?) AND coalesce((SELECT held_bytes FROM v2_physical_storage_capacity WHERE environment=?),0)<=? AND b.settled_krw+b.reserved_krw+b.ambiguous_krw+b.fixed_maintenance_krw+(${carryoverSql})+?<=min(?,json_extract(funding.payload_json,'$.spendAllowanceKrw')) AND ${inventoryGuard}`,
            [
              claimId,
              environment,
              p.pricingProofId,
              p.fundingProofId,
              p.allocationProofId,
              p.month,
              environment,
              p.expectedControlRevision,
              payload.pricingJson,
              payload.fundingJson,
              payload.allocationJson,
              end,
              end,
              end,
              environment,
              p.month,
              environment,
              p.capacityBytes,
              p.month,
              p.month,
              amount,
              limit,
              environment,
              environment,
              p.inventoryHash,
              end,
            ],
          ),
          core.statement(
            `INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) SELECT ?,? WHERE ${fin} ON CONFLICT(environment) DO UPDATE SET capacity_bytes=excluded.capacity_bytes,revision=revision+1`,
            [environment, p.capacityBytes, claimId],
          ),
          core.statement(
            `INSERT INTO v2_maintenance_exposure(id,month,reference_hash,amount_krw,state,created_at) SELECT ?,?,?,?,'reserved',? WHERE ${fin}`,
            [p.id, p.month, digest, amount, now, claimId],
          ),
          core.statement(
            `INSERT INTO v2_maintenance_evidence(id,maintenance_id,action,digest,payload_json,evidence_hash,verified_at) SELECT ?,?,'record',?,?,?,? WHERE ${fin}`,
            [crypto.randomUUID(), p.id, digest, json, e.evidenceHash, e.verifiedAt, claimId],
          ),
          core.statement(
            `INSERT INTO v2_storage_projections(id,month,environment,capacity_bytes,payload_json,digest,pricing_proof_id,funding_proof_id,allocation_proof_id,maintenance_id,reserved_krw,get_limit,head_limit,delete_limit,created_at,valid_until) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${fin}`,
            [
              p.id,
              p.month,
              environment,
              p.capacityBytes,
              json,
              digest,
              p.pricingProofId,
              p.fundingProofId,
              p.allocationProofId,
              p.id,
              amount,
              p.getLimit,
              p.headLimit,
              p.deleteLimit,
              now,
              end,
              claimId,
            ],
          ),
          core.statement(
            `UPDATE v2_monthly_budget SET fixed_maintenance_krw=fixed_maintenance_krw+? WHERE month=? AND environment=? AND ${fin}`,
            [amount, p.month, environment, claimId],
          ),
          core.statement(
            `UPDATE v2_runtime_controls SET phase='frozen',local_drain_id=NULL,revision=revision+1,updated_at=? WHERE month=? AND environment=? AND ${fin}`,
            [now, p.month, environment, claimId],
          ),
          finish(claimId),
        ]);
      });
    },
    /** Bounded coordinator inventory bootstrap/reconciliation. This is a
     * physical maximum, not an R2 success/billing receipt. Freeze first; all
     * unbound live objects prevent projection/activation until accounted for. */
    bindInventory(input: z.infer<typeof storageInventorySchema>, now: string) {
      return safe(async () => {
        const inventory = parse(storageInventorySchema, input);
        now = parse(iso, now);
        if (
          !verify ||
          Date.parse(inventory.observedAt) > Date.parse(now) ||
          Date.parse(now) - Date.parse(inventory.observedAt) > 300000
        )
          return false;
        const payload = { environment, action: "storage_inventory", inventory },
          digest = await runtimeDigest(payload);
        const evidence = await verify("maintenance", payload, digest);
        if (!evidence) return false;
        const e = parse(verifiedEvidenceSchema, evidence);
        if (
          e.digest !== digest ||
          e.method !== "authenticated_coordinator" ||
          Date.parse(e.verifiedAt) > Date.parse(now)
        )
          return false;
        const claimId = crypto.randomUUID(),
          month = usageDateKst(now).slice(0, 7);
        return core.changed([
          core.statement(
            "INSERT INTO v2_runtime_claims(id,owner_id,target_id,revision) SELECT ?,?,?,c.revision FROM v2_runtime_controls c WHERE c.environment=? AND c.month=? AND c.phase='frozen'",
            [claimId, environment, inventory.manifestHash, environment, month],
          ),
          core.statement(
            `INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) SELECT ?,100000000000 WHERE ${fin} ON CONFLICT(environment) DO NOTHING`,
            [environment, claimId],
          ),
          ...inventory.bindings.map((binding) =>
            core.statement(
              `INSERT INTO v2_physical_blob_bindings(blob_id,environment,owner_id,object_key,maximum_cipher_bytes,state,inventory_hash,created_at,writer_state,writer_token,expected_cipher_bytes) SELECT ?,?,?,?,?,'held',?,?,?,?,? WHERE ${fin} ON CONFLICT(blob_id) DO NOTHING`,
              [
                binding.blobId,
                environment,
                binding.ownerId,
                binding.objectKey,
                binding.maximumCipherBytes,
                inventory.manifestHash,
                now,
                binding.writerState === "stopped" ? "stopped" : "running",
                binding.writerState === "stopped" ? null : crypto.randomUUID(),
                binding.writerState === "stopped" ? null : binding.maximumCipherBytes,
                claimId,
              ],
            ),
          ),
          finish(claimId),
        ]);
      });
    },
    prepareCapacity(actor: Actor, input: PhysicalBinding): PreparedPhysicalCapacity {
      actor = parse(actorSchema, actor);
      const binding = Object.freeze(parse(physicalBindingSchema, input));
      if (binding.ownerId !== actor.ownerId) throw new Error("CAPACITY_SCOPE_INVALID");
      const current = currentProjection(environment, actor.now);
      const predicate = {
        sql: `${current.sql} AND EXISTS(SELECT 1 FROM v2_physical_storage_capacity c WHERE c.environment=? AND c.held_bytes+CASE WHEN EXISTS(SELECT 1 FROM v2_physical_blob_bindings b WHERE b.blob_id=? AND b.environment=c.environment AND b.owner_id=? AND b.object_key=? AND b.maximum_cipher_bytes=? AND b.state='held') THEN 0 ELSE ? END<=c.capacity_bytes)`,
        values: [
          ...current.values,
          environment,
          binding.blobId,
          binding.ownerId,
          binding.objectKey,
          binding.maximumCipherBytes,
          binding.maximumCipherBytes,
        ],
      };
      const result = Object.freeze({
        binding,
        predicate: Object.freeze({ sql: predicate.sql, values: Object.freeze(predicate.values) }),
        statements(target: V2Core, a: Actor, claimId: string) {
          if (target !== core || a.ownerId !== actor.ownerId || a.now !== actor.now)
            throw new Error("CAPACITY_SCOPE_INVALID");
          parse(opaqueIdSchema, claimId);
          return [
            core.statement(
              `INSERT INTO v2_physical_blob_bindings(blob_id,environment,owner_id,object_key,maximum_cipher_bytes,state,created_at) SELECT ?,?,?,?,?,'held',? WHERE ${sqlClaim} ON CONFLICT(blob_id) DO NOTHING`,
              [
                binding.blobId,
                environment,
                binding.ownerId,
                binding.objectKey,
                binding.maximumCipherBytes,
                actor.now,
                claimId,
              ],
            ),
          ];
        },
      });
      prepared.add(result);
      return result;
    },
    /** Exactly one native/R2 dispatch. Unknown completion keeps the durable
     * running obligation; it is never inferred from billing or a prior DELETE. */
    beginWrite(blobId: string, byteLength: number, now: string): Promise<WritePermit | null> {
      return safe(async () => {
        parse(opaqueIdSchema, blobId);
        parse(z.number().int().positive().max(100000000000), byteLength);
        now = parse(iso, now);
        const current = currentProjection(environment, now),
          token = crypto.randomUUID();
        const row = await core
          .statement(
            `UPDATE v2_physical_blob_bindings SET writer_state='running',writer_token=?,expected_cipher_bytes=? WHERE blob_id=? AND environment=? AND state='held' AND writer_state='prepared' AND maximum_cipher_bytes>=? AND ${current.sql} AND EXISTS(SELECT 1 FROM v2_blobs b WHERE b.id=blob_id AND b.state='pending' AND b.object_key=v2_physical_blob_bindings.object_key AND b.cipher_bytes<=?) RETURNING object_key`,
            [token, byteLength, blobId, environment, byteLength, ...current.values, byteLength],
          )
          .first<{ object_key: string }>();
        if (!row) return null;
        const permit = Object.freeze({
          blobId,
          byteLength,
          token,
          environment,
          objectKey: row.object_key,
        });
        writers.add(permit);
        return permit;
      });
    },
    confirmWriterStopped(
      permit: WritePermit,
      evidence:
        | { transport: "response"; objectKey: string; byteLength: number }
        | { transport: "not_sent" },
      now: string,
    ) {
      return safe(async () => {
        if (!writers.has(permit) || permit.environment !== environment) return false;
        now = parse(iso, now);
        const result = parse(
          z.discriminatedUnion("transport", [
            z.strictObject({
              transport: z.literal("response"),
              objectKey: z.string(),
              byteLength: z.number().int().positive(),
            }),
            z.strictObject({ transport: z.literal("not_sent") }),
          ]),
          evidence,
        );
        if (
          result.transport === "response" &&
          (result.objectKey !== permit.objectKey || result.byteLength !== permit.byteLength)
        )
          return false;
        const row = await core
          .statement(
            `UPDATE v2_physical_blob_bindings SET writer_state='stopped' WHERE blob_id=? AND environment=? AND object_key=? AND state='held' AND writer_state='running' AND writer_token=? AND expected_cipher_bytes=? RETURNING blob_id`,
            [permit.blobId, environment, permit.objectKey, permit.token, permit.byteLength],
          )
          .first();
        if (row) writers.delete(permit);
        return Boolean(row);
      });
    },
    beforeMaintenanceIO(input: MaintenanceIO, now: string): Promise<MaintenancePermit | null> {
      return safe(async () => {
        const io = parse(maintenanceIOSchema, input);
        now = parse(iso, now);
        const current = currentProjection(environment, now);
        const row = await core
          .statement(
            `SELECT binding.object_key FROM v2_physical_blob_bindings binding JOIN v2_blobs b ON b.id=binding.blob_id WHERE binding.blob_id=? AND binding.environment=? AND binding.state='held' AND b.object_key=binding.object_key AND b.cipher_bytes<=binding.maximum_cipher_bytes AND b.state ${io.action === "delete" ? "='deleting'" : io.action === "get" ? "='stored'" : "IN ('stored','deleting')"}`,
            [io.blobId, environment],
          )
          .first<{ object_key: string }>();
        if (!row) return null;
        const column = io.action === "get" ? "gets" : io.action === "head" ? "heads" : "deletes",
          limit =
            io.action === "get"
              ? "get_limit"
              : io.action === "head"
                ? "head_limit"
                : "delete_limit";
        const result = await core
          .statement(
            `UPDATE v2_storage_projections SET ${column}=${column}+1 WHERE environment=? AND month=? AND ${column}<${limit} AND ${current.sql} AND EXISTS(SELECT 1 FROM v2_physical_blob_bindings binding JOIN v2_blobs b ON b.id=binding.blob_id WHERE binding.blob_id=? AND binding.environment=? AND binding.state='held' AND binding.object_key=? AND b.object_key=binding.object_key AND b.cipher_bytes<=binding.maximum_cipher_bytes AND b.state ${io.action === "delete" ? "='deleting'" : io.action === "get" ? "='stored'" : "IN ('stored','deleting')"}) RETURNING id`,
            [
              environment,
              usageDateKst(now).slice(0, 7),
              ...current.values,
              io.blobId,
              environment,
              row.object_key,
            ],
          )
          .first<{ id: string }>();
        if (!result) return null;
        const permit = Object.freeze({
          ...io,
          id: crypto.randomUUID(),
          environment,
          objectKey: row.object_key,
          projectionId: result.id,
        });
        permits.add(permit);
        return permit;
      });
    },
    async consumeMaintenanceIO(permit: MaintenancePermit, now: string) {
      if (!permits.delete(permit) || permit.environment !== environment) return false;
      now = parse(iso, now);
      const current = currentProjection(environment, now);
      return Boolean(
        await core
          .statement(
            `SELECT b.id FROM v2_blobs b JOIN v2_physical_blob_bindings binding ON binding.blob_id=b.id WHERE b.id=? AND b.object_key=? AND binding.object_key=b.object_key AND binding.environment=? AND binding.state='held' AND b.cipher_bytes<=binding.maximum_cipher_bytes AND b.state ${permit.action === "delete" ? "='deleting'" : permit.action === "get" ? "='stored'" : "IN ('stored','deleting')"} AND EXISTS(SELECT 1 FROM v2_storage_projections WHERE id=? AND environment=? AND month=?) AND ${current.sql}`,
            [
              permit.blobId,
              permit.objectKey,
              environment,
              permit.projectionId,
              environment,
              usageDateKst(now).slice(0, 7),
              ...current.values,
            ],
          )
          .first(),
      );
    },
  };
}
