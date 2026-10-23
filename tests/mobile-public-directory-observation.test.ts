import { expect, test } from "bun:test";
import {
  androidGuideUiReceiptSchema,
  androidGuideUiValidationFields,
  androidHomeObservationOptions,
  verifyAndroidGuideUiReceipt,
} from "../scripts/mobile-android-guide-ui";
import {
  anonymousGuideControl,
  anonymousGuideUiObservation,
  anonymousScreenshotGuard,
  publicDirectoryButton,
  publicDirectoryUiObservation,
} from "../scripts/mobile-public-directory-observation";

test("no SDK screenshot reader can run after the public-data boundary, including later failure handling", async () => {
  let reads = 0;
  const guard = anonymousScreenshotGuard(async () => {
    reads++;
    return "synthetic anonymous Home pixels";
  });
  expect(await guard.read()).toBe("synthetic anonymous Home pixels");
  guard.disable();
  guard.disable();
  expect(guard.allowed).toBe(false);
  await expect(guard.read()).rejects.toThrow("BUNDLED_PUBLIC_SCREENSHOT_FORBIDDEN");
  await expect(guard.read()).rejects.toThrow("BUNDLED_PUBLIC_SCREENSHOT_FORBIDDEN");
  expect(reads).toBe(1);
});

const node = (text: string, extra = "") =>
  `<node package="site.baro.app.preview" enabled="true" text="${text}" bounds="[0,100][800,220]" ${extra}/>`;
const xml = (body: string) => `<?xml version="1.0"?><hierarchy>${body}</hierarchy>`;
test("public navigation only selects an unambiguous enabled owned button inside the actual viewport", () => {
  const button = node("변호사 탐색", 'clickable="true"');
  expect(publicDirectoryButton(xml(button), 1080, 2400)).toEqual({ x: 400, y: 160 });
  for (const body of [
    button + button,
    button.replace("site.baro.app.preview", "synthetic.other"),
    button.replace('enabled="true"', 'enabled="false"'),
    button.replace('clickable="true"', 'clickable="false"'),
    button.replace("[0,100][800,220]", "[0,100][1200,220]"),
    button.replace("[0,100][800,220]", "[0,100][800,110]"),
  ])
    expect(publicDirectoryButton(xml(body), 1080, 2400)).toBeNull();
  expect(() => publicDirectoryButton(xml(button), 0, 2400)).toThrow(
    "BUNDLED_PUBLIC_VIEWPORT_REQUIRED",
  );
});
test("public observation separates loading, ready and errors without exporting profile values", () => {
  const heading = node("변호사 탐색"),
    privateValue = "synthetic-private-name-and-id";
  const empty = publicDirectoryUiObservation(
    xml(heading + node("공개된 프로필을 준비하고 있어요")),
  );
  expect(empty).toMatchObject({
    headingVisible: true,
    readyEmpty: true,
    readyProfileCard: false,
    errorVisible: false,
  });
  const profile = publicDirectoryUiObservation(
    xml(heading + node(privateValue) + node("본인 작성 프로필")),
  );
  expect(profile).toMatchObject({ readyProfileCard: true, readyEmpty: false, errorVisible: false });
  expect(JSON.stringify(profile)).not.toContain(privateValue);
  for (const state of [
    "공개 프로필을 확인하고 있어요",
    "목록을 불러오지 못했어요",
    "앱 설정을 확인해 주세요",
  ]) {
    const observed = publicDirectoryUiObservation(
      xml(heading + node("본인 작성 프로필") + node(state)),
    );
    expect(observed.readyProfileCard).toBe(false);
    expect(observed.readyEmpty).toBe(false);
  }
  expect(
    publicDirectoryUiObservation(
      xml(
        (heading + node("본인 작성 프로필")).replaceAll("site.baro.app.preview", "synthetic.other"),
      ),
    ).readyProfileCard,
  ).toBe(false);
  expect(() => publicDirectoryUiObservation("not xml")).toThrow(
    "BUNDLED_PUBLIC_HIERARCHY_REQUIRED",
  );
});

test("Guide UI mode requires large font and cannot cross the public screenshot boundary", () => {
  expect(androidHomeObservationOptions([])).toEqual({
    largeFont: false,
    publicDirectory: false,
    guideUi: false,
  });
  expect(androidHomeObservationOptions(["--guide-ui", "--large-font"])).toEqual({
    largeFont: true,
    publicDirectory: false,
    guideUi: true,
  });
  expect(androidHomeObservationOptions(["--large-font", "--public-directory"])).toEqual({
    largeFont: true,
    publicDirectory: true,
    guideUi: false,
  });
  for (const args of [
    ["--guide-ui"],
    ["--guide-ui", "--public-directory", "--large-font"],
    ["--guide-ui", "--large-font", "--guide-ui"],
    ["--unknown"],
  ])
    expect(() => androidHomeObservationOptions(args)).toThrow("BUNDLED_HOME_MODE_REQUIRED");
});
test("anonymous Guide taps select only unique enabled exact static controls inside the viewport", () => {
  const button = node("이용 안내 보기", 'clickable="true"');
  expect(() => anonymousGuideControl(xml(button), 1080, 2400, "private-route" as never)).toThrow(
    "BUNDLED_GUIDE_CONTROL_REQUIRED",
  );
  expect(anonymousGuideControl(xml(button), 1080, 2400, "open-guide")).toEqual({ x: 400, y: 160 });
  expect(
    anonymousGuideControl(xml(node("처음으로", 'clickable="true"')), 1080, 2400, "return-home"),
  ).toEqual({ x: 400, y: 160 });
  for (const body of [
    button + button,
    button.replace('enabled="true"', 'enabled="false"'),
    button.replace('clickable="true"', 'clickable="false"'),
    button.replace("site.baro.app.preview", "synthetic.other"),
    button.replace("이용 안내 보기", "이용 안내 보기 다른 동작"),
    button.replace("[0,100][800,220]", "[0,100][1200,220]"),
    button.replace("[0,100][800,220]", "[0,100][800,110]"),
    button.replace('enabled="true"', 'enabled="true" visible-to-user="false"'),
  ])
    expect(anonymousGuideControl(xml(body), 1080, 2400, "open-guide")).toBeNull();
});
test("Guide route observations expose only fixed booleans and distinguish real screen changes", () => {
  const privateLabel = "synthetic-private-label-and-id";
  const home = anonymousGuideUiObservation(
    xml(node("내 상황을 차근차근 정리해요.") + node(privateLabel)),
  );
  expect(home).toEqual({
    homeTitleVisible: true,
    guideTitleVisible: false,
    currentFeatureDescriptionVisible: false,
    configurationErrorVisible: false,
  });
  const guide = anonymousGuideUiObservation(
    xml(node("상담 준비는 이렇게 진행돼요.") + node(privateLabel)),
  );
  expect(guide).toEqual({
    homeTitleVisible: false,
    guideTitleVisible: true,
    currentFeatureDescriptionVisible: false,
    configurationErrorVisible: false,
  });
  expect(JSON.stringify(guide)).not.toContain(privateLabel);
  expect(
    anonymousGuideUiObservation(
      xml(
        node(
          "사건 화면에서 자료를 올리고 처리 내용을 확인하거나, 리포트를 검토한 뒤 저장·공유할 수 있어요.",
        ),
      ),
    ).currentFeatureDescriptionVisible,
  ).toBe(true);
  expect(
    anonymousGuideUiObservation(xml(node("앱을 열 수 없어요"))).configurationErrorVisible,
  ).toBe(true);
});
test("Android Guide UI receipt binds original APK and baseline; it cannot claim private or complete accessibility acceptance", async () => {
  const baseline = await Bun.file(
    "docs/quality/mobile-internal-android-2026-10-23/home-478a904.json",
  ).json();
  const identity = {
    toolingSourceSha: baseline.toolingSourceSha,
    binarySourceSha: baseline.binarySourceSha,
    binary: baseline.binary,
    device: baseline.device,
    verificationSha256: baseline.verificationSha256,
    baselineReceiptSha256: "c".repeat(64),
  };
  const value = {
    version: 1,
    kind: "bundled-android-large-font-home-guide-ui-only",
    ...identity,
    observedAt: "2026-10-24T00:00:00.000Z",
    applicationId: "site.baro.app.preview",
    fontScaleBefore: 2,
    fontScaleAfter: 2,
    homeSwipes: 3,
    guideSwipes: 4,
    guideButtonTapVerified: true,
    guideTitleObserved: true,
    currentFeatureDescriptionObserved: true,
    returnButtonTapVerified: true,
    homeReturnObserved: true,
    guideDismissedObserved: true,
    controlBoundsWithinScreen: true,
    rawHierarchyExported: false,
    screenshotsSuppressedBeforeNavigation: true,
    publicDataNavigation: false,
    authenticationNavigation: false,
    metroServerStarted: false,
    metroRequests: 0,
    allScreensVerified: false,
    keyboardVerified: false,
    rotationVerified: false,
    talkBackVerified: false,
    voiceOverVerified: false,
    remoteApiVerified: false,
    oauthVerified: false,
    physicalDeviceVerified: false,
    storeSigned: false,
    deployed: false,
  };
  expect(verifyAndroidGuideUiReceipt(value, identity).homeSwipes).toBe(3);
  for (const patch of [
    { binarySourceSha: "f".repeat(40) },
    { toolingSourceSha: "f".repeat(40) },
    { binary: { ...identity.binary, sha256: "f".repeat(64) } },
    { baselineReceiptSha256: "f".repeat(64) },
    { verificationSha256: "f".repeat(64) },
    { device: { ...identity.device, osVersion: "99" } },
    { fontScaleAfter: 1 },
    { homeSwipes: 0 },
    { guideSwipes: 25 },
    { guideButtonTapVerified: false },
    { homeReturnObserved: false },
    { currentFeatureDescriptionObserved: false },
    { rawHierarchyExported: true },
    { screenshotsSuppressedBeforeNavigation: false },
    { publicDataNavigation: true },
    { authenticationNavigation: true },
    { talkBackVerified: true },
    { allScreensVerified: true },
    { metroRequests: 1 },
    { remoteApiVerified: true },
    { oauthVerified: true },
    { storeSigned: true },
    { deployed: true },
  ])
    expect(() => verifyAndroidGuideUiReceipt({ ...value, ...patch }, identity)).toThrow();
});

test("the actual missing screenshot guard field yields a bounded validation field without private input", () => {
  const result = androidGuideUiReceiptSchema.safeParse({ unknownPrivateInput: "synthetic-token" });
  expect(result.success).toBe(false);
  if (!result.success) {
    const fields = androidGuideUiValidationFields(result.error);
    expect(fields.length).toBeLessThanOrEqual(8);
    expect(JSON.stringify(fields)).not.toContain("synthetic-token");
    expect(JSON.stringify(fields)).not.toContain("unknownPrivateInput");
  }
  const flag = androidGuideUiReceiptSchema
    .pick({ screenshotsSuppressedBeforeNavigation: true })
    .safeParse({});
  if (!flag.success)
    expect(androidGuideUiValidationFields(flag.error)).toEqual([
      "screenshotsSuppressedBeforeNavigation",
    ]);
  expect(androidGuideUiValidationFields(Error("synthetic-token"))).toEqual([]);
});
