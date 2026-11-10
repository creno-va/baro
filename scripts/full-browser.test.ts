import { expect, test } from "bun:test";
import { fullBrowserParts, fullBrowserTargets } from "./full-browser";

test("CI browser parts cover the actual complete corpus once, retaining the integrated journey", () => {
  const catalog = [...new Bun.Glob("tests/browser/*.e2e.ts").scanSync(".")];
  const full = fullBrowserTargets(catalog);
  const parts = fullBrowserParts.map((part) => fullBrowserTargets(catalog, part));
  expect(parts.every((part) => part.length > 0)).toBe(true);
  expect(parts.flat().sort()).toEqual(full);
  expect(new Set(parts.flat()).size).toBe(full.length);
  expect(parts[2]).toEqual(["tests/browser/rework-conversation.e2e.ts"]);
  expect(
    fullBrowserTargets(
      catalog.map((path) => path.replaceAll("/", "\\")),
      "screens-1",
    ),
  ).toEqual(parts[0] ?? []);
});

test("missing, duplicated and unknown browser coverage fails closed", () => {
  const catalog = [...new Bun.Glob("tests/browser/*.e2e.ts").scanSync(".")];
  expect(() => fullBrowserTargets([], "screens-1")).toThrow("BROWSER_TESTS_MISSING");
  expect(() => fullBrowserTargets([...catalog, catalog[0] ?? ""], "screens-1")).toThrow(
    "BROWSER_TESTS_DUPLICATE",
  );
  expect(() => fullBrowserTargets(["tests/browser/landing.e2e.ts"], "screens-1")).toThrow(
    "BROWSER_JOURNEYS_MISSING",
  );
  for (const part of ["", "screens-3", "skip", "all"])
    expect(() => fullBrowserTargets(catalog, part)).toThrow("BROWSER_PART_INVALID");
});
