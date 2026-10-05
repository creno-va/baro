import { expect, test } from "bun:test";
import { validateWorkGraph, type WorkGraph } from "./work-items";

const base: WorkGraph = {
  repository: "creno-va/baro",
  items: [
    {
      issue: 1,
      milestone: 2,
      kind: "implementation",
      dependsOn: [],
      owns: ["src"],
      docs: ["docs/README.md"],
      validation: "contract tests",
    },
  ],
};

test("rejects cyclic work dependencies", () => {
  const first = base.items[0];
  if (!first) throw new Error("fixture missing");
  const errors = validateWorkGraph({
    ...base,
    items: [
      { ...first, dependsOn: [2] },
      { ...first, issue: 2, dependsOn: [1] },
    ],
  });
  expect(errors.some((error) => error.includes("cycle"))).toBe(true);
});

test("rejects unknown prerequisites and invalid documents", () => {
  const first = base.items[0];
  if (!first) throw new Error("fixture missing");
  const errors = validateWorkGraph({
    ...base,
    items: [{ ...first, dependsOn: [999], docs: ["../README.md"] }],
  });
  expect(errors).toContain("Unknown dependency #999 from #1");
  expect(errors).toContain("Invalid document ../README.md for #1");
});
