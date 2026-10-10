import type { TimelineView } from "../../client/api/types";

/** Do not invent a missing month or day when changing precision. */
export function timelineDateInput(
  date: string,
  precision: NonNullable<TimelineView["datePrecision"]>,
  previous: TimelineView["datePrecision"],
): string {
  if (precision === "unknown") return "";
  if (precision === "year") return date.slice(0, 4);
  if (precision === "month")
    return previous !== "year" && previous !== "unknown" && date.length >= 7
      ? date.slice(0, 7)
      : "";
  return (previous ?? "day") === "day" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

export function timelineEventLength(
  entry: Pick<Partial<TimelineView>, "title" | "detail">,
): number {
  const title = (entry.title ?? "").trim();
  const detail = (entry.detail ?? "").trim();
  return [...(detail ? `${title}\n${detail}` : title)].length;
}
