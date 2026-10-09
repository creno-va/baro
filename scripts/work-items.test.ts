import { expect, test } from "bun:test";
import {
  implementationIsMerged,
  validateWorkGraph,
  type WorkGraph,
  workItemProgress,
} from "./work-items";

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

test("only successful Quality gate on an actual main merge satisfies a code prerequisite", () => {
  const proof = {
    state: "MERGED",
    baseRefName: "main",
    mergeCommit: { oid: "a".repeat(40) },
    headRefOid: "b".repeat(40),
    statusCheckRollup: [{ name: "Quality gate", status: "COMPLETED", conclusion: "SUCCESS" }],
  };
  expect(implementationIsMerged(proof)).toBe(true);
  for (const invalid of [
    { ...proof, state: "OPEN" },
    { ...proof, baseRefName: "preview" },
    { ...proof, mergeCommit: null },
    { ...proof, statusCheckRollup: [] },
    {
      ...proof,
      statusCheckRollup: [{ name: "Quality gate", status: "COMPLETED", conclusion: "FAILURE" }],
    },
  ])
    expect(implementationIsMerged(invalid)).toBe(false);
  const first = base.items[0];
  if (!first) throw new Error("fixture missing");
  expect(
    validateWorkGraph({ ...base, items: [{ ...first, kind: "external", implementationPr: 88 }] }),
  ).toContain("External gate #1 cannot use an implementation PR");
});

test("final acceptance retains open external conditions while merged implementation unblocks code", () => {
  const closed = new Set([62, 69, 162]);
  const implemented = new Set([57, 58, 59, 63]);
  const item = {
    issue: 71,
    kind: "external" as const,
    dependsOn: [57, 58, 59, 62, 63, 69, 70, 162],
  };
  expect(workItemProgress(item, closed, implemented, true)).toEqual({
    status: "IN_PROGRESS",
    blockedBy: [57, 58, 59, 63, 70],
  });
  expect(workItemProgress({ ...item, kind: "implementation" }, closed, implemented, false)).toEqual(
    {
      status: "BLOCKED",
      blockedBy: [70],
    },
  );
  for (const issue of item.dependsOn) closed.add(issue);
  expect(workItemProgress(item, closed, implemented, false).blockedBy).toEqual([]);
});

test("reopened implementation work remains in progress without discarding the old merged proof", () => {
  const item = { issue: 58, kind: "implementation" as const, dependsOn: [57] };
  const implemented = new Set([57, 58]);
  expect(workItemProgress(item, new Set(), implemented, true)).toEqual({
    status: "IN_PROGRESS",
    blockedBy: [],
  });
  expect(workItemProgress(item, new Set(), implemented, false).status).toBe(
    "IMPLEMENTATION_MERGED",
  );
  expect(implemented.has(58)).toBe(true);
});
