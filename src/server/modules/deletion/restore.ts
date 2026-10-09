import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../../contracts";
import type { V2Core } from "../../db/v2-core";

const id = opaqueIdSchema;
const bytes = z.number().int().safe().positive().max(100_000_000_000);
const kind = z.enum([
  "account",
  "workspace",
  "file",
  "profile",
  "asset",
  "report",
  "blob",
  "publication",
]);
const journal = z.strictObject({
  id,
  target_kind: kind,
  target_id: id,
  created_at: timestampSchema,
});
const target = z.strictObject({
  journal_id: id,
  kind: z.enum(["blob", "job", "legacy_workflow", "reservation"]),
  target_id: id,
});
const reservation = z.strictObject({
  id,
  principal_id: id,
  operation_id: id,
  target_id: id,
  entity_id: id,
  kind: z.enum(["case_original", "derived_report", "lawyer_asset"]),
  byte_length: bytes.max(10_000_000_000),
  state: z.enum(["reserved", "stored", "released"]),
  created_at: timestampSchema,
});
const blob = z.strictObject({
  id,
  principal_id: id,
  reservation_id: id,
  kind: z.enum([
    "original",
    "derivative",
    "report_pdf",
    "original_zip",
    "verification",
    "portfolio_original",
    "portfolio_sanitized",
    "profile_photo_original",
    "profile_photo_sanitized",
    "public_copy",
  ]),
  visibility: z.enum(["private", "staging", "public"]),
  object_key: z.string().regex(/^(private|public)\/[A-Za-z0-9_-]{1,128}$/),
  logical_bytes: bytes,
  cipher_bytes: z.number().int().safe().nonnegative(),
  cipher_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  key_version: id.nullable(),
  created_at: timestampSchema,
  source_blob_id: id.nullable(),
  source_asset_revision: z.number().int().positive().nullable(),
  approved_revision_id: id.nullable(),
});
const physical = z.strictObject({
  blob_id: id,
  environment: z.enum(["preview", "production"]),
  owner_id: id,
  object_key: blob.shape.object_key,
  maximum_cipher_bytes: bytes,
  writer_state: z.enum(["prepared", "running", "stopped"]),
  writer_token: id.nullable(),
  expected_cipher_bytes: bytes.nullable(),
  inventory_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  created_at: timestampSchema,
});
/** Only opaque inventory; no encrypted payload, narrative, credential or stop receipt is imported. */
export const v2RestoreJournalSchema = z
  .strictObject({
    journals: z.array(journal).max(256),
    targets: z.array(target).max(4096),
    reservations: z.array(reservation).max(1024),
    blobs: z.array(blob).max(1024),
    bindings: z.array(physical).max(1024),
  })
  .superRefine((value, context) => {
    const reject = () => context.addIssue({ code: "custom", message: "RESTORE_INVENTORY_INVALID" });
    const unique = (values: string[]) => {
      if (new Set(values).size !== values.length) reject();
    };
    unique(value.journals.map((j) => j.id));
    unique(value.journals.map((j) => `${j.target_kind}:${j.target_id}`));
    unique(value.targets.map((t) => `${t.journal_id}:${t.kind}:${t.target_id}`));
    unique(value.reservations.map((r) => r.id));
    unique(value.blobs.map((b) => b.id));
    unique(value.blobs.map((b) => b.object_key));
    unique(value.bindings.map((b) => b.blob_id));
    const journals = new Set(value.journals.map((j) => j.id));
    const blobs = new Map(value.blobs.map((b) => [b.id, b]));
    const reservations = new Map(value.reservations.map((r) => [r.id, r]));
    const blobTargets = new Set(
      value.targets.filter((t) => t.kind === "blob").map((t) => t.target_id),
    );
    const reservationTargets = new Set(
      value.targets.filter((t) => t.kind === "reservation").map((t) => t.target_id),
    );
    for (const t of value.targets)
      if (
        !journals.has(t.journal_id) ||
        (t.kind === "blob" && !blobs.has(t.target_id)) ||
        (t.kind === "reservation" && !reservations.has(t.target_id))
      )
        reject();
    for (const b of value.blobs) {
      const r = reservations.get(b.reservation_id);
      if (
        !blobTargets.has(b.id) ||
        !r ||
        r.principal_id !== b.principal_id ||
        (b.visibility === "public") !== b.object_key.startsWith("public/") ||
        (b.visibility === "public" &&
          (b.kind !== "public_copy" ||
            !b.source_blob_id ||
            !b.source_asset_revision ||
            !b.approved_revision_id))
      )
        reject();
    }
    for (const r of value.reservations)
      if (!reservationTargets.has(r.id) && !value.blobs.some((b) => b.reservation_id === r.id))
        reject();
    for (const b of value.bindings) {
      if (
        blobs.get(b.blob_id)?.object_key !== b.object_key ||
        (b.writer_state === "prepared" &&
          (b.writer_token !== null || b.expected_cipher_bytes !== null)) ||
        (b.writer_state === "running" &&
          (!b.writer_token ||
            !b.expected_cipher_bytes ||
            b.expected_cipher_bytes > b.maximum_cipher_bytes))
      )
        reject();
    }
  });
export type V2RestoreJournal = z.infer<typeof v2RestoreJournalSchema>;

/** A bounded, transactionally consistent export. Oversized exports fail rather than silently truncate. */
export async function exportV2RestoreJournal(core: V2Core): Promise<V2RestoreJournal> {
  const rows = await core.binding.batch([
    core.statement(
      "SELECT id,target_kind,target_id,created_at FROM v2_deletion_journals ORDER BY id LIMIT 257",
    ),
    core.statement(
      "SELECT journal_id,kind,target_id FROM v2_deletion_targets ORDER BY journal_id,kind,target_id LIMIT 4097",
    ),
    core.statement(
      "SELECT id,principal_id,operation_id,target_id,entity_id,kind,byte_length,state,created_at FROM v2_storage_reservations WHERE id IN (SELECT target_id FROM v2_deletion_targets WHERE kind='reservation') OR id IN (SELECT reservation_id FROM v2_blobs WHERE id IN (SELECT target_id FROM v2_deletion_targets WHERE kind='blob')) ORDER BY id LIMIT 1025",
    ),
    core.statement(
      "SELECT id,principal_id,reservation_id,kind,visibility,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,created_at,source_blob_id,source_asset_revision,approved_revision_id FROM v2_blobs WHERE id IN (SELECT target_id FROM v2_deletion_targets WHERE kind='blob') ORDER BY id LIMIT 1025",
    ),
    core.statement(
      "SELECT blob_id,environment,owner_id,object_key,maximum_cipher_bytes,writer_state,writer_token,expected_cipher_bytes,inventory_hash,created_at FROM v2_physical_blob_bindings WHERE blob_id IN (SELECT target_id FROM v2_deletion_targets WHERE kind='blob') ORDER BY blob_id LIMIT 1025",
    ),
  ]);
  return v2RestoreJournalSchema.parse({
    journals: rows[0]?.results,
    targets: rows[1]?.results,
    reservations: rows[2]?.results,
    blobs: rows[3]?.results,
    bindings: rows[4]?.results,
  });
}

/** Prepared SQL is private operator input, never an HTTP route or automatic remote restore.
 * Traffic/dispatch must remain closed until fresh cleanup/stop/negative HEAD receipts complete. */
export function prepareV2RestoreReplay(
  input: unknown,
  options: {
    trafficClosed: true;
    environment: "preview" | "production";
    now: string;
    inventoryHash?: string;
  },
) {
  const data = v2RestoreJournalSchema.parse(input);
  if (options.trafficClosed !== true) throw new Error("RESTORE_TRAFFIC_MUST_REMAIN_CLOSED");
  z.enum(["preview", "production"]).parse(options.environment);
  if (options.inventoryHash !== undefined)
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(options.inventoryHash);
  const now = timestampSchema.parse(options.now);
  if (
    data.journals.some((j) => j.created_at > now) ||
    data.bindings.some((b) => b.environment !== options.environment)
  )
    throw new Error("RESTORE_SCOPE_INVALID");
  const literal = (v: string) => `'${v.replaceAll("'", "''")}'`;
  const json = (value: unknown) => literal(JSON.stringify(value));
  const j = json(data.journals),
    t = json(data.targets),
    r = json(data.reservations),
    b = json(data.blobs),
    p = json(data.bindings),
    at = literal(now);
  const scope = `SELECT d.id FROM v2_deletion_journals d JOIN json_each(${j}) source ON d.target_kind=json_extract(source.value,'$.target_kind') AND d.target_id=json_extract(source.value,'$.target_id')`;
  const sql: string[] = [];
  // A conflicting immutable ID/key means this is not the expected restore. Abort
  // the entire batch through an existing CHECK; never overwrite peer inventory.
  sql.push(
    `INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) SELECT 'restore_invalid','restore',${at} WHERE EXISTS(SELECT 1 FROM json_each(${b}) source JOIN v2_blobs existing ON existing.id=json_extract(source.value,'$.id') WHERE existing.object_key!=json_extract(source.value,'$.object_key') OR existing.principal_id!=json_extract(source.value,'$.principal_id') OR existing.reservation_id!=json_extract(source.value,'$.reservation_id') OR existing.kind!=json_extract(source.value,'$.kind') OR existing.visibility!=json_extract(source.value,'$.visibility')) OR EXISTS(SELECT 1 FROM json_each(${r}) source JOIN v2_storage_reservations existing ON existing.id=json_extract(source.value,'$.id') WHERE existing.principal_id!=json_extract(source.value,'$.principal_id') OR existing.operation_id!=json_extract(source.value,'$.operation_id') OR existing.target_id!=json_extract(source.value,'$.target_id') OR existing.entity_id!=json_extract(source.value,'$.entity_id') OR existing.kind!=json_extract(source.value,'$.kind') OR existing.byte_length!=json_extract(source.value,'$.byte_length')) OR EXISTS(SELECT 1 FROM json_each(${p}) source JOIN v2_physical_blob_bindings existing ON existing.blob_id=json_extract(source.value,'$.blob_id') WHERE existing.object_key!=json_extract(source.value,'$.object_key') OR existing.environment!=json_extract(source.value,'$.environment') OR existing.owner_id!=json_extract(source.value,'$.owner_id') OR existing.maximum_cipher_bytes!=json_extract(source.value,'$.maximum_cipher_bytes')) OR (EXISTS(SELECT 1 FROM json_each(${p})) AND NOT EXISTS(SELECT 1 FROM v2_physical_storage_capacity WHERE environment=${literal(options.environment)}))`,
  );
  sql.push(
    `INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.target_kind'),json_extract(value,'$.target_id'),json_extract(value,'$.created_at'),${at} FROM json_each(${j}) WHERE 1 ON CONFLICT(target_kind,target_id) DO NOTHING`,
  );
  sql.push(
    `INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id) SELECT d.id,coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=d.id),0)+row_number() OVER(PARTITION BY d.id ORDER BY json_extract(t.value,'$.kind'),json_extract(t.value,'$.target_id'))-1,json_extract(t.value,'$.kind'),json_extract(t.value,'$.target_id') FROM json_each(${t}) t JOIN json_each(${j}) s ON json_extract(s.value,'$.id')=json_extract(t.value,'$.journal_id') JOIN v2_deletion_journals d ON d.target_kind=json_extract(s.value,'$.target_kind') AND d.target_id=json_extract(s.value,'$.target_id') WHERE NOT EXISTS(SELECT 1 FROM v2_deletion_targets existing WHERE existing.journal_id=d.id AND existing.kind=json_extract(t.value,'$.kind') AND existing.target_id=json_extract(t.value,'$.target_id'))`,
  );
  // Reconstruct post-backup physical obligations, never the deleted private content.
  sql.push(
    `INSERT INTO v2_billing_principals(id,owner_id,created_at) SELECT DISTINCT json_extract(reservation.value,'$.principal_id'),(SELECT json_extract(binding.value,'$.owner_id') FROM json_each(${p}) binding JOIN json_each(${b}) blob ON json_extract(blob.value,'$.id')=json_extract(binding.value,'$.blob_id') WHERE json_extract(blob.value,'$.principal_id')=json_extract(reservation.value,'$.principal_id') AND EXISTS(SELECT 1 FROM user WHERE id=json_extract(binding.value,'$.owner_id')) LIMIT 1),${at} FROM json_each(${r}) reservation WHERE 1 ON CONFLICT(id) DO NOTHING`,
  );
  sql.push(
    `INSERT INTO v2_storage_usage(principal_id) SELECT DISTINCT json_extract(value,'$.principal_id') FROM json_each(${r}) WHERE 1 ON CONFLICT DO NOTHING`,
  );
  sql.push(
    `INSERT INTO v2_storage_reservations(id,principal_id,operation_id,workspace_id,target_id,entity_id,kind,byte_length,state,created_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.principal_id'),json_extract(value,'$.operation_id'),NULL,json_extract(value,'$.target_id'),json_extract(value,'$.entity_id'),json_extract(value,'$.kind'),json_extract(value,'$.byte_length'),CASE WHEN json_extract(value,'$.state')='reserved' THEN 'reserved' ELSE 'stored' END,json_extract(value,'$.created_at') FROM json_each(${r}) WHERE 1 ON CONFLICT(id) DO UPDATE SET state=excluded.state`,
  );
  sql.push(
    `INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at,source_blob_id,source_asset_revision,approved_revision_id) SELECT json_extract(value,'$.id'),json_extract(value,'$.principal_id'),json_extract(value,'$.reservation_id'),json_extract(value,'$.kind'),json_extract(value,'$.visibility'),'deleting',json_extract(value,'$.object_key'),json_extract(value,'$.logical_bytes'),json_extract(value,'$.cipher_bytes'),json_extract(value,'$.cipher_hash'),json_extract(value,'$.key_version'),'removed',json_extract(value,'$.created_at'),json_extract(value,'$.source_blob_id'),json_extract(value,'$.source_asset_revision'),json_extract(value,'$.approved_revision_id') FROM json_each(${b}) WHERE 1 ON CONFLICT(id) DO UPDATE SET state='deleting',encrypted_payload='removed',deleted_at=NULL,cipher_bytes=excluded.cipher_bytes,cipher_hash=excluded.cipher_hash,key_version=excluded.key_version`,
  );
  sql.push(
    `INSERT INTO v2_physical_blob_bindings(blob_id,environment,owner_id,object_key,maximum_cipher_bytes,state,writer_state,writer_token,expected_cipher_bytes,inventory_hash,created_at,released_receipt_id) SELECT json_extract(value,'$.blob_id'),json_extract(value,'$.environment'),json_extract(value,'$.owner_id'),json_extract(value,'$.object_key'),json_extract(value,'$.maximum_cipher_bytes'),'held',json_extract(value,'$.writer_state'),json_extract(value,'$.writer_token'),json_extract(value,'$.expected_cipher_bytes'),coalesce(json_extract(value,'$.inventory_hash'),${literal(options.inventoryHash ?? "")}),json_extract(value,'$.created_at'),NULL FROM json_each(${p}) source WHERE NOT EXISTS(SELECT 1 FROM v2_physical_blob_bindings existing WHERE existing.blob_id=json_extract(source.value,'$.blob_id'))`,
  );
  // A latest stopped writer can only settle the exact restored writer token/size.
  // Prepared/running/unknown writers never gain an invented stop transition.
  sql.push(
    `UPDATE v2_physical_blob_bindings SET writer_state='stopped' WHERE state='held' AND writer_state='running' AND EXISTS(SELECT 1 FROM json_each(${p}) source WHERE json_extract(source.value,'$.blob_id')=v2_physical_blob_bindings.blob_id AND json_extract(source.value,'$.writer_state')='stopped' AND json_extract(source.value,'$.writer_token') IS v2_physical_blob_bindings.writer_token AND json_extract(source.value,'$.expected_cipher_bytes') IS v2_physical_blob_bindings.expected_cipher_bytes)`,
  );
  sql.push(
    `UPDATE v2_physical_storage_capacity SET held_bytes=coalesce((SELECT sum(maximum_cipher_bytes) FROM v2_physical_blob_bindings WHERE state='held' AND environment=v2_physical_storage_capacity.environment),0),revision=revision+1 WHERE environment=${literal(options.environment)} AND EXISTS(SELECT 1 FROM json_each(${p}))`,
  );
  sql.push(
    `UPDATE v2_storage_usage SET stored_bytes=coalesce((SELECT sum(byte_length) FROM v2_storage_reservations WHERE principal_id=v2_storage_usage.principal_id AND state='stored'),0),reserved_bytes=coalesce((SELECT sum(byte_length) FROM v2_storage_reservations WHERE principal_id=v2_storage_usage.principal_id AND state='reserved'),0) WHERE principal_id IN (SELECT json_extract(value,'$.principal_id') FROM json_each(${r}))`,
  );
  // Primary deletes invoke the existing guarded cascade/inventory triggers.
  const tables = {
    account: "user",
    workspace: "v2_workspaces",
    file: "v2_files",
    profile: "v2_profiles",
    asset: "v2_assets",
    report: "v2_reports",
  } as const;
  for (const [targetKind, table] of Object.entries(tables)) {
    if (targetKind === "account")
      sql.push(
        `DELETE FROM app_metadata WHERE key IN (SELECT 'account-type:'||json_extract(value,'$.target_id') FROM json_each(${j}) WHERE json_extract(value,'$.target_kind')='account')`,
      );
    sql.push(
      `DELETE FROM ${table} WHERE id IN (SELECT json_extract(value,'$.target_id') FROM json_each(${j}) WHERE json_extract(value,'$.target_kind')=${literal(targetKind)})`,
    );
  }
  sql.push(
    `INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) SELECT json_extract(value,'$.target_kind'),json_extract(value,'$.target_id'),json_extract(value,'$.created_at') FROM json_each(${j}) WHERE json_extract(value,'$.target_kind') IN ('account','workspace','file','profile','asset','report') ON CONFLICT DO NOTHING`,
  );
  // Imported completion receipts do not establish absence in a restored object store.
  sql.push(`DELETE FROM v2_cleanup_receipts WHERE journal_id IN (${scope})`);
  sql.push(`UPDATE v2_deletion_targets SET state='pending' WHERE journal_id IN (${scope})`);
  sql.push(
    `UPDATE v2_deletion_journals SET state='pending',completed_at=NULL,lease_token=NULL,lease_until=NULL,fencing=fencing+1,cursor=0,attempts=0,next_attempt_at=${at} WHERE id IN (${scope})`,
  );
  if (sql.some((statement) => new TextEncoder().encode(statement).byteLength > 90_000))
    throw new Error("RESTORE_BATCH_TOO_LARGE");
  return sql;
}

export async function replayV2RestoreJournal(
  core: V2Core,
  input: unknown,
  options: Parameters<typeof prepareV2RestoreReplay>[1],
) {
  const sql = prepareV2RestoreReplay(input, options);
  await core.binding.batch(sql.map((statement) => core.statement(statement)));
  return {
    trafficMustRemainClosed: true as const,
    replayed: v2RestoreJournalSchema.parse(input).journals.length,
  };
}
