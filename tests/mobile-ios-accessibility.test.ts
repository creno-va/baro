import { expect, test } from "bun:test";
import { iosAuditTypes, parseIosAccessibilityResult } from "../scripts/mobile-ios-accessibility";
import { verifyIosAccessibilityReceipt } from "../scripts/mobile-ios-home-ui-test";

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw Error("SYNTHETIC_FIXTURE_ENTRY_REQUIRED");
  return value;
}
function observation() {
  return {
    kind: "ios-anonymous-home-guide-accessibility-audit",
    applicationId: "site.baro.app.preview",
    requestedAuditTypes: [...iosAuditTypes],
    viewports: ["home-initial", "home-action", "guide-initial", "guide-action"].map((viewport) => ({
      viewport,
      completed: true,
      issueCount: 0,
      findings: [] as { category: string; target: string; count: number }[],
    })),
    issueCount: 0,
    auditPassed: true,
    defaultIssueReportingReplacedByFixedCounts: true,
    unreportedIssueCount: 0,
    voiceOverVerified: false,
    publicDataNavigation: false,
    authenticationNavigation: false,
    privateDataAccess: false,
  };
}
const encode = (value: unknown) => `BARO_HOME_ACCESSIBILITY_RESULT:${JSON.stringify(value)}`;
test("native audit requires a single complete fixed-field result and all requested viewport/type observations", () => {
  const value = observation();
  expect(value).toEqual(
    parseIosAccessibilityResult(`private compiler chatter\n${encode(value)}\n`),
  );
  for (const output of [
    "** TEST SUCCEEDED **",
    `${encode(value)}\n${encode(value)}`,
    "BARO_HOME_ACCESSIBILITY_RESULT:broken",
  ])
    expect(() => parseIosAccessibilityResult(output)).toThrow();
  for (const patch of [
    { requestedAuditTypes: iosAuditTypes.slice(1) },
    { requestedAuditTypes: [...iosAuditTypes].reverse() },
    { viewports: value.viewports.slice(1) },
    { viewports: [value.viewports[0], ...value.viewports.slice(0, 3)] },
    { voiceOverVerified: true },
    { unreportedIssueCount: 1 },
    { publicDataNavigation: true },
    { privateDataAccess: true },
    { rawHierarchy: "synthetic-private" },
  ])
    expect(() => parseIosAccessibilityResult(encode({ ...value, ...patch }))).toThrow();
});
test("an issue remains a failed audit even when the privacy handler replaces default XCTest reporting", () => {
  const value = observation();
  first(value.viewports).issueCount = 2;
  first(value.viewports).findings = [{ category: "contrast", target: "home-title", count: 2 }];
  value.issueCount = 2;
  value.auditPassed = false;
  expect(parseIosAccessibilityResult(encode(value)).auditPassed).toBe(false);
  for (const mutate of [
    (input: typeof value) => {
      input.auditPassed = true;
    },
    (input: typeof value) => {
      input.issueCount = 0;
    },
    (input: typeof value) => {
      first(input.viewports).issueCount = 0;
    },
    (input: typeof value) => {
      first(first(input.viewports).findings).count = 0;
    },
    (input: typeof value) => {
      first(first(input.viewports).findings).target = "synthetic-private-label";
    },
    (input: typeof value) => {
      first(first(input.viewports).findings).category = "raw-private-diagnostic";
    },
    (input: typeof value) => {
      first(input.viewports).findings.push({ ...first(first(input.viewports).findings) });
      first(input.viewports).issueCount = 4;
      input.issueCount = 4;
    },
  ]) {
    const changed = structuredClone(value);
    mutate(changed);
    expect(() => parseIosAccessibilityResult(encode(changed))).toThrow();
  }
});
test("audit proof is bound to the actual Home UI binary, tooling, runner, device and observation", async () => {
  const home = await Bun.file(
    "docs/quality/mobile-internal-ios-2026-10-23/home-ui-b0da132.json",
  ).json();
  const value = {
    ...home,
    kind: "ios-bundled-large-font-home-guide-accessibility-audit",
    result: observation(),
  };
  expect(verifyIosAccessibilityReceipt(value, home).result.auditPassed).toBe(true);
  for (const patch of [
    { binarySourceSha: "a".repeat(40) },
    { toolingSourceSha: "b".repeat(40) },
    { archiveSha256: "c".repeat(64) },
    { compilerReceiptSha256: "d".repeat(64) },
    { swiftTestSha256: "e".repeat(64) },
    { projectGeneratorVersion: "0.0.0" },
    { observedAt: "2026-10-24T00:00:00.000Z" },
    { device: { ...home.device, osVersion: "99" } },
    { accessibilityVerified: true },
    { oauthVerified: true },
    { productRecompiled: true },
    { rawXcresultExported: true },
    { rawUiHierarchyExported: true },
  ])
    expect(() => verifyIosAccessibilityReceipt({ ...value, ...patch }, home)).toThrow();
});
