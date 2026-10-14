import { expect, test } from "bun:test";
import { safeWorkspaceContentFailure } from "../src/server/modules/workspace/content-diagnostics";

const receipt = {
  field: "chat_text",
  category: "strategy",
  canonicalRefusalOpening: false,
} as const;
test("content receipt accepts only fixed fields and categories with no original values", () => {
  expect(safeWorkspaceContentFailure(receipt)).toEqual(receipt);
  for (const extra of ["text", "id", "message", "stack", "match", "path", "reason"])
    expect(
      safeWorkspaceContentFailure({ ...receipt, [extra]: "synthetic-private-value" }),
    ).toBeUndefined();
  for (const invalid of [
    null,
    {},
    { ...receipt, field: "private-field" },
    { ...receipt, category: "private-category" },
    { ...receipt, canonicalRefusalOpening: "true" },
    { ...receipt, canonicalRefusalOpening: 1 },
  ])
    expect(safeWorkspaceContentFailure(invalid)).toBeUndefined();
  expect(
    safeWorkspaceContentFailure({ ...receipt, field: "fact_text", canonicalRefusalOpening: null }),
  ).toEqual({ ...receipt, field: "fact_text", canonicalRefusalOpening: null });
});
