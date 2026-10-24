import { expect, test } from "bun:test";
import { iosAuthCancelBaseSchema } from "../scripts/mobile-ios-auth-cancel";
import { inputSignatureSchema } from "../scripts/mobile-ios-directory-ui";
import {
  inputReferenceSignatureSource,
  observeIosInputReferenceFailure,
  parseIosInputReferenceResult,
  verifyIosInputReferenceReceipt,
} from "../scripts/mobile-ios-input-reference";
import { iosInternalObservationOptions } from "../scripts/mobile-ios-ui-capabilities";

const signature = Object.fromEntries(
  Object.keys(inputSignatureSchema.shape).map((key) => [key, false]),
);
function observation() {
  return {
    kind: "ios-uikit-single-input-reference-only",
    applicationId: "site.baro.test.input-reference",
    observationCompleted: true,
    initiallyEmpty: true,
    keyboardObserved: true,
    inputAboveKeyboard: true,
    typeTextCalls: 1,
    pastePerformed: false,
    typingSpeedChanged: false,
    normalizationApplied: false,
    accessibilitySignature: signature,
    nativeSignature: signature,
    signaturesAgree: true,
    nativeChangeEvents: 0,
    productInputVerified: false,
    rootCauseConfirmed: false,
    rawInputExported: false,
    koreanKeyboardVerified: false,
  };
}
const encode = (value: unknown) => `BARO_INPUT_REFERENCE_RESULT:${JSON.stringify(value)}`;
test("reference accepts mismatching input as diagnostics, binds AX/native agreement and rejects raw values or expanded acceptance", () => {
  const value = observation();
  expect(value).toEqual(parseIosInputReferenceResult(`private chatter\n${encode(value)}`));
  const changed = { ...signature, expectedLengthMatches: true };
  expect(
    parseIosInputReferenceResult(
      encode({ ...value, nativeSignature: changed, signaturesAgree: false }),
    ).signaturesAgree,
  ).toBe(false);
  for (const patch of [
    { nativeSignature: changed },
    { signaturesAgree: false },
    { rawValue: "private-value" },
    { accessibilitySignature: { ...signature, rawValue: "private-value" } },
    { nativeSignature: {} },
    { nativeChangeEvents: 101 },
    { nativeChangeEvents: -1 },
    { typeTextCalls: 2 },
    { productInputVerified: true },
    { rootCauseConfirmed: true },
    { rawInputExported: true },
    { pastePerformed: true },
    { typingSpeedChanged: true },
    { normalizationApplied: true },
    { applicationId: "site.baro.app.preview" },
  ])
    expect(() => parseIosInputReferenceResult(encode({ ...value, ...patch }))).toThrow();
  for (const text of ["** TEST SUCCEEDED **", `${encode(value)}\n${encode(value)}`, encode(null)])
    expect(() => parseIosInputReferenceResult(text)).toThrow();
});
test("reference requires its own isolated Home mode; no directory/auth/audit combination", () => {
  expect(iosInternalObservationOptions(["--home", "--input-reference"])).toEqual({
    home: true,
    largeFont: false,
    uiTest: false,
    accessibilityAudit: false,
    authCancel: false,
    publicDirectory: false,
    inputReference: true,
  });
  for (const args of [
    ["--input-reference"],
    ["--input-reference", "--home"],
    ["--home", "--input-reference", "--input-reference"],
    ...[
      "--public-directory",
      "--auth-cancel",
      "--large-font",
      "--ui-test",
      "--accessibility-audit",
    ].map((mode) => ["--home", "--input-reference", mode]),
  ])
    expect(() => iosInternalObservationOptions(args)).toThrow();
});
test("reference receipt cannot replace product observations or detach its original Home/source/device identity", async () => {
  const baseline = await Bun.file(
    "docs/quality/mobile-internal-ios-2026-10-24/directory-home-19c104c.json",
  ).json();
  const value = {
    ...iosAuthCancelBaseSchema.strip().parse(baseline),
    kind: "ios-bundled-home-with-separate-uikit-input-reference",
    referenceAppSourceSha256: "a".repeat(64),
    swiftTestSha256: "b".repeat(64),
    signatureSourceSha256: "c".repeat(64),
    projectGeneratorSha256: "d".repeat(64),
    projectGeneratorVersion: "1.28.0",
    referenceAppAndRunnerCompiled: true,
    productRecompiled: false,
    productResigned: false,
    productDirectoryNavigated: false,
    explicitScreenshotsSuppressedBeforeReference: true,
    hostRawCommandLogsPersistedAfterBoundary: false,
    rawXcresultExported: false,
    rawUiHierarchyExported: false,
    result: observation(),
  };
  expect(verifyIosInputReferenceReceipt(value, baseline).result.productInputVerified).toBe(false);
  for (const patch of [
    { binarySourceSha: "a".repeat(40) },
    { toolingSourceSha: "b".repeat(40) },
    { archiveSha256: "c".repeat(64) },
    { compilerReceiptSha256: "d".repeat(64) },
    { device: { ...baseline.device, model: "other" } },
    { productRecompiled: true },
    { productResigned: true },
    { productDirectoryNavigated: true },
    { explicitScreenshotsSuppressedBeforeReference: false },
    { rawXcresultExported: true },
    { rawUiHierarchyExported: true },
    { hostRawCommandLogsPersistedAfterBoundary: true },
    { remoteApiVerified: true },
    { physicalDeviceVerified: true },
    { rawInput: "private-value" },
  ])
    expect(() => verifyIosInputReferenceReceipt({ ...value, ...patch }, baseline)).toThrow();
});
test("reference shares the actual Apple signature function; missing/duplicate sources and unknown assertions fail closed", async () => {
  const source = await Bun.file("scripts/mobile-ios-ui/DirectoryUITests.swift").text();
  const extracted = inputReferenceSignatureSource(source);
  expect(extracted).toContain('let expected = "baro-mobile-smoke-20261024"');
  for (const text of ["", source + source, source.replace("// BARO_DIRECTORY_SIGNATURE_END", "")])
    expect(() => inputReferenceSignatureSource(text)).toThrow();
  expect(
    observeIosInputReferenceFailure("XCTAssertTrue failed - BARO_REFERENCE_INPUT_OCCLUDED private"),
  ).toEqual({ assertionCode: "BARO_REFERENCE_INPUT_OCCLUDED" });
  expect(
    observeIosInputReferenceFailure("failed - BARO_REFERENCE_NATIVE_OBSERVER_INVALID private"),
  ).toEqual({ assertionCode: "BARO_REFERENCE_NATIVE_OBSERVER_INVALID" });
  for (const text of [
    "private",
    "BARO_REFERENCE_INPUT_MISSING",
    "XCTAssertTrue failed - BARO_REFERENCE_SECRET",
  ])
    expect(observeIosInputReferenceFailure(text)).toEqual({ assertionCode: null });
});
test("workflow requires isolated reference intent and exports only fixed observations", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(".github/workflows/mobile-internal-ios-reverify.yml").text(),
  ) as {
    on: { workflow_dispatch: { inputs: Record<string, { default: unknown }> } };
    jobs: {
      verify: { steps: { name?: string; run?: string; if?: string; with?: { path?: string } }[] };
    };
  };
  expect(workflow.on.workflow_dispatch.inputs.input_reference?.default).toBe(false);
  const steps = workflow.jobs.verify.steps;
  const gate = steps.find((s) => s.name === "Validate source and observation options")?.run ?? "";
  for (const field of [
    "HOME",
    "PUBLIC_DIRECTORY",
    "AUTH_CANCEL",
    "LARGE_FONT",
    "UI_TEST",
    "ACCESSIBILITY_AUDIT",
  ])
    expect(gate).toContain(`test "$OBSERVE_${field}"`);
  const run =
    steps.find(
      (s) => s.name === "Reverify original metadata and optionally observe anonymous cold launches",
    )?.run ?? "";
  expect(run).toContain("args+=(--input-reference)");
  expect(run).toContain("test -s .wrangler/mobile-internal-ios-reverify/input-reference.json");
  const paths =
    steps.find((s) => s.name === "Preserve scoped unchanged binary and observations")?.with?.path ??
    "";
  expect(paths).toContain(".wrangler/mobile-internal-ios-reverify/input-reference.json");
  expect(paths).not.toContain("xcresult");
  expect(paths).not.toContain("input-reference/");
});
