import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const required = process.env.BARO_IOS_SETTINGS_OWNER_REQUIRED === "1";
const appleSwift = process.platform === "darwin" ? Bun.which("swiftc") : null;
// Apple Foundation decision probe only. UIKit controls/Settings/runtime remain unverified here.
test.skipIf(!required && !appleSwift)(
  "the exact native Settings and keyboard-switch decisions reject disjoint, duplicate and out-of-region owners",
  async () => {
    if (!appleSwift) throw Error("SETTINGS_OWNER_APPLE_SWIFT_REQUIRED");
    const source = await readFile("scripts/mobile-ios-ui/DirectoryKoreanUITests.swift", "utf8"),
      marker = "// BARO_KOREAN_SETTINGS_OWNER_BEGIN\n",
      end = "// BARO_KOREAN_SETTINGS_OWNER_END";
    expect(source.split(marker)).toHaveLength(2);
    expect(source.split(end)).toHaveLength(2);
    const section = source.split(marker)[1]?.split(end)[0];
    expect(section?.startsWith("private func koreanSettingsOwnerChoice(")).toBe(true);
    const switchMarker = "// BARO_KOREAN_SWITCH_OWNER_BEGIN\n",
      switchEnd = "// BARO_KOREAN_SWITCH_OWNER_END";
    expect(source.split(switchMarker)).toHaveLength(2);
    expect(source.split(switchEnd)).toHaveLength(2);
    const switchSection = source.split(switchMarker)[1]?.split(switchEnd)[0];
    expect(switchSection?.startsWith("private func koreanKeyboardSwitchOwner(")).toBe(true);
    const root = await mkdtemp(join(tmpdir(), "baro-ios-settings-owner-"));
    try {
      const probe = join(root, "probe.swift"),
        binary = join(root, "probe");
      await writeFile(
        probe,
        `import Foundation\nimport CoreGraphics\n${section}\n${switchSection}\n
let row = CGRect(x: 0, y: 50, width: 320, height: 48)
let inside = CGRect(x: 16, y: 60, width: 120, height: 20)
let elsewhere = CGRect(x: 0, y: 200, width: 120, height: 20)
let small = CGRect(x: 0, y: 0, width: 10, height: 10)
let acceptedEdge = CGRect(x: 0.5, y: 0, width: 10, height: 10)
let rejectedEdge = CGRect(x: 0.6, y: 0, width: 10, height: 10)
let cases: [([CGRect], [CGRect], [CGRect], String, Bool)] = [
  ([row], [inside], [inside, elsewhere], "cell", true),
  ([row], [], Array(repeating: elsewhere, count: 8), "cell", true),
  ([], [inside], [inside, elsewhere], "button", true),
  ([row], [elsewhere], [inside], "ambiguous", false),
  ([row, row], [], [], "ambiguous", true),
  ([], [inside, inside], [], "ambiguous", true),
  ([], [], [inside], "text", true),
  ([], [], [inside, elsewhere], "ambiguous", true),
  ([], [], [], "none", true),
  ([small], [acceptedEdge], [], "cell", true),
  ([small], [rejectedEdge], [], "ambiguous", false),
  ([row], [], Array(repeating: inside, count: 9), "ambiguous", false)
]
for (cells, buttons, texts, kind, overlap) in cases {
  let actual = koreanSettingsOwnerChoice(cells: cells, buttons: buttons, texts: texts)
  if actual.selection != kind || actual.ownersOverlap != overlap { print("SETTINGS_OWNER_PROBE_FAILED"); exit(1) }
}
let window = CGRect(x: 0, y: 0, width: 390, height: 844)
let keyboard = CGRect(x: 0, y: 500, width: 390, height: 300)
let dock = CGRect(x: 12, y: 810, width: 32, height: 24)
let above = CGRect(x: 12, y: 400, width: 32, height: 24)
func checkSwitch(_ buttons: [CGRect], _ keys: [CGRect], _ kb: CGRect, _ win: CGRect, _ selection: String, _ index: Int?, _ bc: Int, _ kc: Int, _ overlap: Bool, _ valid: Bool) {
  let a = koreanKeyboardSwitchOwner(buttons: buttons, keys: keys, keyboard: kb, window: win)
  if a.selection != selection || a.index != index || a.buttonCount != bc || a.keyCount != kc || a.ownersOverlap != overlap || a.regionValid != valid { print("SETTINGS_OWNER_PROBE_FAILED"); exit(1) }
}
checkSwitch([CGRect(x: 12, y: 600, width: 32, height: 24)], [], keyboard, window, "button", 0, 1, 0, true, true)
checkSwitch([dock], [], keyboard, window, "button", 0, 1, 0, true, true)
checkSwitch([], [dock], keyboard, window, "key", 0, 0, 1, true, true)
checkSwitch([dock], [dock], keyboard, window, "button", 0, 1, 1, true, true)
checkSwitch([above, dock], [], keyboard, window, "button", 1, 1, 0, true, true)
checkSwitch([above], [], keyboard, window, "none", nil, 0, 0, true, true)
checkSwitch([CGRect(x: 380, y: 810, width: 32, height: 24)], [], keyboard, window, "none", nil, 0, 0, true, true)
checkSwitch([CGRect(x: 12, y: 834, width: 32, height: 32)], [], keyboard, window, "none", nil, 0, 0, true, true)
checkSwitch([dock, dock], [], keyboard, window, "ambiguous", nil, 2, 0, true, true)
checkSwitch([dock], [CGRect(x: 64, y: 810, width: 32, height: 24)], keyboard, window, "ambiguous", nil, 1, 1, false, true)
checkSwitch([dock], [], CGRect(x: 0, y: 500, width: 200, height: 300), window, "none", nil, 0, 0, true, false)
checkSwitch([dock], [], CGRect(x: 0, y: 500, width: 390, height: 1), window, "none", nil, 0, 0, true, false)
checkSwitch([dock], [], CGRect(x: 0, y: CGFloat.nan, width: 390, height: 300), window, "none", nil, 0, 0, true, false)
checkSwitch([CGRect(x: CGFloat.infinity, y: 810, width: 32, height: 24)], [], keyboard, window, "none", nil, 0, 0, true, true)
checkSwitch([dock], [], keyboard, CGRect(x: 0, y: 0, width: 844, height: 390), "none", nil, 0, 0, true, false)
checkSwitch(Array(repeating: dock, count: 9), [], keyboard, window, "ambiguous", nil, 0, 0, false, false)
let smallDock = CGRect(x: 12, y: 810, width: 10, height: 10)
checkSwitch([smallDock], [CGRect(x: 12.5, y: 810, width: 10, height: 10)], keyboard, window, "button", 0, 1, 1, true, true)
checkSwitch([smallDock], [CGRect(x: 12.6, y: 810, width: 10, height: 10)], keyboard, window, "ambiguous", nil, 1, 1, false, true)
print("SETTINGS_OWNER_PROBE_PASSED")
`,
      );
      const compile = Bun.spawn([appleSwift, probe, "-o", binary], {
        stdout: "ignore",
        stderr: "ignore",
      });
      const timer = setTimeout(() => compile.kill(), 45000);
      try {
        expect(await compile.exited).toBe(0);
      } finally {
        clearTimeout(timer);
      }
      const child = Bun.spawn([binary], { stdout: "pipe", stderr: "ignore" });
      const runTimer = setTimeout(() => child.kill(), 10000);
      try {
        const output = (await new Response(child.stdout).text()).trim();
        expect(await child.exited).toBe(0);
        expect(output).toBe("SETTINGS_OWNER_PROBE_PASSED");
      } finally {
        clearTimeout(runTimer);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
