import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const dirs = [
  "final-mock",
  "final-real",
  "final-real-long",
  "final-candidate",
  "final-slow",
  "final-delayed",
];
const quantile = (values, p = 0.5) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]
    : null;
};
const sum = (values) => values.reduce((a, b) => a + b, 0);
function interactions(events = []) {
  const values = new Map();
  for (const [i, e] of events.entries()) {
    const id = e.interactionId ?? e.id ?? i;
    values.set(id, Math.max(values.get(id) ?? 0, e.duration));
  }
  return [...values.values()];
}
function runMetrics(r) {
  const js = r.resources.filter((x) => x.type === "script"),
    api = r.requests.filter((x) => x.path.startsWith("/api/"));
  const groups = {};
  for (const request of api) {
    const path = request.path.replace(/\/cases\/[^/]+/, "/cases/:caseId");
    groups[path] = (groups[path] ?? 0) + 1;
  }
  return {
    run: r.run,
    jsDecodedBytes: sum(js.map((x) => x.decodedBytes)),
    jsInlineBytes: r.initial.htmlInlineJsBytes,
    jsResourceEncodedBytes: sum(
      r.initial.resources.filter((x) => /\.js$/.test(x.path)).map((x) => x.encodedBytes),
    ),
    totalRequests: r.requests.length,
    scriptRequests: js.length,
    apiRequests: api.length,
    apiPathGroups: groups,
    hydrationCompleteMs: Math.max(...r.initial.hydration.map((x) => x.at)),
    hydrators: r.initial.hydrationSpans,
    loadAndUiReadyMs: r.uiReadyAt,
    initialLongTaskCount: r.initial.longTasks.length,
    initialLongTaskTotalMs: sum(r.initial.longTasks.map((x) => x.duration)),
    initialLongTaskMaxMs: Math.max(0, ...r.initial.longTasks.map((x) => x.duration)),
    domNodes: r.initial.domNodes,
    inputInteractionDurationsMs: interactions(r.initial.input?.events),
    inputFramesMs: r.initial.input?.frames.map((x) => x.duration) ?? [],
    inputLongTaskCount: r.initial.input?.longTasks.length ?? 0,
    inputLongTaskTotalMs: sum(r.initial.input?.longTasks.map((x) => x.duration) ?? []),
    inputDateCalls: (r.initial.input?.dateFormat?.calls ?? 0) - r.initial.dateFormat.calls,
    inputDateTotalMs: (r.initial.input?.dateFormat?.duration ?? 0) - r.initial.dateFormat.duration,
    storageReads: r.initial.storage.filter((x) => x.method === "getItem").length,
    storageWrites: r.initial.storage.filter((x) => x.method === "setItem").length,
    fontBytes: sum(r.resources.filter((x) => x.type === "font").map((x) => x.decodedBytes)),
    cspViolationCount: r.initial.violations.length,
    pageErrors: r.errors,
  };
}
const evidence = { schemaVersion: 1, sha: null, conditions: null, series: {}, rawDigests: {} };
for (const dir of dirs) {
  let raw;
  try {
    raw = await readFile(`test-results/${dir}/raw.json`, "utf8");
  } catch {
    continue;
  }
  const source = JSON.parse(raw);
  evidence.sha ??= source.sha;
  evidence.conditions ??= source.device;
  if (source.sha !== evidence.sha) throw new Error("Mixed integration SHAs");
  evidence.rawDigests[dir] = createHash("sha256").update(raw).digest("hex");
  const series = {
    device: source.device,
    repeats: source.repeats,
    measuredAt: source.measuredAt,
    adapter: source.apiAdapter,
    apiDelayMs: source.apiDelayMs,
    scenarios: {},
  };
  for (const name of [...new Set(source.results.map((r) => r.scenario))]) {
    const runs = source.results.filter((r) => r.scenario === name).map(runMetrics),
      data = source.results.find((r) => r.scenario === name);
    const eventValues = runs.flatMap((r) => r.inputInteractionDurationsMs),
      frames = runs.flatMap((r) => r.inputFramesMs);
    series.scenarios[name] = {
      stateOverrides: data.state,
      n: runs.length,
      jsChunks: data.resources
        .filter((x) => x.type === "script")
        .map((x) => ({ path: x.path, bytes: x.decodedBytes })),
      summary: {
        jsDecodedBytes: runs[0].jsDecodedBytes,
        jsInlineBytes: runs[0].jsInlineBytes,
        jsEncodedBytes: runs[0].jsResourceEncodedBytes,
        totalRequests: quantile(runs.map((r) => r.totalRequests)),
        apiRequests: quantile(runs.map((r) => r.apiRequests)),
        hydrationCompleteMedianMs: quantile(runs.map((r) => r.hydrationCompleteMs)),
        hydrationCompleteP95Ms: quantile(
          runs.map((r) => r.hydrationCompleteMs),
          0.95,
        ),
        loadAndUiReadyMedianMs: quantile(runs.map((r) => r.loadAndUiReadyMs)),
        initialLongTaskCountMedian: quantile(runs.map((r) => r.initialLongTaskCount)),
        initialLongTaskTotalMedianMs: quantile(runs.map((r) => r.initialLongTaskTotalMs)),
        initialLongTaskMaxMs: Math.max(...runs.map((r) => r.initialLongTaskMaxMs)),
        inputInteractionSampleCount: eventValues.length,
        inputInteractionMedianMs: quantile(eventValues),
        inputInteractionP95Ms: quantile(eventValues, 0.95),
        inputTwoRafMedianMs: quantile(frames),
        inputTwoRafP95Ms: quantile(frames, 0.95),
        inputLongTaskCountMedian: quantile(runs.map((r) => r.inputLongTaskCount)),
        domNodes: runs[0].domNodes,
        fontBytes: runs[0].fontBytes,
      },
      runs,
    };
  }
  evidence.series[dir] = series;
}
evidence.refreshProbe = JSON.parse(await readFile("test-results/final-refresh/raw.json", "utf8"));
evidence.media = JSON.parse(await readFile("test-results/final-media/raw.json", "utf8"));
evidence.candidateValidation = JSON.parse(
  await readFile("test-results/final-candidate-check/raw.json", "utf8"),
);
evidence.candidateManifest = JSON.parse(
  await readFile(".wrangler/profile-formatter-build/candidate-manifest.json", "utf8"),
);
await mkdir("docs/quality/client-performance-2026-10-06", { recursive: true });
await writeFile(
  "docs/quality/client-performance-2026-10-06/results.json",
  JSON.stringify(evidence, (_key, value) =>
    typeof value === "number" ? Math.round(value * 10) / 10 : value,
  ),
);
for (const [series, data] of Object.entries(evidence.series))
  for (const [scenario, value] of Object.entries(data.scenarios))
    console.log(JSON.stringify({ series, scenario, ...value.summary }));
