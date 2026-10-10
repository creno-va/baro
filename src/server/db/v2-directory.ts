import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../contracts";
import {
  type V2DirectoryQuery,
  type V2DirectorySnapshot,
  v2DirectoryQuerySchema,
  v2DirectorySnapshotSchema,
  v2PublicLawyerSchema,
} from "../../contracts/v2";
import { parse, safe, type V2Core, V2RepositoryError } from "./v2-core";
import { directoryCleanupStatements } from "./v2-directory-cleanup";

export const DIRECTORY_SNAPSHOT_TTL_MS = 5 * 60 * 1000;
export const DIRECTORY_ROTATION_ALGORITHM = "profile_id_daily_v1" as const;

type Header = {
  id: string;
  created_at: string;
  expires_at: string;
  query_json: string;
  rotation_day: string;
  rotation_algorithm: string;
  item_count: number;
};
type Scanned = {
  ordinal: number;
  profile_id: string;
  revision_id: string;
  content_json: string | null;
};
const cursorSchema = z.tuple([uuidSchema, z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)]);
const canonicalTime = (value: string) => new Date(parse(timestampSchema, value)).toISOString();
const filters = (query: V2DirectoryQuery) =>
  JSON.stringify({
    ...(query.name === undefined ? {} : { name: query.name }),
    ...(query.region === undefined ? {} : { region: query.region }),
    ...(query.legalField === undefined ? {} : { legalField: query.legalField }),
  });

// These predicates use approved public projection and authorization metadata only.
// They never read/decrypt a case, application payload, profile draft or identity asset.
const eligible = `p.approved_revision_id=pub.revision_id
  AND r.id=pub.revision_id AND r.profile_id=p.id AND r.revision=pub.approved_revision AND r.status='approved'
  AND EXISTS(SELECT 1 FROM v2_role_bindings role WHERE role.owner_id=p.owner_id AND role.role='verified_lawyer')
  AND EXISTS(SELECT 1 FROM v2_applications app WHERE app.id=r.application_id AND app.owner_id=p.owner_id AND app.status='approved')
  AND NOT EXISTS(SELECT 1 FROM v2_tombstones t WHERE (t.target_kind='account' AND t.target_id=p.owner_id) OR (t.target_kind='profile' AND t.target_id=p.id))
  AND NOT EXISTS(SELECT 1 FROM v2_public_assets asset JOIN v2_blobs b ON b.id=asset.public_blob_id
    WHERE asset.profile_id=p.id AND asset.revision_id=r.id AND (b.state!='stored' OR b.visibility!='public'
      OR EXISTS(SELECT 1 FROM v2_tombstones t WHERE t.target_kind='asset' AND t.target_id=asset.asset_id)))`;
const publicJoin =
  "JOIN v2_public_profiles pub ON pub.profile_id=p.id JOIN v2_profile_revisions r ON r.id=pub.revision_id";

function encodeCursor(id: string, ordinal: number) {
  return btoa(JSON.stringify([id, ordinal]))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function decodeCursor(value: string) {
  try {
    const decoded = parse(
      cursorSchema,
      JSON.parse(atob(value.replaceAll("-", "+").replaceAll("_", "/"))),
    );
    if (encodeCursor(...decoded) !== value) throw new V2RepositoryError("REPOSITORY_INPUT_INVALID");
    return decoded;
  } catch {
    throw new V2RepositoryError("REPOSITORY_INPUT_INVALID");
  }
}

export function createV2DirectoryRepository(core: V2Core) {
  const header = (id: string, now: string) =>
    core
      .statement(
        "SELECT * FROM v2_directory_snapshots WHERE id=? AND created_at<=? AND expires_at>? AND rotation_algorithm=?",
        [id, now, now, DIRECTORY_ROTATION_ALGORITHM],
      )
      .first<Header>();

  const readPage = async (
    now: string,
    query: V2DirectoryQuery,
    snapshot: Header,
    after: number,
  ): Promise<V2DirectorySnapshot | null> => {
    if (snapshot.query_json !== filters(query) || after >= snapshot.item_count) return null;
    // Raw scan is bounded even if every profile in the window has become ineligible.
    // Advancing by the raw ordinal prevents duplicate results and endless empty pages.
    const rows = (
      await core
        .statement(
          `SELECT item.ordinal,item.profile_id,item.revision_id,
      (SELECT pub.content_json FROM v2_profiles p ${publicJoin}
       WHERE p.id=item.profile_id AND pub.revision_id=item.revision_id AND ${eligible}) AS content_json
      FROM v2_directory_items item WHERE item.snapshot_id=? AND item.ordinal>? ORDER BY item.ordinal LIMIT ?`,
          [snapshot.id, after, query.limit],
        )
        .all<Scanned>()
    ).results;
    const candidates = rows.filter((row) => row.content_json !== null);
    const ordinals = JSON.stringify(candidates.map((row) => row.ordinal));
    // A second group query closes withdrawal/role/pointer races while staying under
    // D1's invocation query limit; no per-lawyer query or private decryption occurs.
    const current = (
      await core
        .statement(
          `SELECT snapshot.id,live.ordinal,live.content_json,live.approved_revision
      FROM v2_directory_snapshots snapshot LEFT JOIN (
        SELECT item.snapshot_id,item.ordinal,pub.content_json,pub.approved_revision
        FROM v2_directory_items item JOIN v2_profiles p ON p.id=item.profile_id ${publicJoin}
        WHERE item.snapshot_id=? AND item.ordinal IN (SELECT value FROM json_each(?))
          AND pub.revision_id=item.revision_id AND ${eligible}
      ) live ON live.snapshot_id=snapshot.id
      WHERE snapshot.id=? AND snapshot.created_at<=? AND snapshot.expires_at>?
        AND snapshot.expires_at=? AND snapshot.query_json=? AND snapshot.item_count=? AND snapshot.rotation_algorithm=?`,
          [
            snapshot.id,
            ordinals,
            snapshot.id,
            now,
            now,
            snapshot.expires_at,
            snapshot.query_json,
            snapshot.item_count,
            DIRECTORY_ROTATION_ALGORITHM,
          ],
        )
        .all<{
          id: string;
          ordinal: number | null;
          content_json: string | null;
          approved_revision: number | null;
        }>()
    ).results;
    if (current.length === 0) return null;
    const live = new Map(current.map((row) => [row.ordinal, row]));
    const items = candidates.flatMap((row) => {
      const final = live.get(row.ordinal);
      if (final?.content_json !== row.content_json) return [];
      const lawyer = v2PublicLawyerSchema.safeParse(JSON.parse(row.content_json ?? "null"));
      // A malformed public projection is excluded; private sources are never fallback.
      return lawyer.success &&
        lawyer.data.id === row.profile_id &&
        lawyer.data.approvedRevision === final.approved_revision
        ? [lawyer.data]
        : [];
    });
    const lastOrdinal = rows[rows.length - 1]?.ordinal;
    return parse(v2DirectorySnapshotSchema, {
      schemaVersion: "2",
      snapshotId: snapshot.id,
      rotation: "disclosed_rotation",
      expiresAt: snapshot.expires_at,
      items,
      nextCursor:
        lastOrdinal !== undefined && lastOrdinal < snapshot.item_count - 1
          ? encodeCursor(snapshot.id, lastOrdinal)
          : null,
    });
  };

  return {
    create(now: string, query: V2DirectoryQuery, input: { id: string; expiresAt: string }) {
      return safe(async () => {
        now = canonicalTime(now);
        query = parse(v2DirectoryQuerySchema, query);
        parse(uuidSchema, input.id);
        if (query.cursor !== undefined) throw new V2RepositoryError("REPOSITORY_INPUT_INVALID");
        const expiresAt = canonicalTime(input.expiresAt);
        const ttl = Date.parse(expiresAt) - Date.parse(now);
        if (ttl <= 0 || ttl > DIRECTORY_SNAPSHOT_TTL_MS)
          throw new V2RepositoryError("REPOSITORY_INPUT_INVALID");
        const queryJson = filters(query);
        const old = await core
          .statement("SELECT * FROM v2_directory_snapshots WHERE id=?", [input.id])
          .first<Header>();
        if (old)
          return old.created_at <= now &&
            old.expires_at > now &&
            old.rotation_algorithm === DIRECTORY_ROTATION_ALGORITHM &&
            old.expires_at === expiresAt &&
            old.query_json === queryJson
            ? readPage(now, query, old, -1)
            : null;
        const dayIndex = Math.floor((Date.parse(now) + 9 * 60 * 60 * 1000) / 86_400_000);
        const rotationDay = new Date(dayIndex * 86_400_000).toISOString().slice(0, 10);
        const where = [eligible];
        const values: unknown[] = [];
        if (query.name !== undefined) {
          where.push("instr(lower(json_extract(pub.content_json,'$.content.name')),lower(?))>0");
          values.push(query.name);
        }
        if (query.region !== undefined) {
          where.push("json_extract(pub.content_json,'$.content.office.region')=?");
          values.push(query.region);
        }
        if (query.legalField !== undefined) {
          where.push(
            "EXISTS(SELECT 1 FROM json_each(pub.content_json,'$.content.legalFields') WHERE value=?)",
          );
          values.push(query.legalField);
        }
        // Public profile ID order shifts one place each KST day. The snapshot records
        // the algorithm/day; pagination never reranks and no fit/payment score exists.
        await core.binding.batch([
          ...directoryCleanupStatements(core.binding, now),
          core.statement(
            "INSERT INTO v2_directory_snapshots(id,created_at,expires_at,query_json,rotation_day,rotation_algorithm,item_count) VALUES(?,?,?,?,?,?,0)",
            [input.id, now, expiresAt, queryJson, rotationDay, DIRECTORY_ROTATION_ALGORITHM],
          ),
          core.statement(
            `INSERT INTO v2_directory_items(snapshot_id,ordinal,profile_id,revision_id)
            WITH approved AS (SELECT p.id AS profile_id,pub.revision_id,
              row_number() OVER (ORDER BY p.id)-1 AS base,count(*) OVER () AS total
              FROM v2_profiles p ${publicJoin} WHERE ${where.join(" AND ")})
            SELECT ?,row_number() OVER (ORDER BY (base-(?%total)+total)%total)-1,profile_id,revision_id FROM approved`,
            [...values, input.id, dayIndex],
          ),
          core.statement(
            "UPDATE v2_directory_snapshots SET item_count=(SELECT count(*) FROM v2_directory_items WHERE snapshot_id=?) WHERE id=?",
            [input.id, input.id],
          ),
        ]);
        const saved = await header(input.id, now);
        return saved ? readPage(now, query, saved, -1) : null;
      });
    },
    page(now: string, query: V2DirectoryQuery) {
      return safe(async () => {
        now = canonicalTime(now);
        query = parse(v2DirectoryQuerySchema, query);
        if (!query.cursor) throw new V2RepositoryError("REPOSITORY_INPUT_INVALID");
        const [id, after] = decodeCursor(query.cursor);
        const saved = await header(id, now);
        return saved ? readPage(now, query, saved, after) : null;
      });
    },
  };
}
