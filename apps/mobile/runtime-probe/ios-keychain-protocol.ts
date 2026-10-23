import { z } from "zod";
import { probeFailureCategorySchema } from "./failures";

export const iosReadinessStages = [
  "native-clear",
  "source-clear",
  "download-cache-clear",
  "credential-reset",
  "credential-store-readback",
  "recovery-key-write-readback",
  "secure-store-direct-readback",
  "cleanup",
] as const;
export const iosHostPhaseSchema = z.enum(["baseline", "signed"]);
export const iosReadinessReportSchema = z
  .strictObject({
    version: z.literal(1),
    kind: z.literal("simulator-sdk-readiness"),
    sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
    phase: iosHostPhaseSchema,
    operations: z
      .array(
        z.strictObject({
          stage: z.enum(iosReadinessStages),
          ok: z.boolean(),
          category: probeFailureCategorySchema.optional(),
        }),
      )
      .length(iosReadinessStages.length),
    allSucceeded: z.boolean(),
    externalFetchAttempts: z.number().int().min(0).max(100),
  })
  .superRefine((value, ctx) => {
    if (
      value.operations.some(
        (op, index) =>
          op.stage !== iosReadinessStages[index] || (op.ok && op.category !== undefined),
      ) ||
      value.allSucceeded !==
        (value.operations.every((op) => op.ok) && value.externalFetchAttempts === 0)
    )
      ctx.addIssue({ code: "custom", message: "IOS_HOST_OPERATION_REPORT_INCONSISTENT" });
  });
export type IosReadinessReport = z.infer<typeof iosReadinessReportSchema>;
