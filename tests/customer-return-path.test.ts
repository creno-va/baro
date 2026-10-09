import { expect, test } from "bun:test";
import { accessHref, safeReturnPath, sessionDestination } from "../src/client/return-path";

test("login and consent retain only allowed local case paths and the selected role", () => {
  const path = "/cases/synthetic-case/files";
  expect(accessHref("login", path)).toBe("/login?returnTo=%2Fcases%2Fsynthetic-case%2Ffiles");
  const user = { id: "synthetic", name: "합성", accountType: "customer" as const };
  expect(sessionDestination({ user, needsConsent: true }, path)).toBe(
    "/consent?returnTo=%2Fcases%2Fsynthetic-case%2Ffiles",
  );
  expect(sessionDestination({ user, needsConsent: false }, path)).toBe(path);
  expect(
    sessionDestination({ user: { ...user, accountType: "lawyer" }, needsConsent: false }, path),
  ).toBe("/lawyer");
  for (const value of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/cases/../login",
    "/cases/%2e%2e/login",
    "/cases/a?returnTo=https://evil.test",
    "/cases/a#external",
    "/api/auth/sign-out",
    "/cases/a\n",
  ]) {
    expect(safeReturnPath(value)).toBeNull();
  }
});
