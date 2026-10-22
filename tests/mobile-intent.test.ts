import { expect, test } from "bun:test";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import { rewriteNativeIntent } from "../apps/mobile/src/platform/auth/intent";
import { createAuthReturnQueue } from "../apps/mobile/src/platform/auth/return-queue";

const config = resolveMobileConfig({ environment: "preview" });
const returned = `baro-preview://auth/callback?attemptId=15a64c18-fd51-4f83-8205-4c917a245e6b&code=${"a".repeat(43)}`;
test("cold/warm native intents never forward auth material into route params or fragments", () => {
  const seen: string[] = [];
  expect(rewriteNativeIntent(returned, config, (value) => seen.push(value))).toBe("/session");
  expect(seen).toEqual([returned]);
  for (const path of [
    `${returned}&cookie=SYNTHETIC_SECRET`,
    returned.replace("baro-preview:", "baro:"),
    "/directory?token=SYNTHETIC_SECRET#code=private",
    "/unknown?code=private",
    "not a URL",
  ]) {
    const route = rewriteNativeIntent(path, config, (value) => seen.push(value));
    expect(route).not.toMatch(/[?#]/);
    expect(route).not.toContain("SYNTHETIC_SECRET");
  }
  expect(seen).toEqual([returned]);
});
test("return handoff is bounded, ephemeral, deduplicated and detachable", async () => {
  const queue = createAuthReturnQueue(),
    seen: string[] = [];
  for (let i = 0; i < 6; i++) queue.push(`synthetic-${i}`);
  queue.push("synthetic-5");
  const unsubscribe = queue.subscribe(async (value) => {
    seen.push(value);
  });
  expect(seen).toEqual(["synthetic-2", "synthetic-3", "synthetic-4", "synthetic-5"]);
  queue.push("warm");
  expect(seen.at(-1)).toBe("warm");
  unsubscribe();
  queue.push("cold-again");
  expect(seen.at(-1)).toBe("warm");
  queue.subscribe(async (value) => {
    seen.push(value);
  });
  expect(seen.at(-1)).toBe("cold-again");
});
