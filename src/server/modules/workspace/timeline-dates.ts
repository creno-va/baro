import { dateSchema } from "../../../contracts";
import type { V2FactReference, V2TimelineEntry } from "../../../contracts/v2";
import type { WorkspaceContext } from "./pipeline";

type DatedSource = { date: string; precision: "year" | "month" | "day" };
const rank = { unknown: 0, year: 1, month: 2, day: 3 } as const;

/** Only explicit calendar dates count. Relative dates and missing components are not inferred. */
function explicitDates(text: string): DatedSource[] {
  const dates: DatedSource[] = [];
  const add = (year: string, month?: string, day?: string) => {
    const date = `${year}-${(month ?? "1").padStart(2, "0")}-${(day ?? "1").padStart(2, "0")}`;
    if (dateSchema.safeParse(date).success)
      dates.push({ date, precision: day ? "day" : month ? "month" : "year" });
  };
  for (const match of text.matchAll(
    /(?<!\d)(\d{4})\s*년(?:\s*(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일)?)?/g,
  ))
    add(match[1] ?? "", match[2], match[3]);
  for (const match of text.matchAll(
    /(?<!\d)(\d{4})\s*[-/.]\s*(\d{1,2})(?:\s*[-/.]\s*(\d{1,2}))?(?!\d)/g,
  ))
    add(match[1] ?? "", match[2], match[3]);
  return dates;
}

/** Downgrade unsupported generated precision before audit and atomic publication. */
export function normalizeTimelineDates(
  context: WorkspaceContext,
  timeline: V2TimelineEntry[],
  readSource: (ref: V2FactReference) => string | null,
) {
  let changed = false;
  const normalized = timeline.map((entry) => {
    if (!entry.date || entry.datePrecision === "unknown") return entry;
    const facts = context.facts.filter(
      (fact) =>
        entry.factIds.includes(fact.id) &&
        (fact.userEdited ||
          fact.attribution === "user_statement" ||
          fact.attribution === "user_material"),
    );
    const corrections = facts.filter((fact) => fact.userEdited);
    // An explicitly corrected fact cannot regain the date from its older source statement.
    const texts = entry.factIds.length
      ? (corrections.length ? corrections : facts).map((fact) => fact.text)
      : entry.references.flatMap((ref) => {
          const text = readSource(ref);
          if (text !== null) return [text];
          if (ref.kind === "official_source")
            return (
              context.sourceTexts
                ?.filter((source) => source.citationId === ref.citationId)
                .map((source) => source.text) ?? []
            );
          return [];
        });
    const dates = texts.flatMap(explicitDates);
    // Without a linked event fact, multiple dates cannot identify this event's date.
    const ambiguous =
      !entry.factIds.length &&
      new Set(dates.map((source) => `${source.date}/${source.precision}`)).size > 1;
    let supported = 0;
    for (const source of ambiguous ? [] : dates) {
      if (source.date.slice(0, 4) !== entry.date.slice(0, 4)) continue;
      let precision = 1;
      if (rank[source.precision] >= 2 && source.date.slice(0, 7) === entry.date.slice(0, 7)) {
        precision = 2;
        if (source.precision === "day" && source.date === entry.date) precision = 3;
      }
      supported = Math.max(supported, Math.min(precision, rank[entry.datePrecision]));
    }
    if (supported === rank[entry.datePrecision]) return entry;
    changed = true;
    return {
      ...entry,
      date:
        supported === 2
          ? `${entry.date.slice(0, 7)}-01`
          : supported === 1
            ? `${entry.date.slice(0, 4)}-01-01`
            : null,
      datePrecision:
        supported === 2
          ? ("month" as const)
          : supported === 1
            ? ("year" as const)
            : ("unknown" as const),
    };
  });
  return { timeline: normalized, changed };
}
