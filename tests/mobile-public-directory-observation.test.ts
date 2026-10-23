import { expect, test } from "bun:test";
import {
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
