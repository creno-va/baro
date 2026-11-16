import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  activeFoundationImportFindings,
  collectFoundationChanges,
  foundationChangeFindings,
  foundationConfigAllowed,
  foundationImportFindings,
  foundationPackageAllowed,
  foundationTokenCSSFindings,
  foundationValidationAllowed,
  productUIFixtureRoute,
  repositoryPath,
} from "../scripts/check-product-ui-foundation";

describe("initial foundation PR scope", () => {
  test("landing, active runtime, shared visual and backend/mobile changes are protected", () => {
    const paths = [
      "src/pages/index.astro",
      "src/pages/cases/[caseId]/precedents.astro",
      "src/layouts/BaseLayout.astro",
      "src/components/ui/brand.tsx",
      "src/styles/global.css",
      "src/client/landing-time.ts",
      "src/client/api/session.ts",
      "src/server/api/v2/reports.ts",
      "src/contracts/v2/resolution.ts",
      "src/workflows/workspace.ts",
      "src/worker.ts",
      "public/landing/hero-continuous.mp4",
      "public/fonts/PretendardVariable.woff2",
      "drizzle/0020_expand.sql",
      "services/file-processor/report.py",
      "apps/mobile/src/App.tsx",
      "packages/api-client/src/rework.ts",
      ".github/workflows/ci.yml",
      "tests/browser/product-ui.e2e.ts",
      "scripts/check-boundaries.ts",
    ];
    expect(
      foundationChangeFindings(
        paths.map((path) => ({ path, status: "M", existedAtBase: true })),
      ).map((finding) => finding.path),
    ).toEqual(paths);
    expect(
      foundationChangeFindings([
        { path: "src/pages/new.astro", status: "D", existedAtBase: true },
        { path: "public/landing/new-asset.mp4", status: "A", existedAtBase: false },
      ]),
    ).toHaveLength(2);
  });

  test("new isolated source, bounded test tooling and documentation are accepted", () => {
    const paths = [
      "docs/development/WEB-UI-REBUILD-PLAN.md",
      "docs/quality/ui-foundation-baseline/landing.jpg",
      "src/product-ui/Shell.tsx",
      "src/product-ui/tokens.css",
      "tests/product-ui-boundary.test.ts",
      "tests/product-ui-dialog.test.tsx",
      "tests/helpers/product-ui-page.astro",
      "tests/helpers/product-ui-fixture.tsx",
      "tests/helpers/product-ui-fixture.css",
      "tests/browser/product-ui-foundation.e2e.ts",
      "scripts/check-product-ui-foundation.ts",
      "scripts/measure-web-query-baseline.ts",
    ];
    expect(
      foundationChangeFindings(paths.map((path) => ({ path, status: "A", existedAtBase: false }))),
    ).toEqual([]);
    expect(
      foundationChangeFindings([
        { path: "tests/product-ui-state.test.ts", status: "M", existedAtBase: true },
      ]),
    ).toHaveLength(1);
  });

  test("Windows separators cannot bypass protected paths and traversal is rejected", () => {
    expect(repositoryPath(".\\src\\server\\api.ts")).toBe("src/server/api.ts");
    for (const path of [
      "../src/server/api.ts",
      "src/product-ui/../server/api.ts",
      "/src/a",
      "C:\\a",
      "a\nfile",
    ])
      expect(repositoryPath(path)).toBeNull();
    expect(
      foundationChangeFindings([
        { path: "src\\layouts\\BaseLayout.astro", status: "M", existedAtBase: true },
      ]),
    ).toHaveLength(1);
  });

  test("package additions cannot modify existing runtime versions, scripts or configuration", () => {
    const base = {
      name: "synthetic-project",
      dependencies: { react: "19.3.0", zod: "4.6.6" },
      scripts: { check: "bun scripts/validate.ts quick" },
      workspaces: ["apps/*", "packages/*"],
    };
    const candidate = {
      ...base,
      dependencies: { ...base.dependencies, "@tanstack/react-query": "5.107.1", zustand: "5.1.0" },
      scripts: {
        ...base.scripts,
        "product-ui:check":
          "bun scripts/check-product-ui-foundation.ts && bun test tests/product-ui-",
        "product-ui:measure": "bun scripts/measure-web-query-baseline.ts",
      },
    };
    expect(foundationPackageAllowed(base, candidate)).toBe(true);
    expect(foundationPackageAllowed(base, { ...candidate, workspaces: ["apps/*"] })).toBe(false);
    expect(
      foundationPackageAllowed(base, {
        ...candidate,
        dependencies: { ...candidate.dependencies, react: "changed" },
      }),
    ).toBe(false);
    expect(
      foundationPackageAllowed(base, {
        ...candidate,
        dependencies: { ...candidate.dependencies, zustand: "*" },
      }),
    ).toBe(false);
    expect(
      foundationPackageAllowed(base, {
        ...candidate,
        scripts: { ...candidate.scripts, check: "true" },
      }),
    ).toBe(false);
    expect(
      foundationPackageAllowed(base, {
        ...candidate,
        scripts: { ...candidate.scripts, "product-ui:check": "bun scripts/deploy.ts production" },
      }),
    ).toBe(false);
  });
});

describe("bounded fixture and validation additions", () => {
  const design = `                injectRoute({
                  pattern: "/__design-system",
                  entrypoint: fileURLToPath(
                    new URL("./tests/helpers/design-system-page.astro", import.meta.url),
                  ),
                });`;

  test("only the additional fixture route preserves every existing configuration byte", () => {
    const base = `if (syntheticFixture) {\n${design}\n}\n`;
    const candidate = base.replace(design, `${design}\n${productUIFixtureRoute}`);
    expect(foundationConfigAllowed(base, base)).toBe(true);
    expect(foundationConfigAllowed(base, candidate)).toBe(true);
    expect(foundationConfigAllowed(base, `${base}${productUIFixtureRoute}`)).toBe(false);
    expect(foundationConfigAllowed(base, candidate.replace("syntheticFixture", "true"))).toBe(
      false,
    );
    expect(foundationConfigAllowed(base, candidate.replace("/__product-ui", "/product-ui"))).toBe(
      false,
    );
    expect(
      foundationConfigAllowed(base, candidate.replace("product-ui-page.astro", "other.astro")),
    ).toBe(false);
  });

  test("adding the bounded test prefix cannot remove or weaken existing commands", () => {
    const base = 'const quick = [\n      "tests/rework-",\n      "tests/legal-analysis",\n];\n';
    const candidate = base.replace(
      '      "tests/rework-",',
      '      "tests/rework-",\n      "tests/product-ui-",',
    );
    expect(foundationValidationAllowed(base, candidate)).toBe(true);
    expect(
      foundationValidationAllowed(base, candidate.replace('      "tests/legal-analysis",\n', "")),
    ).toBe(false);
    expect(foundationValidationAllowed(base, `${candidate}\nprocess.exit(0);`)).toBe(false);
  });
});

describe("isolated foundation source and tokens", () => {
  test("static local graph and reviewed UI libraries cannot reach transport, server or fixtures", () => {
    const file = "src/product-ui/Shell.tsx";
    expect(
      foundationImportFindings(
        file,
        'import { useState } from "react"; import "./tokens.css"; export { Button } from "./Button";',
      ),
    ).toEqual([]);
    for (const source of [
      'import { api } from "../client/api";',
      'export * from "@/server/auth";',
      'export * from "@/product-ui/../../client/api";',
      String.raw`import { api } from "..\\client\\api";`,
      'import type { Case } from "@baro/api-client";',
      'import type Legacy = require("../client/api");',
      'type Legacy = import("../client/api").CaseView;',
      'const fixture = require("../../tests/helpers/product-ui-fixture");',
      'const prior = import("../components/workspace/Workspace");',
      'const modules = import.meta.glob("../**/*.ts");',
      "const module = import(target);",
      'const pending = fetch("/api/me/session");',
      'import { persist } from "zustand/middleware";',
    ])
      expect(foundationImportFindings(file, source).length).toBeGreaterThan(0);
    expect(
      foundationImportFindings(file, '// import "../server/private"\nconst label = "fetch";'),
    ).toEqual([]);
  });

  test("active Astro scripts and aliases cannot silently wire the isolated preview into runtime", () => {
    for (const [file, source] of [
      ["src/pages/new.astro", '---\nimport Shell from "../product-ui/Shell";\n---\n<Shell />'],
      ["src/components/Entry.tsx", 'export { Shell } from "@/product-ui/Shell";'],
      ["src/pages/index.astro", '<script>void import("../product-ui/Shell");</script>'],
    ])
      expect(activeFoundationImportFindings(file ?? "", source ?? "")).toEqual([
        "foundation_wired_into_active_entry",
      ]);
    expect(
      activeFoundationImportFindings(
        "src/layouts/BaseLayout.astro",
        '---\nimport "../styles/global.css";\n---\n<slot />',
      ),
    ).toEqual([]);
  });

  test("display-state schema cannot accept private fields or persistence in this phase", () => {
    const file = "src/product-ui/state.ts";
    const safe =
      'const productUIStateSchema = z.strictObject({ sidebarCollapsed: z.boolean(), theme: z.enum(["light", "dark"]) });';
    expect(foundationImportFindings(file, safe)).toEqual([]);
    for (const extra of [
      "caseId: z.string()",
      "messages: z.array(z.string())",
      "session: z.unknown()",
      "...privateState",
    ])
      expect(
        foundationImportFindings(
          file,
          safe.replace("sidebarCollapsed:", `${extra}, sidebarCollapsed:`),
        ),
      ).toContain("ui_store_non_display_field");
    expect(
      foundationImportFindings(
        file,
        `${safe}\nlocalStorage.setItem("state", JSON.stringify(state));`,
      ),
    ).toContain("ui_store_persistence");
  });

  test("tokens stay on the explicit root with no selector, rule or declaration escapes", () => {
    expect(
      foundationTokenCSSFindings(
        '/* scoped */\n[data-product-ui] { --surface: #fff; --space: 1rem; }\n[data-product-ui][data-theme="dark"] { --surface: #111; }',
      ),
    ).toEqual([]);
    for (const css of [
      "[data-product-ui], body { --surface: #fff; }",
      ":root { --surface: #fff; }",
      ":is([data-product-ui], body) { --surface: #fff; }",
      ":where([data-product-ui]) body { --surface: #fff; }",
      "[data-product-ui] ~ body { --surface: #fff; }",
      "[data-product-ui]:has(body) { --surface: #fff; }",
      "[data-product-ui] { margin: 0; }",
      '@import "../styles/global.css";',
      "@font-face { font-family: x; }",
      "@media (prefers-color-scheme: dark) { [data-product-ui] { --surface: #111; } }",
      '[data-product-ui] { --asset: url("/private"); }',
      '[data-product-ui] { --asset: u\\72l("/private"); }',
      "[data-product-ui] { --surface: #fff; } body { color: red; }",
    ])
      expect(foundationTokenCSSFindings(css).length).toBeGreaterThan(0);
  });
});

const directories: string[] = [];
afterAll(async () => {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
});
async function runGit(root: string, args: string[]) {
  const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [output, error] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if ((await child.exited) !== 0) throw new Error(error);
  return output.trim();
}

test("real Git comparison includes committed, staged, unstaged, deleted and untracked protected paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "baro-foundation-boundary-"));
  directories.push(root);
  await mkdir(join(root, "public/landing"), { recursive: true });
  await mkdir(join(root, "src/pages"), { recursive: true });
  await writeFile(join(root, "public/landing/film.mp4"), new Uint8Array([0, 1, 2, 3]));
  await writeFile(join(root, "src/pages/index.astro"), "synthetic baseline\n");
  await runGit(root, ["init", "--quiet"]);
  await runGit(root, ["add", "."]);
  const commit = [
    "-c",
    "user.name=Boundary Fixture",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "synthetic fixture",
  ];
  await runGit(root, commit);
  const base = await runGit(root, ["rev-parse", "HEAD"]);
  await writeFile(join(root, "src/pages/index.astro"), "committed changed entry\n");
  await runGit(root, ["add", "."]);
  await runGit(root, commit);
  await rename(join(root, "public/landing/film.mp4"), join(root, "public/landing/moved.mp4"));
  await runGit(root, ["add", "public"]);
  await writeFile(join(root, "src/pages/index.astro"), "unstaged changed entry\n");
  await mkdir(join(root, "src/server"));
  await writeFile(join(root, "src/server/new.ts"), "export const synthetic = true;\n");
  await mkdir(join(root, "src/product-ui"));
  await writeFile(join(root, "src/product-ui/Button.tsx"), "export const Button = () => null;\n");
  const changes = await collectFoundationChanges(root, base);
  expect(changes).toEqual(
    expect.arrayContaining([
      { path: "src/pages/index.astro", status: "M", existedAtBase: true },
      { path: "public/landing/film.mp4", status: "D", existedAtBase: true },
      { path: "public/landing/moved.mp4", status: "A", existedAtBase: false },
      { path: "src/server/new.ts", status: "A", existedAtBase: false },
    ]),
  );
  expect(
    foundationChangeFindings(changes)
      .map((finding) => finding.path)
      .sort(),
  ).toEqual([
    "public/landing/film.mp4",
    "public/landing/moved.mp4",
    "src/pages/index.astro",
    "src/server/new.ts",
  ]);
});
