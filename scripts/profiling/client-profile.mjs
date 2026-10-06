import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, release, totalmem } from "node:os";
import { chromium } from "@playwright/test";

// Tooling only. Local synthetic data; never import into a product island.
const base = process.env.PROFILE_URL ?? "http://127.0.0.1:4351";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Local profiling only");
const output = process.env.PROFILE_OUTPUT ?? "test-results/client-profile";
const repeats = Number(process.env.PROFILE_REPEATS ?? 5);
const cpuRate = Number(process.env.PROFILE_CPU ?? 4);
const slow = process.env.PROFILE_NETWORK === "slow";
const only = process.env.PROFILE_ONLY?.split(",");
const now = "2026-10-06T00:00:00.000Z";
const caseId = "11111111-1111-4111-8111-111111111111";
const item = {
  id: caseId,
  title: "성능 측정 합성 사건",
  subjectContext: "individual",
  stage: "active",
  revision: 1,
  updatedAt: now,
  summary: "합성 사실관계입니다. ".repeat(20),
  schemaVersion: "2",
};
function syntheticState({
  cases = 20,
  messages = 20,
  lawyers = 20,
  role = "customer",
  portfolio = 0,
} = {}) {
  const owner = `example-${role}`;
  const state = {
    session: { user: { id: owner, name: "합성 이용자", accountType: role }, needsConsent: false },
    cases: {},
    caseOwners: {},
    workspace: {},
    files: {},
    reports: {},
    lawyers: { profiles: [], owners: {} },
  };
  for (let i = 0; i < cases; i++) {
    const id = i ? `22222222-2222-4222-8222-${String(i).padStart(12, "0")}` : caseId;
    state.cases[id] = { ...item, id, title: `합성 사건 ${i + 1}` };
    state.caseOwners[id] = owner;
  }
  state.workspace[caseId] = {
    messages: Array.from({ length: messages }, (_, i) => ({
      id: `message-${i}`,
      role: i % 2 ? "assistant" : "user",
      text: "이 내용은 실제 사건이 아닌 입력 반응 측정용 합성 대화입니다. ".repeat(8),
      status: "complete",
      createdAt: now,
    })),
    actions: [],
    timeline: [],
  };
  state.files[caseId] = [];
  state.reports[caseId] = {
    id: "profile-report",
    caseId,
    revision: 1,
    title: "합성 리포트",
    content: "합성 리포트의 사실관계와 확인할 질문입니다. ".repeat(100),
    updatedAt: now,
    stale: false,
    excludedFileIds: [],
    maskIdentifiers: false,
  };
  for (let i = 0; i < lawyers; i++) {
    const id = `lawyer-${i}`;
    state.lawyers.profiles.push({
      id,
      revision: 1,
      name: `합성 변호사 ${i}`,
      introduction: "성능 측정용 합성 프로필입니다.",
      officeName: "합성 사무실",
      address: "서울특별시 서초구",
      region: "seoul",
      practiceAreas: ["civil"],
      phone: "",
      email: "synthetic@example.invalid",
      website: "",
      photoUrl: null,
      portfolio: Array.from({ length: portfolio }, (_, n) => ({
        id: `portfolio-${n}`,
        title: `합성 포트폴리오 ${n}`,
        url: "https://example.com",
      })),
      published: true,
      verificationStatus: "self_declared",
    });
  }
  if (role === "lawyer") state.lawyers.owners[owner] = "lawyer-0";
  return state;
}
function observe({ state, loggedOut, candidate, dateProbe }) {
  if (!sessionStorage.getItem("profile-seeded")) {
    for (const [key, value] of Object.entries(state))
      localStorage.setItem(`baro-api-mock-v1:${key}`, JSON.stringify(value));
    if (loggedOut) localStorage.removeItem("baro-api-mock-v1:session");
    sessionStorage.setItem("profile-seeded", "true");
  }
  const p = {
    hydration: [],
    hydrationSpans: [],
    longTasks: [],
    events: [],
    inputFrames: [],
    storage: [],
    fetches: [],
    violations: [],
    dateFormat: { calls: 0, duration: 0 },
  };
  window.__profile = p;
  const originalTime = Date.prototype.toLocaleTimeString;
  const formatter = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" });
  Date.prototype.toLocaleTimeString = function (locale, options) {
    if (
      locale !== "ko-KR" ||
      options?.hour !== "2-digit" ||
      options?.minute !== "2-digit" ||
      Object.keys(options).length !== 2
    )
      return originalTime.call(this, locale, options);
    const begin = performance.now();
    try {
      return candidate === "formatter"
        ? formatter.format(this)
        : originalTime.call(this, locale, options);
    } finally {
      p.dateFormat.calls++;
      p.dateFormat.duration += performance.now() - begin;
    }
  };
  if (dateProbe === false) Date.prototype.toLocaleTimeString = originalTime;
  document.addEventListener(
    "astro:hydrate",
    (e) =>
      p.hydration.push({
        component: e.target.getAttribute("component-export"),
        at: performance.now(),
      }),
    true,
  );
  const define = customElements.define.bind(customElements);
  customElements.define = (name, ctor, options) => {
    if (name === "astro-island") {
      const start = ctor.prototype.start;
      ctor.prototype.start = function (...args) {
        if (!this.__profileWrapped) {
          this.__profileWrapped = true;
          const hydrate = this.hydrate;
          this.hydrate = async (...params) => {
            const begin = performance.now();
            try {
              return await hydrate(...params);
            } finally {
              p.hydrationSpans.push({
                component: this.getAttribute("component-export"),
                begin,
                duration: performance.now() - begin,
              });
            }
          };
        }
        return start.apply(this, args);
      };
    }
    return define(name, ctor, options);
  };
  new PerformanceObserver((list) =>
    p.longTasks.push(
      ...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })),
    ),
  ).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((list) =>
    p.events.push(
      ...list
        .getEntries()
        .filter((e) => e.interactionId)
        .map((e) => ({
          interactionId: e.interactionId,
          name: e.name,
          start: e.startTime,
          duration: e.duration,
          processing: e.processingEnd - e.processingStart,
          delay: e.processingStart - e.startTime,
        })),
    ),
  ).observe({ type: "event", buffered: true, durationThreshold: 16 });
  document.addEventListener(
    "input",
    () => {
      const t = performance.now();
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          p.inputFrames.push({ start: t, duration: performance.now() - t }),
        ),
      );
    },
    true,
  );
  document.addEventListener("securitypolicyviolation", (e) =>
    p.violations.push({ directive: e.violatedDirective, blocked: e.blockedURI }),
  );
  for (const method of ["getItem", "setItem"]) {
    const original = Storage.prototype[method];
    Storage.prototype[method] = function (...args) {
      const t = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        if (String(args[0]).startsWith("baro-api-mock"))
          p.storage.push({
            method,
            namespace: String(args[0]).split(":")[1],
            at: t,
            duration: performance.now() - t,
            chars: method === "setItem" ? String(args[1]).length : null,
          });
      }
    };
  }
  const fetch = window.fetch;
  window.fetch = (...args) => {
    p.fetches.push({
      path: new URL(typeof args[0] === "string" ? args[0] : args[0].url, location.href).pathname,
      at: performance.now(),
    });
    return fetch(...args);
  };
}

async function syntheticHttp(page, state) {
  const delay = Number(process.env.PROFILE_API_DELAY ?? 0);
  const ws = (id) => ({
    schemaVersion: "2",
    id,
    title: "사건 작업 공간",
    subjectContext: "individual",
    jurisdiction: "KR",
    status: "active",
    archivedFrom: null,
    workspaceRevision: 1,
    intakeRevision: 1,
    confirmedSummaryRevision: 1,
    currentJobId: null,
    legacySnapshotId: null,
    createdAt: now,
    updatedAt: now,
  });
  const cases = Object.keys(state.cases);
  await page.route("**/api/**", async (route) => {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const url = new URL(route.request().url()),
      path = url.pathname;
    let json;
    if (path === "/api/me/session") json = state.session;
    else if (path === "/api/cases") json = { items: [], nextCursor: null };
    else if (path === "/api/v2/cases") {
      const start = Number(url.searchParams.get("before") ?? 0);
      const ids = cases.slice(start, start + 50);
      json = {
        items: ids.map(ws),
        nextCursor: start + 50 < cases.length ? String(start + 50) : null,
      };
    } else if (path.endsWith("/intake")) {
      const id = path.split("/")[4];
      json = {
        schemaVersion: "2",
        revision: 1,
        status: "confirmed",
        narrative: state.cases[id]?.title ?? "합성 사건",
        batches: [],
        confirmedSummaryRevision: 1,
        currentJobId: null,
        summary: null,
      };
    } else if (path.endsWith("/workspace")) json = ws(path.split("/")[4]);
    else if (path.endsWith("/files")) json = [];
    else if (path.endsWith("/actions") || path.endsWith("/timeline"))
      json = { items: [], nextCursor: null };
    else if (path.endsWith("/messages")) {
      const start = Number(url.searchParams.get("before") ?? 0);
      const values = state.workspace[caseId].messages;
      json = {
        items: values.slice(start, start + 50).map((m, i) => ({
          schemaVersion: "2",
          id: m.id,
          operationId: `operation-${i}`,
          workspaceRevision: 1,
          createdAt: now,
          role: "user",
          text: m.text,
          selectedFileIds: [],
        })),
        nextCursor: start + 50 < values.length ? String(start + 50) : null,
      };
    } else if (path.endsWith("/reports")) json = state.reports[caseId];
    else if (path === "/api/v2/me/lawyer/self-profile") json = state.lawyers.profiles[0];
    else if (path === "/api/v2/lawyers")
      json = {
        schemaVersion: "2",
        snapshotId: "synthetic-snapshot",
        rotation: "disclosed_rotation",
        expiresAt: now,
        items: [],
        nextCursor: null,
      };
    else if (path === "/api/v2/lawyers/self-service") {
      const start = Number(url.searchParams.get("cursor") ?? 0),
        values = state.lawyers.profiles;
      json = {
        items: values.slice(start, start + 50),
        nextCursor: start + 50 < values.length ? String(start + 50) : null,
      };
    } else throw new Error(`Unconfigured synthetic route: ${path}`);
    await route.fulfill({ json });
  });
}

const scenarios = [
  { name: "login", route: "/login", loggedOut: true, ready: "button", state: {} },
  { name: "cases-20", route: "/cases", ready: ".intake-case-card", state: {} },
  {
    name: "workspace-20",
    route: `/cases/${caseId}`,
    ready: "#workspace-message",
    input: "#workspace-message",
    state: {},
  },
  {
    name: "reports",
    route: `/cases/${caseId}/reports`,
    ready: ".report-review textarea",
    state: {},
  },
  {
    name: "lawyer",
    route: "/lawyer",
    ready: ".lawyer-editor input",
    state: { role: "lawyer", lawyers: 1, portfolio: 20 },
  },
  {
    name: "lawyers-20",
    route: "/lawyers",
    ready: 'a[href^="/lawyers/lawyer-"]',
    input: 'input[maxlength="100"]',
    state: {},
  },
  { name: "cases-1000", route: "/cases", ready: ".intake-case-card", state: { cases: 1000 } },
  {
    name: "workspace-1000",
    route: `/cases/${caseId}`,
    ready: "#workspace-message",
    input: "#workspace-message",
    state: { messages: 1000 },
  },
  {
    name: "lawyers-1000",
    route: "/lawyers",
    ready: 'a[href^="/lawyers/lawyer-"]',
    input: 'input[maxlength="100"]',
    state: { lawyers: 1000 },
  },
];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const result = {
  sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  measuredAt: new Date().toISOString(),
  device: {
    cpu: cpus()[0].model,
    logicalCores: cpus().length,
    memoryBytes: totalmem(),
    platform: platform(),
    release: release(),
    browser: browser.version(),
    viewport: { width: 1365, height: 900 },
    cpuRate,
    network: slow
      ? { latency: 150, downloadBytesPerSec: 200000, uploadBytesPerSec: 93750 }
      : "unthrottled loopback",
    cache: "new context + CDP cache disabled per repetition",
  },
  repeats,
  apiAdapter:
    process.env.PROFILE_WIRE === "true" ? "real client + synthetic HTTP" : "product API mock",
  apiDelayMs: Number(process.env.PROFILE_API_DELAY ?? 0),
  dateProbe: process.env.PROFILE_DATE_PROBE !== "off",
  results: [],
};
try {
  for (const scenario of scenarios.filter((s) => !only || only.includes(s.name))) {
    for (let run = 0; run < repeats; run++) {
      const context = await browser.newContext({ viewport: result.device.viewport });
      await context.addInitScript(observe, {
        state: syntheticState(scenario.state),
        loggedOut: scenario.loggedOut,
        candidate: process.env.PROFILE_CANDIDATE,
        dateProbe: process.env.PROFILE_DATE_PROBE !== "off",
      });
      const page = await context.newPage();
      if (process.env.PROFILE_WIRE === "true")
        await syntheticHttp(page, syntheticState(scenario.state));
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
      if (slow)
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 150,
          downloadThroughput: 200000,
          uploadThroughput: 93750,
        });
      const resources = [],
        pending = [],
        requests = [];
      page.on("request", (r) =>
        requests.push({ path: new URL(r.url()).pathname, type: r.resourceType() }),
      );
      page.on("response", (response) =>
        pending.push(
          (async () => {
            const url = new URL(response.url());
            if (url.origin !== new URL(base).origin) return;
            const type = response.request().resourceType();
            const body = await response.body().catch(() => null);
            resources.push({
              path: url.pathname,
              type,
              status: response.status(),
              decodedBytes: body?.length ?? 0,
              encoding: response.headers()["content-encoding"] ?? "identity",
            });
          })(),
        ),
      );
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
      const t = Date.now();
      await page.goto(base + scenario.route);
      await page.locator(scenario.ready).first().waitFor({ timeout: 180000 });
      await page.waitForFunction(() =>
        [...document.querySelectorAll("astro-island")].every((e) => !e.hasAttribute("ssr")),
      );
      if (scenario.input) await page.locator(scenario.input).waitFor({ state: "visible" });
      const uiReadyAt = await page.evaluate(() => performance.now());
      await page.waitForTimeout(600);
      const initial = await page.evaluate(() => ({
        ...window.__profile,
        domNodes: document.querySelectorAll("*").length,
        readyAt: performance.now(),
        resources: performance.getEntriesByType("resource").map((e) => ({
          path: new URL(e.name).pathname,
          initiator: e.initiatorType,
          start: e.startTime,
          end: e.responseEnd,
          transferBytes: e.transferSize,
          encodedBytes: e.encodedBodySize,
          decodedBytes: e.decodedBodySize,
        })),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        htmlInlineJsBytes: [...document.scripts]
          .filter((s) => !s.src)
          .reduce((n, s) => n + new TextEncoder().encode(s.textContent).length, 0),
      }));
      if (scenario.input) {
        const locator = page.locator(scenario.input);
        await locator.focus();
        const start = await page.evaluate(() => performance.now());
        await locator.pressSequentially("synthetic input response 12345", { delay: 30 });
        await page.waitForTimeout(300);
        const input = await page.evaluate(
          (start) => ({
            start,
            dateFormat: window.__profile.dateFormat,
            events: window.__profile.events.filter((e) => e.start >= start),
            frames: window.__profile.inputFrames.filter((e) => e.start >= start),
            longTasks: window.__profile.longTasks.filter((e) => e.start >= start),
          }),
          start,
        );
        initial.input = input;
      }
      await Promise.all(pending);
      result.results.push({
        scenario: scenario.name,
        run: run + 1,
        state: scenario.state,
        uiReadyAt,
        requests,
        wallMs: Date.now() - t,
        candidate: process.env.PROFILE_CANDIDATE ?? "baseline",
        resources,
        errors,
        initial,
      });
      await writeFile(`${output}/raw.json`, JSON.stringify(result, null, 2));
      console.log(
        scenario.name +
          " " +
          (run + 1) +
          "/" +
          repeats +
          ": JS=" +
          resources.filter((r) => r.type === "script").reduce((n, r) => n + r.decodedBytes, 0) +
          " hydrate=" +
          Math.max(...initial.hydration.map((h) => h.at)).toFixed(0) +
          "ms long=" +
          initial.longTasks.length,
      );
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(`${output}/raw.json`, JSON.stringify(result, null, 2));
