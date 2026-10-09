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

test("only the fixed v2 deletion diagnostic fields are allowed at the reviewed module", () => {
  const file = "src/server/modules/deletion/v2-reconcile.ts";
  const source = `console.error(JSON.stringify({event:"v2_deletion_cleanup_failed",environment:event.environment,reason:event.reason,attempts:event.attempts,ageSeconds:event.ageSeconds,}),)`;
  expect(productBoundaryFindings(file, source)).toEqual([]);
  for (const unsafe of [
    source.replace("ageSeconds:event.ageSeconds,", "ageSeconds:event.ageSeconds,payload:payload,"),
    source.replace("reason:event.reason", "reason:error.message"),
    source.replace("console.error", "console.warn"),
  ])
    expect(productBoundaryFindings(file, unsafe).length).toBeGreaterThan(0);
  expect(productBoundaryFindings("src/server/sample.ts", source).length).toBeGreaterThan(0);
});
