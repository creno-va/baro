import {
  type DirectoryItem,
  type DirectorySearch,
  directoryItemSchema,
  directorySearchSchema,
} from "../../contracts/v2";
import {
  DirectoryIndexError,
  type DirectoryPosition,
  directoryCursorCodec,
} from "../modules/lawyers/directory-cursor";
import { usageDateKst } from "./repository";
import type { V2Core } from "./v2-core";
import {
  type DirectorySource,
  directoryEligibleSql,
  normalizeDirectoryText,
} from "./v2-directory-projection";
import { runtimeDigest } from "./v2-paid-runtime";

export const DIRECTORY_CANDIDATE_LIMIT = 100;
export const DIRECTORY_PAGE_TTL_MS = 300000;
type Candidate = { profile_id: string; sort_key: string };
type Entry = Candidate & {
  source: DirectorySource;
  source_id: string;
  revision: number;
  public_json: string;
  normalized_name: string;
  normalized_office: string;
  region: string;
};

/** Every lead lookup is an indexed prefix/keyset range. Authorization and final
 * substring checks happen only inside a bounded window, never an all-results
 * sort/filter or materialized snapshot. A page may be short and have a cursor. */
export function createIndexedDirectory(
  core: V2Core,
  options: { secret: string; scope: string; clock?: () => string },
) {
  const clock = options.clock ?? (() => new Date().toISOString());
  const codec = directoryCursorCodec(options.secret, options.scope);
  const epoch = async () => {
    const revision = await core
      .statement("SELECT revision FROM v2_directory_epoch WHERE id=1")
      .first<number>("revision");
    if (!revision) throw new DirectoryIndexError("STORAGE_UNAVAILABLE");
    return revision;
  };
  const leadSources = (query: DirectorySearch) => {
    const leads: DirectoryPosition["lead"][] = [
      { kind: "facets", key: `${query.region ?? "*"}|${query.legalField ?? "*"}` },
    ];
    const chars = [...normalizeDirectoryText(query.name ?? "")];
    for (const i of new Set([0, Math.floor((chars.length - 1) / 2), chars.length - 2])) {
      if (chars.length) {
        const token =
          chars.length === 1
            ? `c:${chars[0]}`
            : `b:${chars[Math.max(0, i)]}${chars[Math.max(0, i) + 1]}`;
        if (!leads.some((l) => l.kind === "terms" && l.key === token))
          leads.push({ kind: "terms", key: token });
      }
    }
    return leads;
  };
  const sourceColumns = (lead: DirectoryPosition["lead"]) => ({
    table: lead.kind === "terms" ? "v2_directory_terms" : "v2_directory_facets",
    column: lead.kind === "terms" ? "token" : "facet",
  });
  const chooseLead = async (query: DirectorySearch) => {
    const leads = leadSources(query);
    // At most four capped samples. COUNT(*) would itself enumerate a large set.
    const counts = await Promise.all(
      leads.map(async (lead) => {
        const { table, column } = sourceColumns(lead);
        return (
          await core
            .statement(`SELECT profile_id FROM ${table} WHERE ${column}=? LIMIT 101`, [lead.key])
            .all()
        ).results.length;
      }),
    );
    return leads[counts.indexOf(Math.min(...counts))] ?? leads[0];
  };
  return {
    async page(raw: DirectorySearch, source?: DirectorySource) {
      const query = directorySearchSchema.parse(raw),
        now = clock(),
        day = usageDateKst(now);
      const name = normalizeDirectoryText(query.name ?? "");
      const queryHash = await runtimeDigest({
        name,
        region: query.region ?? null,
        legalField: query.legalField ?? null,
        limit: query.limit,
        source: source ?? null,
      });
      const pivot = (await runtimeDigest(`directory-daily-pivot-v1:${day}`)).slice(0, 16);
      const currentEpoch = await epoch();
      let position: DirectoryPosition;
      if (query.cursor) {
        position = await codec.open(query.cursor);
        if (
          position.queryHash !== queryHash ||
          position.day !== day ||
          position.pivot !== pivot ||
          position.epoch !== currentEpoch ||
          Date.parse(position.expiresAt) <= Date.parse(now) ||
          !leadSources(query).some(
            (l) => l.kind === position.lead.kind && l.key === position.lead.key,
          )
        )
          throw new DirectoryIndexError("CURSOR_EXPIRED");
      } else {
        const lead = await chooseLead(query);
        if (!lead) throw new DirectoryIndexError("STORAGE_UNAVAILABLE");
        const nextDay =
          (Math.floor((Date.parse(now) + 9 * 3600000) / 86400000) + 1) * 86400000 - 9 * 3600000;
        position = {
          queryHash,
          day,
          pivot,
          epoch: currentEpoch,
          phase: 0,
          after: null,
          expiresAt: new Date(
            Math.min(Date.parse(now) + DIRECTORY_PAGE_TTL_MS, nextDay),
          ).toISOString(),
          viewId: crypto.randomUUID(),
          lead,
        };
      }
      const chosen: Entry[] = [];
      let scanned = 0,
        more = true;
      while (scanned < DIRECTORY_CANDIDATE_LIMIT && chosen.length < query.limit && more) {
        const budget = Math.min(
          DIRECTORY_CANDIDATE_LIMIT - scanned,
          Math.max(20, query.limit - chosen.length),
        );
        const { table, column } = sourceColumns(position.lead);
        const rows = (
          await core
            .statement(
              `SELECT profile_id,sort_key FROM ${table} WHERE ${column}=? AND sort_key${position.phase === 0 ? ">=" : "<"}? ${position.after ? "AND (sort_key,profile_id)>(?,?)" : ""} ORDER BY sort_key,profile_id LIMIT ?`,
              [position.lead.key, pivot, ...(position.after ?? []), budget + 1],
            )
            .all<Candidate>()
        ).results;
        const window = rows.slice(0, budget);
        const entries = window.length
          ? (
              await core
                .statement(
                  `SELECT d.profile_id,d.sort_key,d.source,d.source_id,d.revision,d.public_json,d.normalized_name,d.normalized_office,d.region FROM v2_directory_entries d INDEXED BY sqlite_autoindex_v2_directory_entries_1 WHERE d.profile_id IN (SELECT value FROM json_each(?)) AND ${directoryEligibleSql()}`,
                  [JSON.stringify(window.map((r) => r.profile_id))],
                )
                .all<Entry>()
            ).results
          : [];
        const indexed = new Map(entries.map((r) => [r.profile_id, r]));
        let consumed = 0;
        for (const candidate of window) {
          consumed++;
          scanned++;
          position.after = [candidate.sort_key, candidate.profile_id];
          const entry = indexed.get(candidate.profile_id);
          if (
            !entry ||
            entry.sort_key !== candidate.sort_key ||
            (source && entry.source !== source) ||
            (query.region && entry.region !== query.region) ||
            (name &&
              !entry.normalized_name.includes(name) &&
              !entry.normalized_office.includes(name))
          )
            continue;
          const item = directoryItemSchema.safeParse(JSON.parse(entry.public_json));
          if (
            !item.success ||
            item.data.id !== entry.profile_id ||
            item.data.revision !== entry.revision ||
            (query.legalField && !item.data.practiceAreas.includes(query.legalField))
          )
            continue;
          chosen.push(entry);
          if (chosen.length === query.limit) break;
        }
        if (consumed < window.length) break;
        if (rows.length > budget) {
          if (chosen.length >= query.limit || scanned >= DIRECTORY_CANDIDATE_LIMIT) break;
          continue;
        }
        if (position.phase === 0) {
          position.phase = 1;
          position.after = null;
        } else more = false;
      }
      // Perform crypto before the final authorization read, so an awaited seal
      // never creates a withdrawal window after the last database fence.
      const nextCursor = more ? await codec.seal(position) : null;
      if (Date.parse(clock()) >= Date.parse(position.expiresAt))
        throw new DirectoryIndexError("CURSOR_EXPIRED");
      const tuples = JSON.stringify(chosen.map((r) => [r.profile_id, r.source_id, r.revision]));
      const final = (
        await core
          .statement(
            `SELECT epoch.revision AS epoch,d.profile_id,d.source_id,d.revision,d.public_json FROM v2_directory_epoch epoch LEFT JOIN v2_directory_entries d INDEXED BY sqlite_autoindex_v2_directory_entries_1 ON d.profile_id IN (SELECT json_extract(value,'$[0]') FROM json_each(?)) AND EXISTS(SELECT 1 FROM json_each(?) wanted WHERE json_extract(wanted.value,'$[0]')=d.profile_id AND json_extract(wanted.value,'$[1]')=d.source_id AND json_extract(wanted.value,'$[2]')=d.revision) AND ${directoryEligibleSql()} WHERE epoch.id=1 AND epoch.revision=?`,
            [tuples, tuples, currentEpoch],
          )
          .all<{
            epoch: number;
            profile_id: string | null;
            source_id: string | null;
            revision: number | null;
            public_json: string | null;
          }>()
      ).results;
      if (!final.length) throw new DirectoryIndexError("CURSOR_EXPIRED");
      const current = new Map(final.map((r) => [r.profile_id, r]));
      const items: DirectoryItem[] = chosen.flatMap((r) =>
        current.get(r.profile_id)?.public_json === r.public_json
          ? [directoryItemSchema.parse(JSON.parse(r.public_json))]
          : [],
      );
      return {
        items,
        nextCursor,
        expiresAt: position.expiresAt,
        rotation: { day, algorithm: "daily_sha256_pivot_v1" as const },
        viewId: position.viewId,
        epoch: currentEpoch,
        entries: chosen.filter((r) => items.some((i) => i.id === r.profile_id)),
      };
    },
    async photo(id: string, revision: number) {
      const row = await core
        .statement(
          `SELECT d.photo_data,d.source_id FROM v2_directory_entries d INDEXED BY sqlite_autoindex_v2_directory_entries_1 WHERE d.profile_id=? AND d.revision=? AND d.photo_data IS NOT NULL AND ${directoryEligibleSql()}`,
          [id, revision],
        )
        .first<{ photo_data: string; source_id: string }>();
      if (!row) return null;
      const bytes = Uint8Array.from(atob(row.photo_data.split(",")[1] ?? ""), (c) =>
        c.charCodeAt(0),
      );
      const final = await core
        .statement(
          `SELECT d.profile_id FROM v2_directory_entries d INDEXED BY sqlite_autoindex_v2_directory_entries_1 WHERE d.profile_id=? AND d.revision=? AND d.source_id=? AND d.photo_data=? AND ${directoryEligibleSql()}`,
          [id, revision, row.source_id, row.photo_data],
        )
        .first();
      return final ? bytes : null;
    },
  };
}

/** Compatibility DTO hydration may await bounded public snapshot reads. Fence it
 * again after hydration; the new card API needs no such extra work. */
export async function recheckDirectoryPage(
  core: V2Core,
  page: { epoch: number; entries: Entry[] },
) {
  const rows = (
    await core
      .statement(
        `SELECT d.profile_id,d.source_id,d.revision FROM v2_directory_entries d INDEXED BY sqlite_autoindex_v2_directory_entries_1 JOIN v2_directory_epoch epoch ON epoch.id=1 AND epoch.revision=? WHERE d.profile_id IN (SELECT value FROM json_each(?)) AND ${directoryEligibleSql()}`,
        [page.epoch, JSON.stringify(page.entries.map((e) => e.profile_id))],
      )
      .all<{ profile_id: string; source_id: string; revision: number }>()
  ).results;
  return new Set(
    rows
      .filter((r) =>
        page.entries.some(
          (e) =>
            e.profile_id === r.profile_id &&
            e.source_id === r.source_id &&
            e.revision === r.revision,
        ),
      )
      .map((r) => r.profile_id),
  );
}
