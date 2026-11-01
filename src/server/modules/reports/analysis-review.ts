import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import { v2LegalAnalysisSnapshotSchema } from "../../../contracts/v2";
import { GUIDE_HOSTS } from "../legal-retrieval/v2/registry";

export const reportAnalysisReviewSchema = z.strictObject({
  snapshot: v2LegalAnalysisSnapshotSchema(GUIDE_HOSTS).nullable(),
  status: z.enum(["ready", "partial", "empty", "unavailable", "review_required"]),
  userEdited: z.boolean(),
  excerpts: z
    .array(z.strictObject({ claimId: opaqueIdSchema, text: z.string().max(10000) }))
    .max(100),
});
export type ReportAnalysisReview = z.infer<typeof reportAnalysisReviewSchema>;
export type ReportAnalysisSummary = {
  analysisId: string | null;
  status: ReportAnalysisReview["status"];
  userEdited: boolean;
  checkedAt: string | null;
};
export const reportAnalysisSummary = (review?: ReportAnalysisReview): ReportAnalysisSummary => ({
  analysisId: review?.snapshot?.id ?? null,
  status: review?.userEdited ? "review_required" : (review?.status ?? "review_required"),
  userEdited: review?.userEdited ?? false,
  checkedAt: review?.snapshot?.checkedAt ?? null,
});
