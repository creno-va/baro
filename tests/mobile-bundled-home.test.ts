import { expect, test } from "bun:test";
import { bundledAndroidHomeObservation } from "../scripts/mobile-internal-android-home";
import { androidReverificationSchema } from "../scripts/mobile-internal-android-reverify";

const node = (label: string, bounds = "[0,100][800,200]", attribute = "text") =>
  `<node package="site.baro.app.preview" enabled="true" ${attribute}="${label}" bounds="${bounds}"/>`;
const xml = (body: string) => `<?xml version="1.0"?><hierarchy>${body}</hierarchy>`;
test("real hierarchy latch requires visible enabled Home content from the actual preview app", () => {
  const title = node("내 상황을 차근차근 정리해요."),
    card = node("기억나는 내용부터");
  expect(bundledAndroidHomeObservation(xml(title + card))).toEqual({
    titleVisible: true,
    firstCardVisible: true,
    foundationErrorVisible: false,
  });
  expect(
    bundledAndroidHomeObservation(
      xml(node("내 상황을 차근차근 정리해요.", undefined, "content-desc") + card),
    ).titleVisible,
  ).toBe(true);
  for (const invalid of [
    (title + card).replaceAll("site.baro.app.preview", "com.synthetic.other"),
    (title + card).replaceAll('enabled="true"', 'enabled="false"'),
    (title + card).replaceAll('enabled="true"', 'enabled="true" visible-to-user="false"'),
    (title + card).replaceAll("[0,100][800,200]", "[0,100][0,100]"),
    card,
  ])
    expect(bundledAndroidHomeObservation(xml(invalid)).titleVisible).toBe(false);
  expect(
    bundledAndroidHomeObservation(xml(title + card + node("앱을 열 수 없어요")))
      .foundationErrorVisible,
  ).toBe(true);
  expect(() => bundledAndroidHomeObservation("not a hierarchy")).toThrow(
    "BUNDLED_HOME_HIERARCHY_REQUIRED",
  );
  expect(() => bundledAndroidHomeObservation("<?xml" + "x".repeat(1_000_000))).toThrow(
    "BUNDLED_HOME_HIERARCHY_REQUIRED",
  );
});
test("runtime input binds the original binary source and cannot promote physical or broad runtime acceptance", async () => {
  const report = await Bun.file(
    "docs/quality/mobile-internal-android-2026-10-23/verification-dfd05f2.json",
  ).json();
  expect(androidReverificationSchema.parse(report).originalInspectionAccepted).toBe(false);
  for (const changed of [
    { binarySourceSha: "b".repeat(40) },
    { appRuntimeVerified: true },
    { physicalDeviceVerified: true },
    { retainedGeneratedBundleCompared: false },
  ])
    expect(() => androidReverificationSchema.parse({ ...report, ...changed })).toThrow();
});
