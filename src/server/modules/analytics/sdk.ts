import { type AnalyticsEvent, analyticsEventSchema } from "../../../contracts/analytics";
export interface AnalyticsAdapter {
  send(event: AnalyticsEvent): Promise<void>;
  clear(): void;
}
/** Bounded, consent-scoped synthetic collector. No provider/network is implied. */
export function syntheticAnalyticsAdapter() {
  const events = new Map<string, AnalyticsEvent>();
  return {
    async send(value: AnalyticsEvent) {
      const event = analyticsEventSchema.parse(value);
      if (!events.has(event.eventId) && events.size < 500) events.set(event.eventId, event);
    },
    clear() {
      events.clear();
    },
    events() {
      return [...events.values()];
    },
  };
}
export function createAnalyticsSdk(adapter: AnalyticsAdapter) {
  let optedIn = false,
    generation = 0;
  const sent = new Set<string>(),
    viewed = new Set<string>();
  return {
    optIn() {
      optedIn = true;
    },
    optOut() {
      optedIn = false;
      generation++;
      sent.clear();
      viewed.clear();
      adapter.clear();
    },
    isOptedIn() {
      return optedIn;
    },
    async track(value: unknown) {
      if (!optedIn) return false;
      const parsed = analyticsEventSchema.safeParse(value);
      if (!parsed.success || sent.has(parsed.data.eventId)) return false;
      const event = parsed.data;
      if (event.name === "result_viewed" && viewed.has(event.analysisIdHash)) return false;
      if (sent.size >= 500) return false;
      const epoch = generation;
      sent.add(event.eventId);
      if (event.name === "result_viewed") viewed.add(event.analysisIdHash);
      try {
        await adapter.send(event);
        if (!optedIn || epoch !== generation) {
          adapter.clear();
          return false;
        }
        return true;
      } catch {
        sent.delete(event.eventId);
        if (event.name === "result_viewed") viewed.delete(event.analysisIdHash);
        return false;
      }
    },
  };
}
export function resultVisibilityTracker(emit: () => void) {
  let started: number | null = null,
    done = false;
  return {
    observe(ratio: number, visible: boolean, now: number) {
      if (done) return false;
      if (!visible || ratio < 0.5) {
        started = null;
        return false;
      }
      if (started === null) started = now;
      if (now - started >= 1000) {
        done = true;
        emit();
        return true;
      }
      return false;
    },
  };
}
export function durationBucket(milliseconds: number): AnalyticsEvent["durationBucket"] {
  return milliseconds < 60000
    ? "under_1m"
    : milliseconds < 180000
      ? "under_3m"
      : milliseconds < 300000
        ? "under_5m"
        : milliseconds < 600000
          ? "under_10m"
          : "over_10m";
}
/** Local/preview/QA are excluded. Missing observations are unknown, never fabricated zero. */
export function aggregateMetrics(
  values: readonly unknown[],
  collectionAvailable: boolean,
  excludedUsers: ReadonlySet<string> = new Set(),
) {
  const dedup = new Map<string, AnalyticsEvent>();
  for (const value of values) {
    const parsed = analyticsEventSchema.safeParse(value);
    if (
      parsed.success &&
      parsed.data.environment === "production" &&
      !excludedUsers.has(parsed.data.anonymousUserId)
    )
      dedup.set(parsed.data.eventId, parsed.data);
  }
  const events = [...dedup.values()];
  const distinct = (name: AnalyticsEvent["name"], field: "anonymousUserId" | "analysisIdHash") =>
    new Set(
      events
        .filter((e) => e.name === name)
        .map((e) => e[field])
        .filter((v): v is string => !!v),
    );
  const ratio = (n: number, d: number) => (collectionAvailable && d > 0 ? n / d : null);
  const admitted = distinct("case_submitted", "analysisIdHash"),
    viewed = distinct("result_viewed", "analysisIdHash");
  const viewedAdmitted = new Set([...viewed].filter((id) => admitted.has(id))),
    acted = new Set(
      events
        .filter(
          (e) =>
            ["evidence_checked", "citation_opened"].includes(e.name) &&
            e.analysisIdHash &&
            viewed.has(e.analysisIdHash),
        )
        .map((e) => e.analysisIdHash),
    );
  const trust = events.filter((e) => e.name === "trust_answered");
  const elapsed: number[] = [];
  for (const view of events.filter((e) => e.name === "result_viewed")) {
    const start = events
      .filter(
        (e) =>
          e.name === "case_input_viewed" &&
          e.flowId === view.flowId &&
          e.anonymousUserId === view.anonymousUserId,
      )
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))[0];
    if (start && Date.parse(view.occurredAt) >= Date.parse(start.occurredAt))
      elapsed.push(Date.parse(view.occurredAt) - Date.parse(start.occurredAt));
  }
  elapsed.sort((a, b) => a - b);
  return {
    cohort: collectionAvailable ? "opt_in" : "unknown",
    events: events.length,
    admissions: admitted.size,
    views: viewedAdmitted.size,
    inputUsers: distinct("case_input_viewed", "anonymousUserId").size,
    activationRate: ratio(
      distinct("case_submitted", "anonymousUserId").size,
      distinct("case_input_viewed", "anonymousUserId").size,
    ),
    analysisViewRate: ratio(viewedAdmitted.size, admitted.size),
    actionRate: ratio(acted.size, viewed.size),
    helpfulRate: ratio(
      trust.filter((e) => e.name === "trust_answered" && e.helpful === "yes").length,
      trust.length,
    ),
    completionP75Ms:
      collectionAvailable && elapsed.length
        ? (elapsed[Math.ceil(elapsed.length * 0.75) - 1] ?? null)
        : null,
    durationObservations: elapsed.length,
    period: events.length
      ? {
          from: events.map((e) => e.occurredAt).sort()[0],
          to: events
            .map((e) => e.occurredAt)
            .sort()
            .at(-1),
        }
      : null,
  };
}
