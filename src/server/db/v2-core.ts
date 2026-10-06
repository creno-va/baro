import { z } from "zod";
import { opaqueIdSchema, revisionSchema, timestampSchema } from "../../contracts";
import {
  type EncryptionContext,
  type EnvelopeCipher,
  MAX_PLAINTEXT_BYTES,
  V2_SNAPSHOT_PURPOSES,
} from "../crypto";

export class V2RepositoryError extends Error {
  constructor(
    readonly code:
      | "REPOSITORY_INPUT_INVALID"
      | "DB_OPERATION_FAILED"
      | "SNAPSHOT_INVALID"
      | "SNAPSHOT_STREAM_REQUIRED"
      | "FORBIDDEN",
  ) {
    super(code);
    this.name = "V2RepositoryError";
  }
}
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new V2RepositoryError("REPOSITORY_INPUT_INVALID");
  return result.data;
}
export async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof V2RepositoryError) throw error;
    throw new V2RepositoryError("DB_OPERATION_FAILED");
  }
}
export const actorSchema = z.strictObject({
  ownerId: opaqueIdSchema,
  now: timestampSchema.transform((value) => new Date(value).toISOString()),
});
export type Actor = z.infer<typeof actorSchema>;
export const guardSchema = actorSchema.extend({
  workspaceId: opaqueIdSchema,
  expectedRevision: revisionSchema,
});
export type WorkspaceGuard = z.infer<typeof guardSchema>;
export const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const sqlClaim = "EXISTS (SELECT 1 FROM v2_mutation_claims WHERE id = ?)";
export const aliveWorkspace = `NOT EXISTS (SELECT 1 FROM v2_tombstones t WHERE (t.target_kind = 'workspace' AND t.target_id = w.id) OR (t.target_kind = 'account' AND t.target_id = w.owner_id))`;
export const workspaceGuardSql = `w.owner_id = ? AND w.id = ? AND w.revision = ? AND ${aliveWorkspace}`;
export function createV2Core(
  binding: D1Database,
  cipher: EnvelopeCipher,
  options: { monthlyBudgetCapEnabled?: boolean | undefined } = {},
) {
  const sizes = new WeakMap<D1PreparedStatement, number>();
  const statement = (sql: string, values: unknown[] = []) => {
    if (values.length > 100) throw new V2RepositoryError("SNAPSHOT_STREAM_REQUIRED");
    const prepared = binding.prepare(sql).bind(...values);
    sizes.set(
      prepared,
      new TextEncoder().encode(sql).byteLength +
        values.reduce<number>(
          (size, value) => size + (typeof value === "string" ? utf8Bytes(value) : 16),
          0,
        ),
    );
    return prepared;
  };
  const claim = (
    g: WorkspaceGuard,
    claimId: string,
    additional = "1",
    parameters: unknown[] = [],
  ) =>
    statement(
      `INSERT INTO v2_mutation_claims(id, owner_id, target_id, revision) SELECT ?,w.owner_id,w.id,w.revision FROM v2_workspaces w WHERE ${workspaceGuardSql} AND (${additional})`,
      [claimId, g.ownerId, g.workspaceId, g.expectedRevision, ...parameters],
    );
  const finish = (claimId: string) =>
    statement("DELETE FROM v2_mutation_claims WHERE id = ?", [claimId]);
  const bump = (g: WorkspaceGuard, claimId: string) =>
    statement(
      `UPDATE v2_workspaces SET revision = revision+1, updated_at = ? WHERE id = ? AND ${sqlClaim}`,
      [g.now, g.workspaceId, claimId],
    );
  const changed = async (statements: D1PreparedStatement[]) => {
    if (
      statements.length > 40 ||
      statements.reduce((size, item) => size + (sizes.get(item) ?? 0), 0) > 2097152
    )
      throw new V2RepositoryError("SNAPSHOT_STREAM_REQUIRED");
    return (await binding.batch(statements))[0]?.meta.changes === 1;
  };
  const encrypt = (
    table: Extract<EncryptionContext, { revision: number }>["table"],
    rowId: string,
    ownerId: string,
    revision: number,
    value: unknown,
  ) => {
    if (table === "v2_private_parts") throw new V2RepositoryError("REPOSITORY_INPUT_INVALID");
    return cipher.encrypt(JSON.stringify(value), {
      table,
      column: "encrypted_payload",
      rowId,
      userId: ownerId,
      revision,
    });
  };
  const decrypt = async <T>(
    table: Exclude<Extract<EncryptionContext, { revision: number }>["table"], "v2_private_parts">,
    rowId: string,
    ownerId: string,
    revision: number,
    envelope: string,
    schema: z.ZodType<T>,
  ) =>
    parse(
      schema,
      JSON.parse(
        await cipher.decrypt(envelope, {
          table,
          column: "encrypted_payload",
          rowId,
          userId: ownerId,
          revision,
        }),
      ),
    );
  return {
    binding,
    cipher,
    statement,
    claim,
    finish,
    bump,
    changed,
    encrypt,
    decrypt,
    monthlyBudgetCapEnabled: options.monthlyBudgetCapEnabled !== false,
  };
}
export type V2Core = ReturnType<typeof createV2Core>;
export type SnapshotPurpose = (typeof V2_SNAPSHOT_PURPOSES)[number];
export interface SnapshotWrite {
  id: string;
  ownerId: string;
  workspaceId: string | null;
  targetId: string;
  revision: number;
  purpose: SnapshotPurpose;
  now: string;
}
export const SNAPSHOT_FRAGMENT_BYTES = 64 * 1024;
export const MAX_REHYDRATE_BYTES = 4 * 1024 * 1024;
export async function snapshotChain(
  previous: string,
  index: number,
  text: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${previous}:${index}:${utf8Bytes(text)}:${text}`);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const scalar of text) {
    const point = scalar.codePointAt(0) ?? 0;
    if (point >= 0xd800 && point <= 0xdfff) throw new V2RepositoryError("SNAPSHOT_INVALID");
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
/** Splits at Unicode scalar boundaries. Unpaired surrogates are rejected rather than silently replaced. */
export function fragmentText(text: string, limit = SNAPSHOT_FRAGMENT_BYTES): string[] {
  if (!Number.isInteger(limit) || limit < 4 || limit > MAX_PLAINTEXT_BYTES)
    throw new V2RepositoryError("REPOSITORY_INPUT_INVALID");
  if (utf8Bytes(text) > 104857600) throw new V2RepositoryError("SNAPSHOT_INVALID");
  const parts: string[] = [];
  let part = "";
  let bytes = 0;
  for (const character of text) {
    const size = utf8Bytes(character);
    if (bytes + size > limit) {
      parts.push(part);
      part = "";
      bytes = 0;
    }
    part += character;
    bytes += size;
  }
  if (part) parts.push(part);
  if (parts.length === 0 || parts.length > 100000) throw new V2RepositoryError("SNAPSHOT_INVALID");
  return parts;
}
export async function snapshotStatements(
  core: V2Core,
  input: SnapshotWrite,
  value: unknown,
  claimId: string,
): Promise<D1PreparedStatement[]> {
  parse(opaqueIdSchema, input.id);
  parse(opaqueIdSchema, input.ownerId);
  parse(opaqueIdSchema, input.targetId);
  parse(revisionSchema, input.revision);
  parse(timestampSchema, input.now);
  parse(z.enum(V2_SNAPSHOT_PURPOSES), input.purpose);
  const text = JSON.stringify(value);
  if (utf8Bytes(text) > 98304) throw new V2RepositoryError("SNAPSHOT_STREAM_REQUIRED");
  const parts = fragmentText(text);
  const encoder = new TextEncoder();
  let digest = "0".repeat(64);
  for (const [index, part] of parts.entries()) digest = await snapshotChain(digest, index, part);
  const integrity = await core.encrypt(
    "v2_private_snapshots",
    input.id,
    input.ownerId,
    input.revision,
    {
      format: "chain_v1",
      digest,
      purpose: input.purpose,
      targetId: input.targetId,
      partCount: parts.length,
    },
  );
  const statements = [
    core.statement(
      `INSERT INTO v2_private_snapshots(id,owner_id,workspace_id,purpose,target_id,revision,part_count,byte_length,encrypted_payload,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${sqlClaim}`,
      [
        input.id,
        input.ownerId,
        input.workspaceId,
        input.purpose,
        input.targetId,
        input.revision,
        parts.length,
        encoder.encode(text).byteLength,
        integrity,
        new Date(input.now).toISOString(),
        claimId,
      ],
    ),
  ];
  for (const [part, plaintext] of parts.entries()) {
    const rowId = crypto.randomUUID();
    const envelope = await core.cipher.encrypt(plaintext, {
      table: "v2_private_parts",
      column: "encrypted_payload",
      rowId,
      userId: input.ownerId,
      targetId: input.targetId,
      purpose: input.purpose,
      revision: input.revision,
      part,
    });
    statements.push(
      core.statement(
        `INSERT INTO v2_private_parts(id,snapshot_id,part_index,byte_length,encrypted_payload) SELECT ?,?,?,?,? WHERE ${sqlClaim}`,
        [rowId, input.id, part, encoder.encode(plaintext).byteLength, envelope, claimId],
      ),
    );
  }
  return statements;
}
export async function readSnapshot<T>(
  core: V2Core,
  actor: Actor,
  snapshotId: string,
  purpose: SnapshotPurpose,
  targetId: string,
  revision: number,
  schema: z.ZodType<T>,
): Promise<T | null> {
  actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
  parse(opaqueIdSchema, snapshotId);
  parse(opaqueIdSchema, targetId);
  parse(revisionSchema, revision);
  const guardSql = `SELECT s.* FROM v2_private_snapshots s WHERE s.id=? AND s.owner_id=? AND s.purpose=? AND s.target_id=? AND s.revision=? AND s.state='published' AND NOT EXISTS (SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=?) OR (target_kind IN ('file','profile','report') AND target_id=s.target_id)) AND (s.workspace_id IS NULL OR EXISTS(SELECT 1 FROM v2_workspaces w WHERE w.id=s.workspace_id AND w.owner_id=s.owner_id AND ${aliveWorkspace}))`;
  const guardValues = [snapshotId, actor.ownerId, purpose, targetId, revision, actor.ownerId];
  const header = await core
    .statement(guardSql, guardValues)
    .first<{ part_count: number; byte_length: number; encrypted_payload: string }>();
  if (!header) return null;
  if (header.byte_length > MAX_REHYDRATE_BYTES)
    throw new V2RepositoryError("SNAPSHOT_STREAM_REQUIRED");
  const { results } = await core
    .statement("SELECT * FROM v2_private_parts WHERE snapshot_id=? ORDER BY part_index", [
      snapshotId,
    ])
    .all<{ id: string; part_index: number; byte_length: number; encrypted_payload: string }>();
  if (results.length !== header.part_count) throw new V2RepositoryError("SNAPSHOT_INVALID");
  const plaintext: string[] = [];
  let bytes = 0;
  let chainedDigest = "0".repeat(64);
  for (const [index, part] of results.entries()) {
    if (part.part_index !== index) throw new V2RepositoryError("SNAPSHOT_INVALID");
    const text = await core.cipher.decrypt(part.encrypted_payload, {
      table: "v2_private_parts",
      column: "encrypted_payload",
      rowId: part.id,
      userId: actor.ownerId,
      targetId,
      purpose,
      revision,
      part: index,
    });
    if (new TextEncoder().encode(text).byteLength !== part.byte_length)
      throw new V2RepositoryError("SNAPSHOT_INVALID");
    bytes += part.byte_length;
    plaintext.push(text);
    chainedDigest = await snapshotChain(chainedDigest, index, text);
  }
  if (bytes !== header.byte_length) throw new V2RepositoryError("SNAPSHOT_INVALID");
  const combined = plaintext.join("");
  const integrity = await core.decrypt(
    "v2_private_snapshots",
    snapshotId,
    actor.ownerId,
    revision,
    header.encrypted_payload,
    z.strictObject({
      format: z.literal("chain_v1").optional(),
      digest: hashSchema,
      purpose: z.enum(V2_SNAPSHOT_PURPOSES),
      targetId: opaqueIdSchema,
      partCount: z.number().int().positive(),
    }),
  );
  const digest =
    integrity.format === "chain_v1"
      ? chainedDigest
      : Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(combined))),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
  if (
    integrity.digest !== digest ||
    integrity.purpose !== purpose ||
    integrity.targetId !== targetId ||
    integrity.partCount !== results.length
  )
    throw new V2RepositoryError("SNAPSHOT_INVALID");
  const value = parse(schema, JSON.parse(combined));
  // Decryption may yield while deletion/ownership changes run. Reauthorize immediately before return.
  const finalHeader = await core
    .statement(guardSql, guardValues)
    .first<{ encrypted_payload: string }>();
  if (!finalHeader || finalHeader.encrypted_payload !== header.encrypted_payload) return null;
  return value;
}
