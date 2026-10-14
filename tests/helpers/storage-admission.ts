import type { createTestDatabase } from "./d1";

/** Synthetic admission-only proof bundle. Full physical projection provisioning
 * and its drain/funding checks are exercised by helpers/storage-capacity.ts. */
export function seedStorageAdmissionProjection(
  db: Awaited<ReturnType<typeof createTestDatabase>>,
  input: {
    pricingId: string;
    fundingId: string;
    allocationId: string;
    now: string;
    expiry: string;
  },
) {
  db.sqlite
    .query(`INSERT INTO v2_storage_projections(id,month,environment,capacity_bytes,payload_json,digest,pricing_proof_id,funding_proof_id,allocation_proof_id,maintenance_id,reserved_krw,get_limit,head_limit,delete_limit,created_at,valid_until)
    SELECT ?,substr(datetime(?,'+9 hours'),1,7),'preview',100000000000,json_object('fundingJson',fp.payload_json,'pricingJson',pp.payload_json,'allocationJson',ap.payload_json),?,?,?,?,'synthetic-maintenance',1,0,0,0,?,?
    FROM v2_runtime_proofs fp JOIN v2_runtime_proofs pp ON pp.id=? JOIN v2_runtime_proofs ap ON ap.id=? WHERE fp.id=?`)
    .run(
      crypto.randomUUID(),
      input.now,
      "a".repeat(64),
      input.pricingId,
      input.fundingId,
      input.allocationId,
      input.now,
      input.expiry,
      input.pricingId,
      input.allocationId,
      input.fundingId,
    );
}
