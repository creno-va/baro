import type { V2Action, V2TimelineEntry } from "../../../contracts/v2";

const normalized = (text: string) => text.normalize("NFKC").replace(/\s+/gu, " ").trim();
type ExistingAction = Pick<V2Action, "kind" | "title" | "instructions" | "caution">;
type ExistingEvent = Pick<V2TimelineEntry, "date" | "datePrecision" | "event">;
const actionKey = (action: ExistingAction) =>
  JSON.stringify([
    action.kind,
    normalized(action.title),
    normalized(action.instructions),
    normalized(action.caution),
  ]);
const eventKey = (event: ExistingEvent) =>
  JSON.stringify([event.date, event.datePrecision, normalized(event.event)]);

/** Updates append supported additions; saved completion and manual edits stay intact. */
export function newPreparationEntries(
  actions: V2Action[],
  timeline: V2TimelineEntry[],
  existingActions: readonly ExistingAction[] = [],
  existingTimeline: readonly ExistingEvent[] = [],
) {
  const actionKeys = new Set(existingActions.map(actionKey));
  const eventKeys = new Set(existingTimeline.map(eventKey));
  return {
    actions: actions.filter((action) => {
      const key = actionKey(action);
      if (actionKeys.has(key)) return false;
      actionKeys.add(key);
      return true;
    }),
    timeline: timeline.filter((event) => {
      const key = eventKey(event);
      if (eventKeys.has(key)) return false;
      eventKeys.add(key);
      return true;
    }),
  };
}
