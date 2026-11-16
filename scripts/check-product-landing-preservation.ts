import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  collectProductShellChanges,
  type ProductShellChange,
  type ProductShellFinding,
} from "./check-product-shell-preservation";

/** Current landing design-port acceptance; prior product phase guards remain
 * historical. Behavior, CSP and visual equivalence require their own checks. */
export const PRODUCT_LANDING_BASE = "b5138bbf1ba2c2f99fe5aec9c0058968de0e9868";
export const landingLegacyPaths = [
  "src/client/landing-blue-reveal.ts",
  "src/client/landing-ceo.ts",
  "src/client/landing-clarity.ts",
  "src/client/landing-demo.ts",
  "src/client/landing-finale.ts",
  "src/client/landing-future.ts",
  "src/client/landing-journey.ts",
  "src/client/landing-logo.ts",
  "src/client/landing-navigation.ts",
  "src/client/landing-origin.ts",
  "src/client/landing-phone.ts",
  "src/client/landing-time.ts",
  "src/client/landing.ts",
  "src/components/landing/BenefitFilm.astro",
  "src/components/landing/BlueAppReveal.astro",
  "src/components/landing/CeoGreeting.astro",
  "src/components/landing/DemoLab.astro",
  "src/components/landing/EverydayFuture.astro",
  "src/components/landing/EverydayStories.astro",
  "src/components/landing/FinalExperience.astro",
  "src/components/landing/HeroFilm.astro",
  "src/components/landing/LandingNavigation.astro",
  "src/components/landing/LogoExperience.astro",
  "src/components/landing/OriginExperience.astro",
  "src/components/landing/PainToClarity.astro",
  "src/components/landing/PhoneStory.astro",
  "src/components/landing/TimeExperience.astro",
  "src/styles/landing-blue-reveal.css",
  "src/styles/landing-ceo.css",
  "src/styles/landing-clarity.css",
  "src/styles/landing-demo.css",
  "src/styles/landing-film.css",
  "src/styles/landing-finale.css",
  "src/styles/landing-future.css",
  "src/styles/landing-journey.css",
  "src/styles/landing-logo.css",
  "src/styles/landing-navigation.css",
  "src/styles/landing-origin.css",
  "src/styles/landing-phone.css",
  "src/styles/landing-refinement.css",
  "src/styles/landing-stories.css",
  "src/styles/landing-time.css",
  "src/styles/landing.css",
] as const;
export const landingNewSourcePaths = [
  "src/product-ui/landing/DemoLab.tsx",
  "src/product-ui/landing/LandingBrand.tsx",
  "src/product-ui/landing/LandingLink.tsx",
  "src/product-ui/landing/LandingNavigation.tsx",
  "src/product-ui/landing/LandingPage.astro",
  "src/product-ui/landing/demo-content.ts",
  "src/product-ui/landing/scene-classes.ts",
  "src/product-ui/landing/motion/blue.ts",
  "src/product-ui/landing/motion/ceo.ts",
  "src/product-ui/landing/motion/clarity.ts",
  "src/product-ui/landing/motion/finale.ts",
  "src/product-ui/landing/motion/future.ts",
  "src/product-ui/landing/motion/index.ts",
  "src/product-ui/landing/motion/journey.ts",
  "src/product-ui/landing/motion/logo.ts",
  "src/product-ui/landing/motion/origin.ts",
  "src/product-ui/landing/motion/phone.ts",
  "src/product-ui/landing/motion/time.ts",
  "src/product-ui/landing/scenes/BlueScene.tsx",
  "src/product-ui/landing/scenes/CeoScene.tsx",
  "src/product-ui/landing/scenes/ClarityScene.tsx",
  "src/product-ui/landing/scenes/EverydayScene.tsx",
  "src/product-ui/landing/scenes/FinaleScene.tsx",
  "src/product-ui/landing/scenes/FutureScene.tsx",
  "src/product-ui/landing/scenes/HeroScene.tsx",
  "src/product-ui/landing/scenes/LogoScene.tsx",
  "src/product-ui/landing/scenes/OriginScene.tsx",
  "src/product-ui/landing/scenes/PhoneScene.tsx",
  "src/product-ui/landing/scenes/TimeScene.tsx",
  "src/product-ui/landing/styles/base.css",
  "src/product-ui/landing/styles/blue.css",
  "src/product-ui/landing/styles/ceo.css",
  "src/product-ui/landing/styles/clarity.css",
  "src/product-ui/landing/styles/demo.css",
  "src/product-ui/landing/styles/finale.css",
  "src/product-ui/landing/styles/future.css",
  "src/product-ui/landing/styles/index.css",
  "src/product-ui/landing/styles/journey.css",
  "src/product-ui/landing/styles/landing.css",
  "src/product-ui/landing/styles/logo.css",
  "src/product-ui/landing/styles/navigation.css",
  "src/product-ui/landing/styles/origin.css",
  "src/product-ui/landing/styles/phone.css",
  "src/product-ui/landing/styles/refinement.css",
  "src/product-ui/landing/styles/stories.css",
  "src/product-ui/landing/styles/time.css",
] as const;
const retired = new Set<string>(landingLegacyPaths);
const additions = new Set<string>([
  ...landingNewSourcePaths,
  "src/layouts/LandingLayout.astro",
  "tests/product-ui-landing.test.tsx",
  "scripts/check-product-landing-preservation.ts",
  "tests/product-ui-landing-preservation.test.ts",
]);
const existing = new Set(["src/pages/index.astro", "package.json", "tests/browser/landing.e2e.ts"]);

export function landingChangeFindings(
  changes: readonly ProductShellChange[],
): ProductShellFinding[] {
  return changes.flatMap(({ path, status, existedAtBase }) => {
    if (
      !path ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((part) => !part || part === "." || part === "..") ||
      [...path].some((character) => character.charCodeAt(0) < 32)
    )
      return [{ path, code: "invalid_repository_path" }];
    if (retired.has(path))
      return status === "D" && existedAtBase
        ? []
        : [{ path, code: "landing_legacy_path_not_removed" }];
    if (!["A", "M"].includes(status))
      return [{ path, code: "unapproved_landing_removal_or_type_change" }];
    return path.startsWith("docs/") || (existedAtBase ? existing.has(path) : additions.has(path))
      ? []
      : [{ path, code: "outside_product_landing_scope" }];
  });
}
export function landingPackageAllowed(base: unknown, candidate: unknown) {
  if (isDeepStrictEqual(base, candidate)) return true;
  if (!base || !candidate || typeof base !== "object" || typeof candidate !== "object")
    return false;
  const prior = base as { scripts?: Record<string, unknown> };
  const next = structuredClone(candidate) as typeof prior;
  const command = "bun scripts/check-product-landing-preservation.ts";
  if (
    !prior.scripts ||
    !next.scripts ||
    Array.isArray(next.scripts) ||
    prior.scripts["product-ui:check"] !== "bun scripts/check-product-details-preservation.ts" ||
    Object.hasOwn(prior.scripts, "product-landing:check") ||
    next.scripts["product-ui:check"] !== command ||
    next.scripts["product-landing:check"] !== command
  )
    return false;
  next.scripts["product-ui:check"] = prior.scripts["product-ui:check"];
  delete next.scripts["product-landing:check"];
  return isDeepStrictEqual(base, next);
}

/** Authoritative accepted patch: six unique replacements from the independently
 * reviewed landing.e2e.ts diff against b5138bbf. Every other byte stays exact. */
export const landingBrowserReplacements: readonly (readonly [string, string])[] = [
  [
    '  await page.keyboard.press("Enter");\n  await expect(menu).toHaveAttribute("open", "");',
    '  await page.keyboard.press("Enter");\n  await expect(menu).toHaveAttribute("aria-modal", "true");',
  ],
  [
    '    await expect(fallback).toHaveAttribute("open", "");',
    '    await expect(fallback).toHaveAttribute("open", "");\n    const nativeLink = fallback.getByRole("link", { name: "앱 둘러보기", exact: true });\n    await expect(nativeLink).toHaveAttribute("href", "#blue-app-reveal");\n    await nativeLink.focus();\n    await expect(nativeLink).toBeFocused();',
  ],
  [
    '  await expect(fallback).not.toHaveAttribute("open", "");',
    "  await expect(fallback).toHaveCount(0);",
  ],
  [
    '  await expect(page.locator("[data-landing-menu-trigger]")).toBeVisible();',
    '  await expect(page.locator("[data-landing-menu-trigger]")).toBeVisible();\n  await expect(page.locator("[data-landing-menu-trigger]")).toBeFocused();',
  ],
  [
    '  await expect(page.locator("[data-landing-menu-dialog]")).not.toHaveAttribute("open", "");',
    '  await expect(page.locator("[data-landing-menu-dialog]")).toBeHidden();',
  ],
  [
    '    await expect.poll(() => menu.evaluate((element) => element.matches(":modal"))).toBe(true);',
    '    // Headless Dialog supplies modal semantics and inerts the actual page root.\n    await expect(menu).toHaveAttribute("aria-modal", "true");\n    await expect(page.locator(".landing")).toHaveAttribute("inert", "");\n    await expect(page.locator(".landing")).toHaveAttribute("aria-hidden", "true");',
  ],
];
export function landingBrowserExpected(base: string) {
  let next = base;
  for (const [before, after] of landingBrowserReplacements) {
    if (next.split(before).length !== 2) return null;
    next = next.replace(before, after);
  }
  return next;
}
export function landingBrowserAllowed(base: string, candidate: string) {
  return candidate === base || candidate === landingBrowserExpected(base);
}
async function gitFile(root: string, revision: string) {
  const child = Bun.spawn(["git", "show", revision], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [output] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return (await child.exited) === 0 ? output : null;
}
export async function checkProductLandingPreservation(root: string, base = PRODUCT_LANDING_BASE) {
  const { sha, changes } = await collectProductShellChanges(root, base);
  const findings = landingChangeFindings(changes);
  const paths = [...new Set(changes.map(({ path }) => path))];
  for (const path of paths) {
    const stat = await lstat(join(root, path)).catch(() => null);
    if (
      retired.has(path) &&
      changes.filter((change) => change.path === path).every((change) => change.status === "D")
    ) {
      if (stat) findings.push({ path, code: "landing_legacy_path_still_exists" });
    } else if (!stat?.isFile()) findings.push({ path, code: "landing_regular_file_required" });
  }
  for (const path of ["package.json", "tests/browser/landing.e2e.ts"]) {
    if (!paths.includes(path)) continue;
    const before = await gitFile(root, `${sha}:${path}`);
    const candidates = await Promise.all([
      gitFile(root, `HEAD:${path}`),
      gitFile(root, `:${path}`),
      readFile(join(root, path), "utf8").catch(() => null),
    ]);
    if (
      !candidates.every((candidate) => {
        if (before === null || candidate === null) return false;
        try {
          return path === "package.json"
            ? landingPackageAllowed(JSON.parse(before), JSON.parse(candidate))
            : landingBrowserAllowed(before, candidate);
        } catch {
          return false;
        }
      })
    )
      findings.push({ path, code: "unapproved_landing_integration_patch" });
  }
  return { changes: paths.length, findings };
}
if (import.meta.main) {
  if (process.argv.length > 3) throw new Error("PRODUCT_LANDING_EXPECTS_ONE_BASE_REF");
  const result = await checkProductLandingPreservation(
    process.cwd(),
    process.argv[2] ?? PRODUCT_LANDING_BASE,
  );
  if (result.findings.length) {
    for (const finding of result.findings) console.error(`${finding.path}: ${finding.code}`);
    process.exitCode = 1;
  } else console.log(`Product landing preservation passed (${result.changes} changed paths)`);
}
