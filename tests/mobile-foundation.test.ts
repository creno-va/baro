import { expect, test } from "bun:test";
import { consentInputSchema } from "@baro/contracts/consent";
import { V2_INTAKE_POLICY, V2_LIMITS, v2JsonRequestSchema } from "@baro/contracts/v2/common";
import { z } from "zod";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import { createFoundationModel } from "../apps/mobile/src/features/foundation/model";
import { mobileBoundaryFindings } from "../scripts/mobile-boundaries";
import { consentInputSchema as canonicalConsent } from "../src/contracts/consent";
import { V2_LIMITS as canonicalLimits } from "../src/contracts/v2/common";

test("workspace uses the canonical contracts and keeps strict wire validation", () => {
  expect(consentInputSchema).toBe(canonicalConsent);
  expect(V2_LIMITS).toBe(canonicalLimits);
  expect(V2_INTAKE_POLICY).toEqual({ followupRounds: 2, questionsPerBatch: 3 });
  expect(V2_LIMITS.dailyAiResponses).toBe(200);
  const bodySchema = v2JsonRequestSchema(z.strictObject({ text: z.string() }));
  expect(bodySchema.safeParse({ text: "합성 문장" }).success).toBe(true);
  expect(bodySchema.safeParse({ text: "가".repeat(25_000) }).success).toBe(false);
  expect(consentInputSchema.safeParse({ role: "moderator" }).success).toBe(false);
  expect(() => Bun.resolveSync("@baro/contracts/pipeline", process.cwd())).toThrow();
  expect(() => Bun.resolveSync("@baro/contracts", process.cwd())).toThrow();
  expect(() => Bun.resolveSync("@baro/contracts/index.ts", process.cwd())).toThrow();
});

test("preview and production config reject endpoint swaps and credentials", () => {
  expect(resolveMobileConfig({ environment: "preview" }).apiBaseUrl).toBe(
    "https://preview.baro.site",
  );
  expect(resolveMobileConfig({ environment: "production" }).scheme).toBe("baro");
  for (const apiBaseUrl of [
    "http://baro.site",
    "https://preview.baro.site",
    "https://baro.site.attacker.test",
    "https://name:password@baro.site",
    "https://baro.site/path",
    "https://baro.site?token=synthetic",
    "https://baro.site#fragment",
  ]) {
    expect(() => resolveMobileConfig({ environment: "production", apiBaseUrl })).toThrow();
  }
  expect(() => resolveMobileConfig({ environment: "prod" })).toThrow("MOBILE_ENVIRONMENT_INVALID");
});

test("local build supports simulator and LAN hosts but cannot target remote production", () => {
  for (const apiBaseUrl of [
    "http://127.0.0.1:4321",
    "http://10.0.2.2:4321",
    "http://192.168.1.8:4321",
    "http://[::1]:4321",
  ]) {
    expect(resolveMobileConfig({ apiBaseUrl }).apiBaseUrl).toBe(new URL(apiBaseUrl).origin);
  }
  for (const apiBaseUrl of [
    "https://baro.site",
    "http://172.32.0.1:4321",
    "file:///tmp/data",
    "broken",
  ])
    expect(() => resolveMobileConfig({ apiBaseUrl })).toThrow();
});

test("configuration failures do not leak raw endpoints or fabricate a session", () => {
  const failed = createFoundationModel(() => {
    throw new Error("private diagnostic");
  });
  expect(failed.kind).toBe("configuration-error");
  expect(JSON.stringify(failed)).not.toContain("private diagnostic");
  const available = createFoundationModel(() => resolveMobileConfig({ environment: "preview" }));
  expect(available.kind).toBe("available");
  expect(available).not.toHaveProperty("user");
  expect(available).not.toHaveProperty("authenticated");
});

test("public contract and mobile imports cannot cross server/browser boundaries", () => {
  expect(
    mobileBoundaryFindings("src/contracts/client.ts", 'export * from "./pipeline";'),
  ).toContain("internal pipeline entered public contract graph");
  for (const source of [
    'import { x } from "@baro/contracts";',
    'import { x } from "../../server/auth";',
    'const x = require("node:fs");',
    "const x = window.location;",
    "const x = import(getModule());",
  ])
    expect(mobileBoundaryFindings("apps/mobile/src/x.ts", source).length).toBeGreaterThan(0);
  expect(
    mobileBoundaryFindings(
      "src/contracts/common.ts",
      'import { z } from "zod"; const u = new URL("https://baro.site");',
    ),
  ).toEqual([]);
  expect(
    mobileBoundaryFindings(
      "apps/mobile/src/composition/config.ts",
      "const env = process.env.EXPO_PUBLIC_APP_ENV;",
    ),
  ).toEqual([]);
  expect(
    mobileBoundaryFindings(
      "apps/mobile/src/composition/config.ts",
      "const secret = process.env.SECRET;",
    ),
  ).not.toEqual([]);
  for (const source of [
    'import React from "react";',
    'const io = fetch("/api/me");',
    'import { x } from "../../../apps/mobile/src/ui/Text";',
  ])
    expect(mobileBoundaryFindings("packages/api-client/src/example.ts", source)).not.toEqual([]);
});

test("Windows separators preserve the same contract, shared-source and Expo environment boundaries", () => {
  const scenarios = [
    ["apps/mobile/src/composition/config.ts", "const env = process.env.EXPO_PUBLIC_APP_ENV;"],
    ["apps/mobile/src/composition/config.ts", "const secret = process.env.SECRET;"],
    ["apps/mobile/src/x.ts", 'import { x } from "../../../outside";'],
    ["src/contracts/client.ts", 'export * from "./pipeline";'],
    ["packages/client-core/src/x.ts", 'import { x } from "../../../server/private";'],
  ];
  for (const [path, source] of scenarios) {
    if (!path || source === undefined) throw new Error("Invalid boundary fixture");
    expect(mobileBoundaryFindings(path.replaceAll("/", "\\"), source)).toEqual(
      mobileBoundaryFindings(path, source),
    );
  }
});
