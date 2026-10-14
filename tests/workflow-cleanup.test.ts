import { expect, test } from "bun:test";
import { deleteWorkflowInstance } from "../src/server/modules/deletion/workflow-cleanup";
import { deletedCleanupResult, missingCleanupWorkflow } from "./helpers/workflow-cleanup";

const id = "synthetic-cleanup-instance-1";
const absent = { id, code: 10400, message: "workflows.api.error.instance.not_found" };

test("cleanup binds a single structured deletion or absence to the exact requested instance", async () => {
  const calls: string[][] = [];
  const binding = {
    get: async () => {
      throw new Error("SYNTHETIC_PRIVATE instance.not_found WRAPPED");
    },
    deleteBatch: async (ids: string[]) => {
      calls.push(ids);
      return deletedCleanupResult(ids);
    },
  };
  expect(await deleteWorkflowInstance(binding, id)).toBe(true);
  expect(await deleteWorkflowInstance(missingCleanupWorkflow, id)).toBe(false);
  expect(calls).toEqual([[id]]);
});

for (const [name, result] of [
  ["missing response", undefined],
  ["empty response", {}],
  ["unaccounted instance", { deleted: [], errors: [] }],
  ["foreign deletion", { deleted: [{ id: "other" }], errors: [] }],
  ["foreign absence", { deleted: [], errors: [{ ...absent, id: "other" }] }],
  ["duplicate deletion", { deleted: [{ id }, { id }], errors: [] }],
  ["duplicate absence", { deleted: [], errors: [absent, absent] }],
  ["contradictory results", { deleted: [{ id }], errors: [absent] }],
  ["extra result", { deleted: [{ id }], errors: [{ ...absent, id: "other" }] }],
  ["wrong numeric code", { deleted: [], errors: [{ ...absent, code: 10001 }] }],
  ["string numeric code", { deleted: [], errors: [{ ...absent, code: "10400" }] }],
  [
    "wrapped message",
    { deleted: [], errors: [{ ...absent, message: `PRIVATE ${absent.message}` }] },
  ],
  ["wrong message", { deleted: [], errors: [{ ...absent, message: "instance.not_found" }] }],
  ["extra unreviewed field", { deleted: [{ id }], errors: [], pending: true }],
] as const) {
  test(`cleanup rejects ${name} without accepting a stop receipt`, async () => {
    await expect(deleteWorkflowInstance({ deleteBatch: async () => result }, id)).rejects.toThrow(
      "CLEANUP_WORKFLOW_RESPONSE_INVALID",
    );
  });
}

test("cleanup neither retries nor translates a thrown exception into structured absence", async () => {
  let calls = 0;
  const error = new Error("instance.not_found");
  await expect(
    deleteWorkflowInstance(
      {
        deleteBatch: async () => {
          calls++;
          throw error;
        },
      },
      id,
    ),
  ).rejects.toBe(error);
  expect(calls).toBe(1);
  await expect(deleteWorkflowInstance(undefined, id)).rejects.toThrow(
    "CLEANUP_BINDING_UNAVAILABLE",
  );
});
