/** Explicit synthetic platform results; thrown exceptions are not normalized. */
export function deletedCleanupResult(ids: string[]) {
  return { deleted: ids.map((id) => ({ id })), errors: [] };
}
export const missingCleanupWorkflow = {
  deleteBatch: async (ids: string[]) => ({
    deleted: [],
    errors: ids.map((id) => ({
      id,
      code: 10400,
      message: "workflows.api.error.instance.not_found",
    })),
  }),
};
