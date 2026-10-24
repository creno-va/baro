import { resolve } from "node:path";

type Command = string[];
export const validationProfiles = [
  "quick",
  "changed",
  "unit",
  "browser",
  "build",
  "db",
  "native",
  "security",
  "full",
] as const;
export type ValidationProfile = (typeof validationProfiles)[number];

export function validationCommands(profile: string, root = process.cwd()): Command[] {
  const quick = [
    ["bun", "run", "docs:check"],
    ["bun", "run", "work:check"],
    ["bun", "run", "boundaries:check"],
    ["bun", "run", "security:patches"],
    ["bun", "run", "lint"],
    ["bun", "run", "typecheck"],
    ["bun", "run", "mobile:check"],
    [
      "bun",
      "test",
      "tests/workflows.test.ts",
      "tests/dependency-security-updates.test.ts",
      "tests/cli-zod-observation.test.ts",
      "tests/ai-preflight-workflow.test.ts",
      "tests/session-owner-fence.test.ts",
      "scripts/validate.test.ts",
      "scripts/deploy.test.ts",
      "scripts/verify-release.test.ts",
      "tests/native-auth-codes.test.ts",
      "tests/native-auth-http.test.ts",
      "tests/native-reauth.test.ts",
      "tests/native-reauth-http.test.ts",
      "tests/mobile-auth-versioning.test.ts",
      "tests/apple-identity.test.ts",
      "tests/apple-configuration.test.ts",
      "tests/apple-callback.test.ts",
      "tests/apple-revoke.test.ts",
      "tests/native-deletion.test.ts",
      "tests/native-deletion-http.test.ts",
      "tests/mobile-ios-accessibility.test.ts",
      "tests/mobile-ios-auth-cancel.test.ts",
      "tests/mobile-ios-directory-ui.test.ts",
      "tests/mobile-ios-korean-directory.test.ts",
      "tests/mobile-ios-korean-settings-owner.test.ts",
      "tests/mobile-ios-keyboard-reference.test.ts",
      "tests/mobile-ios-directory-signature.test.ts",
      "tests/mobile-ios-input-reference.test.ts",
      "tests/mobile-ios-text-input-patch.test.ts",
      "tests/mobile-ios-device-sdk.test.ts",
      "tests/mobile-android-auth-cancel.test.ts",
      "tests/mobile-android-auth-hierarchy.test.ts",
      "tests/mobile-android-directory-input.test.ts",
      "tests/mobile-android-command-observation.test.ts",
      "tests/mobile-android-launcher-baseline.test.ts",
      "tests/mobile-android-package-readiness.test.ts",
      "tests/mobile-android-chrome-fixture.test.ts",
    ],
  ];
  const build = [
    ["bun", "run", "build:production"],
    ["bun", "run", "bundle:check"],
    ["bun", "run", "cf:dry-run"],
    ["bun", "scripts/check-built-runtime.ts"],
  ];
  const database = [
    ["bun", "run", "db:check"],
    [
      "bunx",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      ".wrangler/validation-migration",
    ],
    [
      "bun",
      "scripts/apply-d1-migrations.ts",
      "preview",
      "--local",
      "--persist-to",
      ".wrangler/validation-file-import",
    ],
    [
      "bun",
      "scripts/apply-d1-migrations.ts",
      "preview",
      "--local",
      "--persist-to",
      ".wrangler/validation-file-import",
    ],
  ];
  const native = [
    [
      "docker",
      "build",
      "--platform",
      "linux/amd64",
      "-f",
      "services/file-processor/Dockerfile",
      "-t",
      "baro-file-processor",
      ".",
    ],
    [
      "docker",
      "run",
      "--rm",
      "--network",
      "none",
      "--memory",
      "6g",
      "--cpus",
      "1",
      "--pids-limit",
      "128",
      "-v",
      `${resolve(root, "tests/fixtures/media")}:/fixtures:ro`,
      "-v",
      `${resolve(root, "services/file-processor/fixture-test.py")}:/app/fixture-test.py:ro`,
      "baro-file-processor",
      "python3",
      "/app/fixture-test.py",
    ],
    [
      "docker",
      "run",
      "--rm",
      "--network",
      "none",
      "--memory",
      "512m",
      "--cpus",
      "1",
      "--pids-limit",
      "128",
      "-v",
      `${resolve(root, "services/file-processor/performance-test.py")}:/app/performance-test.py:ro`,
      "baro-file-processor",
      "python3",
      "/app/performance-test.py",
      "--require-video",
    ],
    ["bun", "scripts/report-native-fixture.ts"],
    [
      "docker",
      "run",
      "--rm",
      "--network",
      "none",
      "--memory",
      "6g",
      "--cpus",
      "1",
      "--pids-limit",
      "128",
      "-v",
      `${resolve(root, ".wrangler/report-native")}:/report-fixture`,
      "-v",
      `${resolve(root, "services/file-processor/report-test.py")}:/app/report-test.py:ro`,
      "baro-file-processor",
      "python3",
      "/app/report-test.py",
    ],
    ...["office-security-test.py", "heif-fixture-test.py", "office-fixture-test.py"].map(
      (script) => [
        "docker",
        "run",
        "--rm",
        "--network",
        "none",
        "--memory",
        "6g",
        "--cpus",
        "1",
        "--pids-limit",
        "128",
        "-v",
        `${resolve(root, "tests/fixtures/media")}:/fixtures:ro`,
        "-v",
        `${resolve(root, "tests/fixtures/native-documents")}:/document-fixtures:ro`,
        "-v",
        `${resolve(root, `services/file-processor/${script}`)}:/app/${script}:ro`,
        "baro-file-processor",
        "python3",
        `/app/${script}`,
      ],
    ),
  ];
  const security = [
    ["bun", "audit"],
    ["gitleaks", "git", "--log-opts=HEAD", "--redact=100", "--no-banner", "--log-level", "warn"],
  ];
  switch (profile) {
    case "quick":
      return quick;
    case "changed":
      return [["bun", "scripts/development-checks.ts", "unit"]];
    case "unit":
      return [["bun", "test"]];
    case "browser":
      return [
        ...build.slice(0, 2),
        ["bun", "scripts/development-checks.ts", "browser"],
        ["bun", "run", "test:csp"],
      ];
    case "build":
      return build;
    case "db":
      return database;
    case "native":
      return native;
    case "security":
      return security;
    case "full":
      return [
        ...quick,
        ["bun", "test"],
        ...database,
        ["bun", "run", "eval:offline"],
        ...build,
        ["bun", "scripts/full-browser.ts"],
        ["bun", "run", "test:csp"],
        ...security,
        ...native,
      ];
    default:
      throw new Error(`Unknown validation profile: ${profile}`);
  }
}

export async function executeValidation(
  commands: Command[],
  execute: (command: Command) => Promise<number>,
) {
  for (const command of commands) {
    const code = await execute(command);
    if (code !== 0) return code;
  }
  return 0;
}

if (import.meta.main) {
  const [profile = "quick", base, ...extra] = process.argv.slice(2);
  if (profile === "--help") {
    console.log(
      `bun run validate <${validationProfiles.join("|")}> [base-ref]\nbase-ref is only accepted by changed/browser; their default is origin/main plus local edits.\nBrowser profiles require: bunx playwright install chromium\nSecurity/full require gitleaks; native/full require Docker.`,
    );
  } else {
    if (extra.length || (base && !["changed", "browser"].includes(profile)))
      throw new Error("base-ref is only supported by changed/browser");
    if (base) process.env.CHECK_BASE_SHA = base;
    process.exitCode = await executeValidation(validationCommands(profile), async (command) => {
      console.log(`\n> ${command.join(" ")}`);
      const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
      return child.exited;
    });
  }
}
