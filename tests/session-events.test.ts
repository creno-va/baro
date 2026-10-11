import { expect, test } from "bun:test";
import { isExplicitSignOut } from "../src/client/session-events";

const storage = (key: string, newValue: string | null) =>
  Object.assign(new Event("storage"), { key, newValue });

test("only explicit local signout invalidation is distinguished from session changes", () => {
  expect(
    isExplicitSignOut(new CustomEvent("baro-session-changed", { detail: { reason: "signout" } })),
  ).toBe(true);
  expect(
    isExplicitSignOut(new CustomEvent("baro-session-changed", { detail: { reason: "changed" } })),
  ).toBe(false);
  expect(isExplicitSignOut(new Event("baro-session-changed"))).toBe(false);
});

test("peer signout and native Better Auth signout revoke access without carrying identity", () => {
  expect(
    isExplicitSignOut(
      storage("baro-session-changed", JSON.stringify({ id: "synthetic-nonce", reason: "signout" })),
    ),
  ).toBe(true);
  expect(
    isExplicitSignOut(
      storage(
        "better-auth.message",
        JSON.stringify({ event: "session", data: { trigger: "signout" } }),
      ),
    ),
  ).toBe(true);
  expect(
    isExplicitSignOut(
      storage(
        "better-auth.message",
        JSON.stringify({ event: "session", data: { trigger: "signin" } }),
      ),
    ),
  ).toBe(false);
});

test("old nonces, storage clearing, malformed messages and unrelated data require ordinary session verification", () => {
  for (const value of [null, "synthetic-uuid", "{", "null", "false", "[]", '{"reason":"changed"}'])
    expect(isExplicitSignOut(storage("baro-session-changed", value))).toBe(false);
  expect(isExplicitSignOut(storage("unrelated", '{"reason":"signout"}'))).toBe(false);
  expect(isExplicitSignOut(new Event("focus"))).toBe(false);
});
