import { z } from "zod";
import { type AnalyticsEvent, analyticsEventSchema } from "../../../contracts/analytics";
import {
  createAnalyticsSdk,
  durationBucket,
  resultVisibilityTracker,
  syntheticAnalyticsAdapter,
} from "./sdk";

const storageKey = "baro.optional-analytics.v1";
const sessionSchema = z.strictObject({
  salt: z.string().uuid(),
  anonymousUserId: z.string().uuid(),
  sessionId: z.string().uuid(),
  startedAt: z.string().datetime(),
  environment: z.enum(["local", "preview", "production"]),
  flowId: z.string().uuid().nullable(),
  cases: z.record(
    z.string().regex(/^[a-f0-9]{64}$/),
    z.strictObject({
      flowId: z.string().uuid(),
      analysisHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      createdAt: z.string().datetime(),
      createdSession: z.string().uuid().nullable(),
    }),
  ),
  events: z.array(analyticsEventSchema).max(500),
});
type Session = z.infer<typeof sessionSchema>;
let session: Session | null = null,
  environment: AnalyticsEvent["environment"] = "local",
  release = "local";
const collector = syntheticAnalyticsAdapter();
const sdk = createAnalyticsSdk({
  async send(event) {
    await collector.send(event);
    if (session) {
      session.events = collector.events();
      save();
    }
  },
  clear() {
    collector.clear();
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
  },
});
function save() {
  if (session)
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(session));
    } catch {
      /* Optional storage must never block the case flow. */
    }
}
export function configureAnalytics(config: {
  environment: AnalyticsEvent["environment"];
  release: string;
}) {
  environment = config.environment;
  release = /^(local|[a-f0-9]{7,40})$/.test(config.release) ? config.release : "local";
  if (session || typeof window === "undefined") return;
  try {
    const value = sessionStorage.getItem(storageKey);
    if (value) {
      const stored = sessionSchema.safeParse(JSON.parse(value));
      if (stored.success && stored.data.environment === environment) {
        session = stored.data;
        sdk.optIn();
        for (const event of session.events) void sdk.track(event);
      } else sessionStorage.removeItem(storageKey);
    }
  } catch {
    /* Malformed/disabled optional storage stays declined. */
  }
}
export function analyticsOptIn() {
  if (typeof window === "undefined") return;
  if (!session) {
    session = {
      salt: crypto.randomUUID(),
      anonymousUserId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      environment,
      flowId: null,
      cases: {},
      events: [],
    };
    sdk.optIn();
    save();
  }
  window.dispatchEvent(new Event("baro-analytics-change"));
}
export function analyticsOptOut() {
  session = null;
  sdk.optOut();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("baro-analytics-change"));
}
export function analyticsOptedIn() {
  return sdk.isOptedIn();
}
async function hashId(id: string) {
  if (!session) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`BARO analytics ${environment} ${session.salt}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function emit(
  name: AnalyticsEvent["name"],
  flowId: string,
  properties: Record<string, unknown> = {},
) {
  if (!session || !sdk.isOptedIn()) return false;
  const epoch = session;
  const event = {
    name,
    eventId: crypto.randomUUID(),
    flowId,
    eventVersion: "1",
    occurredAt: new Date().toISOString(),
    environment,
    release,
    anonymousUserId: session.anonymousUserId,
    sessionId: session.sessionId,
    ...properties,
  };
  if (session !== epoch) return false;
  return sdk.track(event);
}
export async function beginInput() {
  if (!session) return;
  session.flowId = crypto.randomUUID();
  save();
  await emit("case_input_viewed", session.flowId, {
    entryPoint: "direct",
    deviceClass: innerWidth < 600 ? "mobile" : innerWidth < 1000 ? "tablet" : "desktop",
  });
}
export async function admittedCase(caseId: string, analysisId: string, length: number) {
  const epoch = session;
  if (!epoch) return;
  const caseHash = await hashId(caseId),
    analysisHash = await hashId(analysisId);
  if (!caseHash || !analysisHash || session !== epoch) return;
  const flowId = epoch.flowId ?? crypto.randomUUID();
  epoch.cases[caseHash] = {
    flowId,
    analysisHash,
    createdAt: new Date().toISOString(),
    createdSession: epoch.sessionId,
  };
  save();
  await emit("case_submitted", flowId, {
    caseIdHash: caseHash,
    analysisIdHash: analysisHash,
    narrativeLengthBucket: length <= 100 ? "20_100" : length <= 1000 ? "101_1000" : "1001_5000",
  });
}
export async function noteExistingCase(caseId: string, createdAt: string) {
  const epoch = session;
  if (!epoch) return;
  const caseHash = await hashId(caseId);
  if (!caseHash || session !== epoch || epoch.cases[caseHash]) return;
  epoch.cases[caseHash] = { flowId: crypto.randomUUID(), createdAt, createdSession: null };
  save();
}
export async function trackCase(
  name: AnalyticsEvent["name"],
  caseId: string,
  analysisId: string,
  properties: Record<string, unknown> = {},
) {
  const epoch = session;
  if (!epoch) return false;
  const caseHash = await hashId(caseId),
    actualHash = await hashId(analysisId);
  if (!caseHash || !actualHash || session !== epoch) return false;
  const entry = epoch.cases[caseHash] ?? {
    flowId: crypto.randomUUID(),
    analysisHash: actualHash,
    createdAt: new Date().toISOString(),
    createdSession: null,
  };
  entry.analysisHash ??= actualHash;
  epoch.cases[caseHash] = entry;
  save();
  if(name==="result_viewed"){
    const first=epoch.events.filter(e=>e.name==="case_input_viewed"&&e.flowId===entry.flowId).sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt))[0];
    if(first)properties.durationBucket=durationBucket(Date.now()-Date.parse(first.occurredAt));
    if(entry.createdSession!==epoch.sessionId&&Date.parse(entry.createdAt)<Date.parse(epoch.startedAt)){
      const days=Math.max(0,Math.floor((Date.now()-Date.parse(entry.createdAt))/86400000));
      void emit("case_revisited",entry.flowId,{caseIdHash:caseHash,analysisIdHash:entry.analysisHash,daysSinceCreationBucket:days===0?"same_day":days<=7?"1_7":days<=30?"8_30":"over_30"});
    }
  }
  // Revision analyses share the original admission identity for a coherent denominator.
  return emit(name, entry.flowId, {
    caseIdHash: caseHash,
    analysisIdHash: entry.analysisHash,
    ...properties,
  });
}
export function observeResult(
  element: HTMLElement,
  caseId: string,
  analysisId: string,
  citationCount: number,
) {
  let ratio = 0,
    timer: ReturnType<typeof setInterval> | undefined;
  const tracker = resultVisibilityTracker(() => {
    void trackCase("result_viewed", caseId, analysisId, {citationCount});
  });
  function tick() {
    tracker.observe(ratio, !document.hidden && analyticsOptedIn(), performance.now());
  }
  const observer = new IntersectionObserver(
    (entries) => {
      ratio = entries[0]?.intersectionRatio ?? 0;
      tick();
    },
    { threshold: [0, 0.5, 1] },
  );
  observer.observe(element);
  timer = setInterval(tick, 100);
  const visibility = () => tick();
  document.addEventListener("visibilitychange", visibility);
  return () => {
    observer.disconnect();
    if (timer) clearInterval(timer);
    document.removeEventListener("visibilitychange", visibility);
  };
}
