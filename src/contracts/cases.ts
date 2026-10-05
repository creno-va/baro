import { z } from "zod";
import {
  analysisStatusSchema,
  boundedText,
  caseStatusSchema,
  displayText,
  errorSchema,
  revisionSchema,
  timestampSchema,
  uuidSchema,
} from "./common";
import { questionsSchema } from "./questions";
import { resultSchema } from "./results";

export const createCaseRequestSchema = z.strictObject({
  narrative: boundedText(20, 5000),
  turnstileToken: boundedText(1, 2048),
});
const analysisIdentity = { analysisId: uuidSchema, inputRevision: revisionSchema };
export const createCaseResponseSchema = z.strictObject({
  caseId: uuidSchema,
  ...analysisIdentity,
  inputRevision: z.literal(1),
  status: z.literal("screening"),
});
export const answersResponseSchema = z.strictObject({
  caseId: uuidSchema,
  ...analysisIdentity,
  inputRevision: revisionSchema.refine((revision) => revision >= 2),
  status: z.literal("queued"),
});
export const retryRequestSchema = z.strictObject({ inputRevision: revisionSchema });
export const retryResponseSchema = z.strictObject({
  ...analysisIdentity,
  status: z.literal("queued"),
});
export const deleteAccountRequestSchema = z.strictObject({ confirmation: z.literal("DELETE") });
export const caseParamsSchema = z.strictObject({ caseId: uuidSchema });
export const cursorPositionSchema = z.strictObject({ createdAt: timestampSchema, id: uuidSchema });
export const cursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine((value) => {
    try {
      const raw = value.replace(/-/g, "+").replace(/_/g, "/");
      return cursorPositionSchema.safeParse(JSON.parse(atob(raw))).success;
    } catch {
      return false;
    }
  }, "Invalid cursor");
export const caseListQuerySchema = z.strictObject({
  cursor: cursorSchema.optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d?$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(50))
    .default(20),
});
export const caseListItemSchema = z.strictObject({
  id: uuidSchema,
  title: displayText(100),
  status: caseStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export const caseListResponseSchema = z.strictObject({
  items: z.array(caseListItemSchema).max(50),
  nextCursor: cursorSchema.nullable(),
});
export const caseDetailResponseSchema = z
  .strictObject({
    caseId: uuidSchema,
    title: displayText(100),
    status: caseStatusSchema,
    ...analysisIdentity,
    questions: questionsSchema,
    result: resultSchema.nullable(),
    error: errorSchema.nullable(),
  })
  .refine((detail) => {
    const terminalKind = (
      {
        completed: "guidance",
        out_of_scope: "out_of_scope",
        urgent_redirect: "urgent_redirect",
      } as const
    )[detail.status as "completed" | "out_of_scope" | "urgent_redirect"];
    return (
      (terminalKind ? detail.result?.kind === terminalKind : detail.result === null) &&
      (detail.status === "failed" ? detail.error !== null : detail.error === null) &&
      (detail.status === "needs_clarification"
        ? detail.questions.length > 0
        : detail.questions.length === 0)
    );
  }, "Inconsistent case state");
export const analysisStatusResponseSchema = z
  .strictObject({
    caseId: uuidSchema,
    ...analysisIdentity,
    status: analysisStatusSchema,
    updatedAt: timestampSchema,
    retryable: z.boolean(),
    retryAttemptsRemaining: z.number().int().min(0).max(2),
    error: errorSchema.nullable(),
  })
  .refine(
    (analysis) =>
      (analysis.status === "failed" ? analysis.error !== null : analysis.error === null) &&
      (!analysis.retryable ||
        (analysis.status === "failed" &&
          analysis.error?.retryable === true &&
          analysis.retryAttemptsRemaining > 0)),
    "Inconsistent retry state",
  );
export type CreateCaseRequest = z.infer<typeof createCaseRequestSchema>;
export type CreateCaseResponse = z.infer<typeof createCaseResponseSchema>;
export type CaseDetail = z.infer<typeof caseDetailResponseSchema>;
export type CaseList = z.infer<typeof caseListResponseSchema>;
export type AnalysisStatusResponse = z.infer<typeof analysisStatusResponseSchema>;
