import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import { v2LegalAnalysisSnapshotSchema } from "../../../contracts/v2";
import { GUIDE_HOSTS } from "../legal-retrieval/v2/registry";

export const reportAnalysisReviewSchema = z
  .strictObject({
    snapshot: v2LegalAnalysisSnapshotSchema(GUIDE_HOSTS).nullable(),
    status: z.enum(["ready", "partial", "empty", "unavailable", "review_required"]),
    userEdited: z.boolean(),
    excerpts: z
      .array(z.strictObject({ claimId: opaqueIdSchema, text: z.string().max(10000) }))
      .max(100),
  })
  .refine((review) => {
    if (!review.snapshot)
      return review.status === "review_required" && review.excerpts.length === 0;
    if (review.status === "ready" && review.snapshot.status !== "ready") return false;
    const ids = new Set(review.excerpts.map((excerpt) => excerpt.claimId));
    return (
      ids.size === review.excerpts.length &&
      ids.size === review.snapshot.sourceClaims.length &&
      review.snapshot.sourceClaims.every((claim) => ids.has(claim.id))
    );
  }, "A report needs its own analysis and exact original excerpts before completion");
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
