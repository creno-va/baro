import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import {
  type IOSCompileArchitecture,
  iosCompileArchitectureArguments,
  iosCompileVerificationArchitecture,
  recordIOSCompileVerification,
} from "../scripts/mobile-ios-compile-verification";

const source = "a".repeat(40);

test("architecture verification is explicit CI-only and leaves existing native build modes universal", () => {
  for (const architecture of ["arm64", "x86_64"] as const) {
    expect(
      iosCompileVerificationArchitecture("ios", [`--verify-architecture=${architecture}`], "1"),
    ).toBe(architecture);
    expect(iosCompileArchitectureArguments(architecture)).toEqual([
      `ARCHS=${architecture}`,
      "ONLY_ACTIVE_ARCH=NO",
    ]);
  }
  for (const mode of [[], ["--runtime-local"], ["--xcode-control"], ["--runtime-xcode-control"]])
    expect(iosCompileVerificationArchitecture("ios", mode, "1")).toBeNull();
  expect(iosCompileVerificationArchitecture("android", [], "1")).toBeNull();
  expect(iosCompileArchitectureArguments(null)).toEqual([]);
  for (const args of [
    ["--verify-architecture=armv7"],
    ["--verify-architecture=arm64", "extra"],
    ["--runtime-local", "--verify-architecture=arm64"],
    ["--verify-architecture=arm64\nOTHER=1"],
  ])
    expect(() => iosCompileVerificationArchitecture("ios", args, "1")).toThrow(
      "IOS_COMPILE_VERIFICATION_MODE_REQUIRED",
    );
  expect(() =>
    iosCompileVerificationArchitecture("ios", ["--verify-architecture=arm64"], undefined),
  ).toThrow();
  expect(() =>
    iosCompileVerificationArchitecture("android", ["--verify-architecture=arm64"], "1"),
  ).toThrow();
  expect(() => iosCompileArchitectureArguments("armv7" as IOSCompileArchitecture)).toThrow();
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "baro-ios-compile-"));
  const products = resolve(root, ".wrangler/mobile-build/ios/Build/Products/Debug-iphonesimulator");
  const app = resolve(products, "BAROPreview.app");
  await mkdir(app, { recursive: true });
  await writeFile(resolve(app, "BAROPreview"), "synthetic executable");
  await writeFile(resolve(app, "BAROPreview.debug.dylib"), "synthetic debug image");
  const calls: string[][] = [];
  const options = {
    architecture: "arm64",
    debugArchitecture: "arm64",
    platform: "IOSSIMULATOR",
    executable: "BAROPreview",
  };
  const inspect = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "/usr/bin/plutil")
      return JSON.stringify({
        CFBundleIdentifier: "site.baro.app.preview",
        CFBundleExecutable: options.executable,
        DTPlatformName: "iphonesimulator",
        CFBundleSupportedPlatforms: ["iPhoneSimulator"],
      });
    if (args[0] === "/usr/bin/lipo")
      return args.at(-1)?.endsWith(".dylib") ? options.debugArchitecture : options.architecture;
    if (args[0] === "/usr/bin/xcrun") return `platform ${options.platform}\n`;
    throw new Error("UNEXPECTED_IDENTITY_COMMAND");
  };
  return {
    root,
    products,
    app,
    calls,
    options,
    inspect,
    cleanup: async () => {
      if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}baro-ios-compile-`))
        throw new Error("FIXTURE_ROOT_MISMATCH");
      await rm(root, { recursive: true, force: true });
    },
  };
}

for (const architecture of ["arm64", "x86_64"] as const) {
  test(`compile receipt verifies both executable images, simulator platform and exact ${architecture}`, async () => {
    const f = await fixture();
    try {
      f.options.architecture = architecture;
      f.options.debugArchitecture = architecture;
      const receipt = await recordIOSCompileVerification(f.root, source, architecture, f.inspect);
      expect(receipt).toMatchObject({
        sourceSha: source,
        architecture,
        platform: "ios-simulator",
        appRuntimeVerified: false,
        deployed: false,
      });
      expect(receipt.binaries).toHaveLength(2);
      expect(receipt.binaries[0]?.digest).toBe(
        createHash("sha256").update("synthetic executable").digest("hex"),
      );
      expect(f.calls.filter((args) => args[0] === "/usr/bin/lipo")).toHaveLength(2);
      expect(
        JSON.parse(
          await readFile(
            resolve(f.root, ".wrangler/mobile-build/ios-verification-architecture.json"),
            "utf8",
          ),
        ),
      ).toEqual(receipt);
      await expect(
        recordIOSCompileVerification(f.root, source, architecture, f.inspect),
      ).rejects.toThrow();
    } finally {
      await f.cleanup();
    }
  });
}

test("wrong/fat architecture, wrong debug image, device platform and escaping executable cannot produce a receipt", async () => {
  for (const patch of [
    { architecture: "arm64 x86_64" },
    { architecture: "x86_64" },
    { debugArchitecture: "x86_64" },
    { platform: "IOS" },
    { executable: "../outside" },
  ]) {
    const f = await fixture();
    try {
      Object.assign(f.options, patch);
      await expect(
        recordIOSCompileVerification(f.root, source, "arm64", f.inspect),
      ).rejects.toThrow();
      expect(
        await Bun.file(
          resolve(f.root, ".wrangler/mobile-build/ios-verification-architecture.json"),
        ).exists(),
      ).toBe(false);
    } finally {
      await f.cleanup();
    }
  }
});

test("native PR matrix retains Android and both iOS architectures within unchanged per-job limits", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(".github/workflows/mobile-native-module.yml").text(),
  ) as {
    on: { pull_request: { paths: string[] } };
    jobs: {
      compile: {
        "timeout-minutes": number;
        strategy: {
          "fail-fast": boolean;
          matrix: {
            include: { platform: string; id: string; architecture: string; runner: string }[];
          };
        };
        steps: {
          name?: string;
          run?: string;
          if?: string;
          with?: Record<string, unknown>;
          "continue-on-error"?: boolean;
        }[];
      };
    };
  };
  const job = workflow.jobs.compile;
  expect(job["timeout-minutes"]).toBe(40);
  expect(job.strategy["fail-fast"]).toBe(false);
  expect(job.strategy.matrix.include).toEqual([
    { platform: "android", id: "android", architecture: "", runner: "ubuntu-latest" },
    { platform: "ios", id: "ios-arm64", architecture: "arm64", runner: "macos-26" },
    { platform: "ios", id: "ios-x86_64", architecture: "x86_64", runner: "macos-26" },
  ]);
  expect(new Set(job.strategy.matrix.include.map((entry) => entry.id)).size).toBe(3);
  expect(job.steps.some((step) => step["continue-on-error"] === true)).toBe(false);
  expect(job.steps.find((step) => step.name === "Compile exact PR native source")?.run).toContain(
    "--verify-architecture=${{ matrix.architecture }}",
  );
  expect(
    job.steps.find((step) => step.name === "Record scoped verification receipt")?.run,
  ).toContain("IOS_COMPILE_RECEIPT_MISMATCH");
  expect(
    job.steps.find((step) => step.name === "Retain compile and core probe identity")?.with?.name,
  ).toBe("native-module-${{ matrix.id }}-${{ github.event.pull_request.head.sha }}");
  expect(workflow.on.pull_request.paths).toContain("scripts/mobile-ios-compile-verification.ts");
});

test("offline container validation is manual, exact-main, credential-free and cannot claim full or deployment success", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(".github/workflows/native-validation.yml").text(),
  ) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: {
      native: {
        if: string;
        steps: {
          name?: string;
          run?: string;
          uses?: string;
          with?: Record<string, unknown>;
          env?: Record<string, string>;
          "continue-on-error"?: boolean;
        }[];
      };
    };
  };
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.jobs.native.if).toBe("github.ref == 'refs/heads/main'");
  const steps = workflow.jobs.native.steps;
  const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  expect(checkout?.with).toMatchObject({
    ref: "${{ inputs.target_sha }}",
    "fetch-depth": 0,
    "persist-credentials": false,
  });
  const verify = steps.findIndex((step) => step.name === "Verify exact checkout and main ancestry");
  const native = steps.findIndex((step) => step.run === "bun run validate:native");
  const record = steps.findIndex((step) => step.name === "Record scoped success");
  expect(verify).toBeLessThan(native);
  expect(native).toBeLessThan(record);
  expect(steps[verify]?.run).toContain('test "$(git rev-parse HEAD)" = "$TARGET_SHA"');
  expect(steps[verify]?.run).toContain("git merge-base --is-ancestor");
  expect(steps[record]?.run).toContain("fullValidationPassed:false");
  expect(steps[record]?.run).toContain("providerAcceptanceVerified:false");
  for (const step of steps) {
    expect(step["continue-on-error"]).not.toBe(true);
    expect(JSON.stringify(step)).not.toContain("secrets.");
    expect(step.run ?? "").not.toMatch(
      /\bwrangler\s+deploy\b|full-validation-receipt|bun audit.*ignore/,
    );
  }
});
