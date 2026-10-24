import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Apple Foundation probe only. Linux/corelibs compilation does not verify iOS behavior.
// The public-directory workflow requires this probe explicitly on its owned macOS SDK.
const required = process.env.BARO_IOS_DIRECTORY_SIGNATURE_REQUIRED === "1";
const appleSwift = process.platform === "darwin" ? Bun.which("swiftc") : null;
test.skipIf(!required && !appleSwift)(
  "the exact Swift diagnostic classifies synthetic normalization, omissions and Hangul without returning values",
  async () => {
    if (!appleSwift) throw Error("DIRECTORY_SIGNATURE_APPLE_SWIFT_REQUIRED");
    const source = await readFile("scripts/mobile-ios-ui/DirectoryUITests.swift", "utf8");
    const section = source
      .split("// BARO_DIRECTORY_SIGNATURE_BEGIN\n")[1]
      ?.split("// BARO_DIRECTORY_SIGNATURE_END")[0];
    expect(section).toBeDefined();
    const root = await mkdtemp(join(tmpdir(), "baro-ios-directory-signature-"));
    try {
      const probe = join(root, "probe.swift"),
        binary = join(root, "probe");
      await writeFile(
        probe,
        `import Foundation\n${section}\n
let expected = "baro-mobile-smoke-20261024"
let cases: [(String?, String, Bool)] = [
  (nil, "stringObserved", false), ("", "stringObserved", true),
  (expected, "allKnownSegmentsPresent", true), ("bro-mobile-smoke-20261024", "allKnownSegmentsPresent", false),
  (expected, "knownNormalizationMatches", true), (expected, "expectedLengthMatches", true),
  (expected, "onlyExpectedScalarsAfterCaseFold", true),
  ("Baro-Mobile-Smoke-20261024", "caseFoldMatches", true),
  (expected + " ", "whitespaceRemovalMatches", true),
  (expected.replacingOccurrences(of:"-",with:"–"), "dashNormalizationMatches", true),
  ("ｂａｒｏ-ｍｏｂｉｌｅ-ｓｍｏｋｅ-２０２６１０２４", "compatibilityNormalizationMatches", true),
  (" BARO –mobile–smoke–20261024 ", "knownNormalizationMatches", true),
  ("bro-mobile-smoke-20261024", "expectedSubsequenceOnly", true),
  ("bro-mobile-smoke-20261024", "expectedLengthMatches", false),
  (expected + "extra", "containsKnownPayload", true),
  (expected + "extra", "expectedSubsequenceOnly", false),
  ("한글20261024", "containsHangul", true),
  ("한글20261024", "knownDigitSuffixMatches", true),
  ("이름으로 검색", "matchesFixedFieldLabel", true),
  ("synthetic-private-value", "knownNormalizationMatches", false)
]
for (value, key, required) in cases {
  let result = directoryInputSignature(value)
  if result.count != 14 || result[key] != required { print("DIRECTORY_SIGNATURE_PROBE_FAILED"); exit(1) }
}
print("DIRECTORY_SIGNATURE_PROBE_PASSED")
`,
      );
      const compiled = Bun.spawn([appleSwift, probe, "-o", binary], {
        stdout: "ignore",
        stderr: "ignore",
      });
      const compileTimer = setTimeout(() => compiled.kill(), 45000);
      try {
        expect(await compiled.exited).toBe(0);
      } finally {
        clearTimeout(compileTimer);
      }
      const child = Bun.spawn([binary], { stdout: "pipe", stderr: "ignore" });
      const runTimer = setTimeout(() => child.kill(), 10000);
      try {
        const result = (await new Response(child.stdout).text()).trim();
        expect(await child.exited).toBe(0);
        expect(result).toBe("DIRECTORY_SIGNATURE_PROBE_PASSED");
      } finally {
        clearTimeout(runTimer);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
