import { expect, test } from "bun:test";
import { productBoundaryFindings } from "../scripts/product-boundaries";

test("source gate rejects dynamic fixture/runtime imports, aliased/computed payload logging and auth bypass", () => {
  for (const source of [
    'const fs = await import("node:fs/promises")',
    'import { sample } from "../../tests/adapters/provider"',
    "const emit = console.log; emit(payload)",
    "const { error } = console; error(errorStack)",
    'console["log"](requestBody)',
    "logger.info(responseBody)",
    "if (MOCK_AUTH) return TEST_USER_ID",
    "const gateway = {collectLog:true,skipCache:false}",
  ])
    expect(productBoundaryFindings("src/server/sample.ts", source).length).toBeGreaterThan(0);
  expect(
    productBoundaryFindings("src/server/sample.ts", 'const safe = { requestId: "opaque" };'),
  ).toEqual([]);
});
