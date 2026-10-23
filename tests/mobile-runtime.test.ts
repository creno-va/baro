import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  DOWNLOAD_BYTES,
  OWNER_COOKIE,
  PROBE_OWNER,
  RUNTIME_ORIGIN,
  type RuntimeConfig,
  UPLOAD_BYTES,
} from "../apps/mobile/runtime-probe/protocol";
import { mobileBoundaryFindings } from "../scripts/mobile-boundaries";
import { productEntryOverlay } from "../scripts/mobile-runtime";
import { createRuntimeFixture, repeatedDigest } from "../scripts/mobile-runtime-fixture";
import {
  androidRuntimeOptions,
  emulatorStartupIssues,
  metroNodeOptions,
} from "../scripts/mobile-runtime-host";
import { runtimeReceiptSchema, verifyRuntimeReceipt } from "../scripts/mobile-runtime-receipt";

const config: RuntimeConfig = {
  version: 1,
  sourceSha: "a".repeat(40),
  nonce: "15a64c18-fd51-4f83-8205-4c917a245e6b",
  origin: RUNTIME_ORIGIN,
};
const fixture = createRuntimeFixture(config);
test("real Node localhost listener binds the IPv4 address used by native deep links", async () => {
  const node = Bun.which("node");
  if (!node) throw new Error("PINNED_NODE_REQUIRED");
  const child = Bun.spawn(
    [
      node,
      "--input-type=module",
      "-e",
      'import {createServer} from "node:net"; const s=createServer(); s.listen(0,"localhost",()=>{console.log(JSON.stringify(s.address()));s.close();});',
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_OPTIONS: metroNodeOptions("--dns-result-order=ipv6first") },
    },
  );
  const timeout = setTimeout(() => child.kill(), 3000);
  try {
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(JSON.parse(output)).toMatchObject({ address: "127.0.0.1", family: "IPv4" });
  } finally {
    clearTimeout(timeout);
  }
});
test("runtime AVD configuration is restricted to the fresh owned name and explicit host resources", () => {
  expect(androidRuntimeOptions("baro_runtime_012345abcdef")).toContain("2048");
  for (const name of ["personal-phone", "../other", "baro_runtime_012345abcdef -read-only"])
    expect(() => androidRuntimeOptions(name)).toThrow();
});
test("emulator diagnostic output contains fixed failure codes and excludes raw paths/tokens/stacks", () => {
  const input =
    "Not enough RAM; KVM permission denied; failed to initialize Vulkan; error while loading shared libraries; synthetic_token=private\n at /private/fixture/path";
  const classified = emulatorStartupIssues(input);
  expect(classified).toEqual([
    "RAM_UNAVAILABLE",
    "ACCELERATION_UNAVAILABLE",
    "GPU_INITIALIZATION_FAILED",
    "HOST_LIBRARY_MISSING",
  ]);
  expect(JSON.stringify(classified)).not.toContain("synthetic_token");
  expect(emulatorStartupIssues("unknown stack /private/fixture/path")).toEqual([]);
});
test("isolated probe public config replacement keeps Node/secret/dynamic environment reads forbidden", () => {
  const path = "apps/mobile/runtime-probe/run.ts";
  expect(
    mobileBoundaryFindings(
      path,
      "const sha=process.env.EXPO_PUBLIC_NATIVE_PROBE_SOURCE_SHA; const nonce=process.env.EXPO_PUBLIC_NATIVE_PROBE_NONCE;",
    ),
  ).toEqual([]);
  for (const source of [
    "process.env.SECRET",
    "process.env[key]",
    "process.version",
    "process.env.EXPO_PUBLIC_APP_ENV",
    'import fs from "node:fs"',
  ])
    expect(mobileBoundaryFindings(path, source).length).toBeGreaterThan(0);
  expect(
    mobileBoundaryFindings(
      "apps/mobile/src/app/index.tsx",
      "process.env.EXPO_PUBLIC_NATIVE_PROBE_NONCE",
    ).length,
  ).toBeGreaterThan(0);
});
const headers = {
  cookie: OWNER_COOKIE,
  origin: RUNTIME_ORIGIN,
  "x-baro-expected-owner": PROBE_OWNER,
};
const control = (path: string, body: unknown, nonce = config.nonce) =>
  new Request(`${RUNTIME_ORIGIN}/probe/${path}`, {
    method: "POST",
    headers: { "x-baro-probe-run": nonce, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("loopback fixture separates anonymous product boot, nonce control and exact owner native headers", async () => {
  expect(
    (await fixture.fetch(control("mounted", { width: 390, height: 700 }, "wrong"))).status,
  ).toBe(401);
  expect(fixture.state.productMount).toBeNull();
  expect((await fixture.fetch(new Request("https://outside.invalid/api/me/session"))).status).toBe(
    400,
  );
  const session = (await (
    await fixture.fetch(new Request(`${RUNTIME_ORIGIN}/api/me/session`))
  ).json()) as { user: null; needsConsent: boolean };
  expect(session).toEqual({ user: null, needsConsent: false });
  const denied = await fixture.fetch(
    new Request(`${RUNTIME_ORIGIN}/api/v2/cases/probe_case/files/unauthorized/content`, {
      headers: { ...headers, cookie: "wrong" },
    }),
  );
  expect(denied.status).toBe(401);
  expect((await fixture.fetch(control("mounted", { width: 390, height: 700 }))).status).toBe(200);
  expect(fixture.state.productMount).toEqual({ width: 390, height: 700 });
});

test("fixture computes complete streamed 100MB and 1GB hashes without allocating whole bodies", async () => {
  const chunk = new Uint8Array(65536).fill(97);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === UPLOAD_BYTES) {
        controller.close();
        return;
      }
      const next = chunk.subarray(0, Math.min(chunk.length, UPLOAD_BYTES - offset));
      offset += next.length;
      controller.enqueue(next);
    },
  });
  const uploaded = await fixture.fetch(
    new Request(`${RUNTIME_ORIGIN}/api/v2/me/lawyer/assets/upload/content`, {
      method: "PUT",
      headers: {
        ...headers,
        "content-type": "application/octet-stream",
        "content-length": String(UPLOAD_BYTES),
        "if-match": "1",
      },
      body,
    }),
  );
  expect(uploaded.status).toBe(200);
  expect(fixture.state.upload).toEqual({
    bytes: UPLOAD_BYTES,
    sha256: repeatedDigest(UPLOAD_BYTES),
  });
  const response = await fixture.fetch(
    new Request(`${RUNTIME_ORIGIN}/api/v2/cases/probe_case/files/download/content`, { headers }),
  );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("READER_REQUIRED");
  const hash = createHash("sha256");
  let received = 0,
    max = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    received += next.value.length;
    max = Math.max(max, next.value.length);
    hash.update(next.value);
  }
  expect(received).toBe(DOWNLOAD_BYTES);
  expect(max).toBe(65536);
  expect(hash.digest("hex")).toBe(fixture.largeHash);
  expect(fixture.state.downloadedBytes).toBe(DOWNLOAD_BYTES);
});

test("cancellation fixture stalls after the first received bytes, before consuming the whole upload", async () => {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(32768).fill(97));
    },
  });
  const pending = fixture.fetch(
    new Request(`${RUNTIME_ORIGIN}/api/v2/me/lawyer/assets/cancel/content`, {
      method: "PUT",
      headers: {
        ...headers,
        "content-type": "application/octet-stream",
        "content-length": String(UPLOAD_BYTES),
        "if-match": "1",
      },
      body,
    }),
  );
  for (let i = 0; i < 10 && !fixture.state.cancelUploadStarted; i++) await Promise.resolve();
  expect(fixture.state.cancelUploadStarted).toBe(true);
  expect(fixture.state.cancelUploadBytes).toBe(32768);
  fixture.release();
  expect((await pending).status).toBe(400);
});

const candidate = () => ({
  version: 1,
  kind: "local-development-runtime",
  sourceSha: config.sourceSha,
  platform: "ios",
  environment: "local",
  apiOrigin: RUNTIME_ORIGIN,
  applicationId: "site.baro.app.dev",
  device: { kind: "simulator", model: "synthetic iPhone", osVersion: "26" },
  productEntry: {
    kind: "instrumented-home-layout-only",
    originalSha256: "1".repeat(64),
    overlaySha256: "2".repeat(64),
    layout: { width: 390, height: 700 },
    screenshot: "product-home-ios.png",
  },
  probeEntry: {
    kind: "alternate-entry-real-native-sdk",
    path: "apps/mobile/runtime-probe/entry.tsx",
    sha256: "3".repeat(64),
  },
  metroOverlaySha256: "4".repeat(64),
  assets: {
    kind: "compiled-resource-only",
    family: "BaroMobile",
    sha256: "5".repeat(64),
    weights: [400, 600, 700],
    glyphs: 14757,
    codepoints: 14336,
    hangul: 11172,
    licenseEmbedded: true,
    compiledBytesMatch: true,
    appRuntimeVerified: false,
  },
  result: {
    version: 1,
    sourceSha: config.sourceSha,
    platform: "ios",
    upload: { bytes: UPLOAD_BYTES, sha256: fixture.uploadHash },
    download: { bytes: DOWNLOAD_BYTES, sha256: fixture.largeHash },
    nativeCalls: 5,
    nativeMaxCopyBytes: 65536,
    sdkSourceReadback: true,
    sdkDownloadReadback: true,
    secureStoreReadback: true,
    unresolvedKeyPreserved: true,
    cancelUploadBytesReceived: 32768,
    unauthorizedRejected: true,
    crossOriginRejected: true,
    ownerChangeRejected: true,
    peerCookiePreserved: true,
    sourceClearRejectedActiveUpload: true,
    sourceFilesRemaining: 0,
    downloadFilesRemaining: 0,
    nativeFilesRemaining: 0,
    documentPickerVerified: false,
    oauthVerified: false,
    remoteApiVerified: false,
    physicalDeviceVerified: false,
    storeSigned: false,
    deployed: false,
  },
  transport: {
    requestCount: 5,
    rejectedHeaders: 0,
    upload: { bytes: UPLOAD_BYTES, sha256: fixture.uploadHash },
    downloadedBytes: DOWNLOAD_BYTES,
    delayedStarted: true,
    cancelUploadStarted: true,
    cancelUploadBytes: 32768,
  },
  memory: {
    metric: "sampled-process-rss",
    peakObservedBytes: 256000000,
    samples: 10,
    wholeRunPeakProven: false,
    jsHeapLimitProven: false,
  },
  productJourneysVerified: false,
  accessibilityVerified: false,
  storeSigned: false,
  deployed: false,
});
test("receipt rejects wrong source/platform, missing IO/cleanup and expanded acceptance claims", () => {
  const valid = candidate();
  expect(verifyRuntimeReceipt(valid, config.sourceSha, "ios").sourceSha).toBe(config.sourceSha);
  expect(() => verifyRuntimeReceipt(valid, "b".repeat(40), "ios")).toThrow();
  expect(() => verifyRuntimeReceipt(valid, config.sourceSha, "android")).toThrow();
  for (const field of [
    "productJourneysVerified",
    "accessibilityVerified",
    "storeSigned",
    "deployed",
  ]) {
    expect(runtimeReceiptSchema.safeParse({ ...valid, [field]: true }).success).toBe(false);
  }
  expect(
    runtimeReceiptSchema.safeParse({ ...valid, memory: { ...valid.memory, samples: 0 } }).success,
  ).toBe(false);
  expect(
    runtimeReceiptSchema.safeParse({
      ...valid,
      result: { ...valid.result, nativeFilesRemaining: 1 },
    }).success,
  ).toBe(false);
  expect(() =>
    verifyRuntimeReceipt(
      { ...valid, transport: { ...valid.transport, cancelUploadBytes: 32769 } },
      config.sourceSha,
      "ios",
    ),
  ).toThrow();
});
test("manual workflow preserves product entry and only uploads scoped receipts and synthetic screenshots", async () => {
  const manifest = await Bun.file("apps/mobile/package.json").json();
  expect(manifest.main).toBe("expo-router/entry");
  expect(productEntryOverlay()).toContain("<OriginalHome />");
  expect(productEntryOverlay()).toContain("/probe/mounted");
  const workflow = await Bun.file(".github/workflows/mobile-runtime.yml").text();
  expect(workflow).toContain("github.ref == 'refs/heads/main'");
  expect(workflow).toContain("cancel-in-progress: false");
  expect(workflow).not.toContain("private-command");
  for (const line of workflow.split("\n").filter((line) => line.includes("uses:")))
    expect(line).toMatch(/@[a-f0-9]{40}/);
});
