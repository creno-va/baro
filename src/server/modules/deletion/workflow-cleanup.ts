import { z } from "zod";

export type CleanupWorkflow = { deleteBatch(ids: string[]): Promise<unknown> };

/** One namespace and one retained ID per call. A thrown exception is never an
 * absence receipt. Cloudflare's structured result must account for that exact ID.
 * deleteBatch stops current execution and removes stored state, like delete(). */
export async function deleteWorkflowInstance(binding: CleanupWorkflow | undefined, id: string) {
  if (!binding) throw new Error("CLEANUP_BINDING_UNAVAILABLE");
  const result = await binding.deleteBatch([id]);
  const parsed = z
    .union([
      z.strictObject({
        deleted: z.tuple([z.strictObject({ id: z.literal(id) })]),
        errors: z.tuple([]),
      }),
      z.strictObject({
        deleted: z.tuple([]),
        errors: z.tuple([
          z.strictObject({
            id: z.literal(id),
            code: z.literal(10400),
            message: z.literal("workflows.api.error.instance.not_found"),
          }),
        ]),
      }),
    ])
    .safeParse(result);
  if (!parsed.success) throw new Error("CLEANUP_WORKFLOW_RESPONSE_INVALID");
  return parsed.data.deleted.length === 1;
}
