import type { z } from "zod";
import { type V2Fact, type V2Summary, v2FactSchema, v2SummarySchema } from "../../contracts/v2";
import { type Actor, fragmentText, type V2Core } from "./v2-core";

/** Chat additions share the current summary revision; workspace revision fences reads. */
export async function* summaryAdditions(
  core: V2Core,
  actor: Actor,
  workspaceId: string,
  revision: number,
  kind: "facts" | "parties",
) {
  const table = kind === "facts" ? "v2_facts" : "v2_parties";
  let after = "";
  while (true) {
    const rows = (
      await core
        .statement(
          `SELECT id,revision,encrypted_payload FROM ${table} WHERE workspace_id=? AND summary_revision=? AND snapshot_id IS NULL AND id>? ORDER BY id LIMIT 4`,
          [workspaceId, revision, after],
        )
        .all<{ id: string; revision: number; encrypted_payload: string }>()
    ).results;
    for (const row of rows) {
      yield await core.decrypt(
        table,
        row.id,
        actor.ownerId,
        row.revision,
        row.encrypted_payload,
        (kind === "facts" ? v2FactSchema : v2SummarySchema.shape.parties.element) as z.ZodType<
          V2Fact | V2Summary["parties"][number]
        >,
      );
      after = row.id;
    }
    if (rows.length < 4) return;
  }
}

/** Insert persisted chat additions without materializing an arbitrarily large snapshot. */
export async function* appendSummaryEntities(
  source: AsyncIterable<{ text: string; complete: boolean }>,
  additions: (kind: "facts" | "parties") => AsyncIterable<unknown>,
) {
  let depth = 0,
    quoted = false,
    escaped = false,
    key = "",
    field = "";
  let mode: "key" | "colon" | "value" = "key";
  let index = 0;
  const seen = new Set<string>();
  let entity = "";
  let target: "facts" | "parties" | null = null,
    populated = false;
  for await (const part of source) {
    let output = "";
    for (const ch of part.text) {
      if (!quoted && ch === "]" && depth === 2 && target) {
        for await (const value of additions(target)) {
          if (value && typeof value === "object" && "id" in value && seen.has(String(value.id)))
            continue;
          if (output) {
            yield { index: index++, text: output, complete: false };
            output = "";
          }
          for (const text of fragmentText(`${populated ? "," : ""}${JSON.stringify(value)}`))
            yield { index: index++, text, complete: false };
          populated = true;
        }
        target = null;
      }
      if (target && depth === 2 && ch === "{" && !quoted) entity = "";
      if (target && (depth > 2 || (depth === 2 && ch === "{" && !quoted))) entity += ch;
      if (target && depth >= 2 && !/\s/.test(ch)) populated = true;
      output += ch;
      if (quoted) {
        if (depth === 1 && mode === "key") key += ch;
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') {
          quoted = false;
          if (depth === 1 && mode === "key") {
            field = JSON.parse(key);
            mode = "colon";
          }
        }
      } else if (ch === '"') {
        quoted = true;
        if (depth === 1 && mode === "key") key = '"';
      } else if (ch === "{" || ch === "[") {
        if (ch === "[" && depth === 1 && (field === "facts" || field === "parties")) {
          target = field;
          populated = false;
          seen.clear();
        }
        depth++;
      } else if (ch === "}" || ch === "]") {
        depth--;
        if (target && depth === 2 && entity) {
          seen.add(String(JSON.parse(entity).id));
          entity = "";
        }
      } else if (depth === 1 && ch === ":") mode = "value";
      else if (depth === 1 && ch === ",") mode = "key";
    }
    yield { index: index++, text: output, complete: part.complete };
  }
}
