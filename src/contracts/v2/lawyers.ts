import { z } from "zod";
import {
  boundedText,
  displayText,
  hasUniqueIds,
  opaqueIdSchema,
  revisionSchema,
  timestampSchema,
} from "../common";
import { v2FailureCodeSchema, v2HashSchema, v2JsonRequestSchema, v2VersionSchema } from "./common";
import { v2UploadReservationRequestSchema } from "./files";

export const v2RegionSchema = z.enum([
  "seoul",
  "busan",
  "daegu",
  "incheon",
  "gwangju",
  "daejeon",
  "ulsan",
  "sejong",
  "gyeonggi",
  "gangwon",
  "chungbuk",
  "chungnam",
  "jeonbuk",
  "jeonnam",
  "gyeongbuk",
  "gyeongnam",
  "jeju",
]);
export const v2LegalFieldSchema = z.enum([
  "civil",
  "criminal",
  "family",
  "administrative",
  "labor",
  "tax",
  "company",
  "intellectual_property",
  "real_estate",
  "immigration",
  "other",
]);
export const v2OfficeSchema = z.strictObject({
  name: displayText(200),
  country: z.literal("KR"),
  region: v2RegionSchema,
  address: displayText(500),
  addressDetail: displayText(200).nullable(),
  postalCode: z
    .string()
    .regex(/^\d{5}$/)
    .nullable(),
});
export const v2ExternalConsultationUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      hostname.includes(".") &&
      !/^\d+(?:\.\d+){3}$/.test(hostname) &&
      !hostname.includes(":") &&
      !/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(hostname) &&
      ![...url.searchParams.keys()].some((key) =>
        /^(case|caseid|narrative|message|token|key|secret)$/i.test(key),
      )
    );
  }, "Consultation link must be a public HTTPS URL without case data");
export const v2ContactSchema = z
  .strictObject({
    phone: z
      .string()
      .regex(/^\+?[0-9][0-9 ()-]{6,29}$/)
      .nullable(),
    email: z.email().max(254).nullable(),
    consultationUrl: v2ExternalConsultationUrlSchema.nullable(),
  })
  .refine(
    (contact) =>
      contact.phone !== null || contact.email !== null || contact.consultationUrl !== null,
    "Provide an external contact method",
  );
export const v2PublicAssetSchema = z.strictObject({
  id: opaqueIdSchema,
  kind: z.enum(["image", "pdf"]),
  contentHash: v2HashSchema,
  byteLength: z.number().int().positive().max(100_000_000),
  sanitization: z.literal("verified"),
  approvedRevision: revisionSchema,
});
export const v2LawyerAssetUploadRequestSchema = z
  .strictObject({
    name: v2UploadReservationRequestSchema.shape.name,
    byteLength: z.number().int().positive().max(100_000_000),
    mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
    purpose: z.enum(["profile_photo", "portfolio", "identity", "lawyer_license", "office"]),
  })
  .refine(
    (asset) => asset.purpose !== "profile_photo" || asset.mediaType !== "application/pdf",
    "A profile photo must be an image",
  );
export const v2PortfolioAssetSchema = z
  .strictObject({
    id: opaqueIdSchema,
    revision: revisionSchema,
    kind: z.enum(["image", "pdf"]),
    status: z.enum(["reserved", "uploaded", "sanitizing", "ready", "failed", "deleting"]),
    byteLength: z.number().int().positive().max(100_000_000),
    originalHash: v2HashSchema.nullable(),
    sanitizedDerivative: z
      .strictObject({
        id: opaqueIdSchema,
        contentHash: v2HashSchema,
        byteLength: z.number().int().positive().max(100_000_000),
        format: z.enum(["jpeg", "png", "webp", "pdf"]),
      })
      .nullable(),
    currentJobId: opaqueIdSchema.nullable(),
    failure: v2FailureCodeSchema.nullable(),
  })
  .refine((asset) => {
    if (asset.status === "reserved")
      return (
        asset.originalHash === null &&
        asset.sanitizedDerivative === null &&
        asset.currentJobId === null &&
        asset.failure === null
      );
    if (asset.status === "deleting") return asset.currentJobId === null;
    if (asset.status === "failed") return asset.failure !== null && asset.currentJobId === null;
    if (asset.originalHash === null || asset.failure !== null) return false;
    if (asset.status === "ready")
      return (
        asset.currentJobId === null &&
        asset.sanitizedDerivative !== null &&
        (asset.kind === "pdf") === (asset.sanitizedDerivative.format === "pdf")
      );
    return (
      asset.sanitizedDerivative === null &&
      (asset.status === "sanitizing") === (asset.currentJobId !== null)
    );
  }, "Staging assets require sanitization before they can be submitted");
export const v2PortfolioItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: opaqueIdSchema,
    kind: z.literal("text"),
    title: displayText(300),
    text: displayText(5000),
  }),
  z.strictObject({
    id: opaqueIdSchema,
    kind: z.literal("image"),
    title: displayText(300),
    caption: displayText(1000).nullable(),
    assetId: opaqueIdSchema,
  }),
  z.strictObject({
    id: opaqueIdSchema,
    kind: z.literal("pdf"),
    title: displayText(300),
    description: displayText(1000).nullable(),
    assetId: opaqueIdSchema,
  }),
]);
const profileContent = {
  name: displayText(100),
  introduction: displayText(5000),
  photoAssetId: opaqueIdSchema,
  office: v2OfficeSchema,
  contact: v2ContactSchema,
  legalFields: z
    .array(v2LegalFieldSchema)
    .min(1)
    .max(11)
    .refine((fields) => new Set(fields).size === fields.length, "Duplicate legal fields"),
  portfolio: z
    .array(v2PortfolioItemSchema)
    .max(30)
    .refine(hasUniqueIds, "Duplicate portfolio items"),
};
export const v2ProfileContentSchema = z.strictObject(profileContent);
export const v2ProfileDraftContentSchema = v2ProfileContentSchema.partial();
export const v2ProfileEditRequestSchema = v2JsonRequestSchema(
  z.strictObject({
    expectedRevision: revisionSchema,
    content: v2ProfileDraftContentSchema,
  }),
);
const revisionBase = {
  schemaVersion: v2VersionSchema,
  id: opaqueIdSchema,
  profileId: opaqueIdSchema,
  revision: revisionSchema,
  createdAt: timestampSchema,
};
const decisionRecord = {
  reviewerId: opaqueIdSchema,
  reviewedAt: timestampSchema,
  reason: displayText(2000),
};
export const v2ProfileRevisionSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...revisionBase,
    status: z.literal("draft"),
    content: v2ProfileDraftContentSchema,
  }),
  z.strictObject({
    ...revisionBase,
    status: z.literal("submitted"),
    content: v2ProfileContentSchema,
    submittedAt: timestampSchema,
  }),
  z.strictObject({
    ...revisionBase,
    status: z.literal("approved"),
    content: v2ProfileContentSchema,
    submittedAt: timestampSchema,
    ...decisionRecord,
  }),
  z.strictObject({
    ...revisionBase,
    status: z.literal("rejected"),
    content: v2ProfileContentSchema,
    submittedAt: timestampSchema,
    ...decisionRecord,
  }),
  z.strictObject({
    ...revisionBase,
    status: z.literal("withdrawn"),
    content: v2ProfileContentSchema,
    submittedAt: timestampSchema,
    withdrawnAt: timestampSchema,
  }),
]);
export const v2ProfileSubmitRequestSchema = z.strictObject({ expectedRevision: revisionSchema });
export function v2ProfileSubmitForAssetsSchema(context: {
  applicationState: "draft" | "submitted" | "approved" | "rejected" | "withdrawn";
  revision: number;
  content: unknown;
  assets: readonly unknown[];
}) {
  const content = v2ProfileContentSchema.parse(context.content);
  const assets = context.assets.map((asset) => v2PortfolioAssetSchema.parse(asset));
  const safe =
    context.applicationState === "approved" &&
    hasUniqueIds(assets) &&
    assets.some(
      (asset) =>
        asset.id === content.photoAssetId && asset.kind === "image" && asset.status === "ready",
    ) &&
    content.portfolio.every(
      (item) =>
        item.kind === "text" ||
        assets.some(
          (asset) =>
            asset.id === item.assetId && asset.kind === item.kind && asset.status === "ready",
        ),
    );
  return v2ProfileSubmitRequestSchema.refine(
    (request) => safe && request.expectedRevision === context.revision,
    "Verified application, safe owned assets and the current revision are required",
  );
}
export const v2ProfileWithdrawRequestSchema = z.strictObject({
  expectedRevision: revisionSchema,
  kind: z.enum(["submission", "publication"]),
});
export const v2VerificationAssetSchema = z
  .strictObject({
    id: opaqueIdSchema,
    purpose: z.enum(["identity", "lawyer_license", "office"]),
    status: z.enum(["reserved", "uploaded", "ready", "rejected", "deleting"]),
    byteLength: z.number().int().positive().max(100_000_000),
    contentHash: v2HashSchema.nullable(),
  })
  .refine(
    (asset) => asset.status !== "ready" || asset.contentHash !== null,
    "Ready verification asset needs a hash",
  );
export const v2LawyerApplicationRequestSchema = z.strictObject({
  expectedRevision: revisionSchema,
  name: displayText(100),
  licenseNumber: boundedText(1, 100),
  office: v2OfficeSchema,
  verificationAssetIds: z
    .array(opaqueIdSchema)
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate verification assets"),
});
export const v2LawyerApplicationDraftRequestSchema = v2JsonRequestSchema(
  z.strictObject({
    expectedRevision: revisionSchema,
    content: z.strictObject({
      name: displayText(100).optional(),
      licenseNumber: boundedText(1, 100).optional(),
      office: v2OfficeSchema.partial().optional(),
      verificationAssetIds: z
        .array(opaqueIdSchema)
        .max(20)
        .refine((ids) => new Set(ids).size === ids.length, "Duplicate verification assets")
        .optional(),
    }),
  }),
);
export const v2VerificationChecklistSchema = z.strictObject({
  identity: z.literal(true),
  lawyerLicense: z.literal(true),
  office: z.literal(true),
});
export const v2PublicVerificationSchema = z.strictObject({
  status: z.literal("manually_verified"),
  identityChecked: z.literal(true),
  licenseChecked: z.literal(true),
  officeChecked: z.literal(true),
  verifiedAt: timestampSchema,
});
const applicationBase = {
  schemaVersion: v2VersionSchema,
  id: opaqueIdSchema,
  applicantId: opaqueIdSchema,
  revision: revisionSchema,
  createdAt: timestampSchema,
};
const applicationContent = {
  name: displayText(100),
  licenseNumber: boundedText(1, 100),
  office: v2OfficeSchema,
  assets: z
    .array(v2VerificationAssetSchema)
    .min(1)
    .max(20)
    .refine(hasUniqueIds, "Duplicate verification assets"),
};
export const v2LawyerApplicationSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...applicationBase,
      status: z.literal("draft"),
      content: z
        .strictObject({
          ...applicationContent,
          office: v2OfficeSchema.partial(),
          assets: z
            .array(v2VerificationAssetSchema)
            .max(20)
            .refine(hasUniqueIds, "Duplicate verification assets"),
        })
        .partial(),
    }),
    z.strictObject({
      ...applicationBase,
      status: z.literal("submitted"),
      content: z.strictObject(applicationContent),
      submittedAt: timestampSchema,
    }),
    z.strictObject({
      ...applicationBase,
      status: z.literal("approved"),
      content: z.strictObject(applicationContent),
      submittedAt: timestampSchema,
      ...decisionRecord,
      checklist: v2VerificationChecklistSchema,
    }),
    z.strictObject({
      ...applicationBase,
      status: z.literal("rejected"),
      content: z.strictObject(applicationContent),
      submittedAt: timestampSchema,
      ...decisionRecord,
    }),
    z.strictObject({
      ...applicationBase,
      status: z.literal("withdrawn"),
      content: z.strictObject(applicationContent),
      submittedAt: timestampSchema,
      withdrawnAt: timestampSchema,
    }),
  ])
  .refine(
    (application) =>
      application.status === "draft" ||
      (application.content.assets.every((asset) => asset.status === "ready") &&
        ((application.status !== "approved" && application.status !== "rejected") ||
          application.reviewerId !== application.applicantId)),
    "Application requires ready private assets and a different reviewer",
  );
export const v2ApplicationDecisionRequestSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    expectedRevision: revisionSchema,
    decision: z.literal("approved"),
    reason: displayText(2000),
    checklist: v2VerificationChecklistSchema,
  }),
  z.strictObject({
    expectedRevision: revisionSchema,
    decision: z.literal("rejected"),
    reason: displayText(2000),
  }),
]);
export const v2PublicationChecklistSchema = z.strictObject({
  identityMatches: z.literal(true),
  officeMatches: z.literal(true),
  personalDataReviewed: z.literal(true),
  advertisingReviewed: z.literal(true),
  assetsSanitized: z.literal(true),
});
export const v2ProfileDecisionRequestSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    expectedRevision: revisionSchema,
    decision: z.literal("approved"),
    reason: displayText(2000),
    checklist: v2PublicationChecklistSchema,
  }),
  z.strictObject({
    expectedRevision: revisionSchema,
    decision: z.literal("rejected"),
    reason: displayText(2000),
  }),
]);
/** These values come from authenticated server context, not the submitted body. */
export function v2ModerationDecisionSchema(
  context: {
    applicantId: string;
    reviewerId: string;
    roles: readonly string[];
    reauthenticatedAt: string;
    now: string;
    expectedRevision: number;
    state: "submitted" | "draft" | "approved" | "rejected" | "withdrawn";
  },
  kind: "application" | "profile",
) {
  const valid =
    context.roles.includes("moderator") &&
    context.applicantId !== context.reviewerId &&
    timestampSchema.safeParse(context.now).success &&
    timestampSchema.safeParse(context.reauthenticatedAt).success &&
    Date.parse(context.now) >= Date.parse(context.reauthenticatedAt) &&
    Date.parse(context.now) - Date.parse(context.reauthenticatedAt) <= 10 * 60 * 1000 &&
    context.state === "submitted";
  const check = (request: { expectedRevision: number }) =>
    valid && request.expectedRevision === context.expectedRevision;
  const message =
    "Moderator, recent reauthentication, submitted revision and non-self approval are required";
  return kind === "application"
    ? v2ApplicationDecisionRequestSchema.refine(check, message)
    : v2ProfileDecisionRequestSchema.refine(check, message);
}
export const v2PublicLawyerSchema = z
  .strictObject({
    schemaVersion: v2VersionSchema,
    id: opaqueIdSchema,
    approvedRevision: revisionSchema,
    publishedAt: timestampSchema,
    content: v2ProfileContentSchema,
    verification: v2PublicVerificationSchema,
    assets: z
      .array(v2PublicAssetSchema)
      .min(1)
      .max(31)
      .refine(hasUniqueIds, "Duplicate public assets"),
  })
  .refine((lawyer) => {
    if (lawyer.assets.some((asset) => asset.approvedRevision !== lawyer.approvedRevision))
      return false;
    if (
      !lawyer.assets.some(
        (asset) => asset.id === lawyer.content.photoAssetId && asset.kind === "image",
      )
    )
      return false;
    return lawyer.content.portfolio.every(
      (item) =>
        item.kind === "text" ||
        lawyer.assets.some((asset) => asset.id === item.assetId && asset.kind === item.kind),
    );
  }, "Public profile references only sanitized assets from its approved revision");
export const v2DirectoryQuerySchema = z.strictObject({
  name: displayText(100).optional(),
  region: v2RegionSchema.optional(),
  legalField: v2LegalFieldSchema.optional(),
  cursor: opaqueIdSchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
// UI derives provider links from this public office only, never from a case or user narrative.
export const v2DirectionsSelectionSchema = z.strictObject({
  provider: z.enum(["naver", "kakao", "google"]),
  office: v2OfficeSchema,
});
export const v2DirectorySnapshotSchema = z.strictObject({
  schemaVersion: v2VersionSchema,
  snapshotId: opaqueIdSchema,
  rotation: z.literal("disclosed_rotation"),
  expiresAt: timestampSchema,
  items: z.array(v2PublicLawyerSchema).max(50).refine(hasUniqueIds, "Duplicate directory items"),
  nextCursor: opaqueIdSchema.nullable(),
});
export const v2PublicProfileReportRequestSchema = z.strictObject({
  expectedRevision: revisionSchema,
  kind: z.enum([
    "identity",
    "misleading_information",
    "personal_data",
    "unsafe_asset",
    "advertising",
    "other",
  ]),
});
export const v2ModerationReportSchema = z
  .strictObject({
    id: opaqueIdSchema,
    profileId: opaqueIdSchema,
    profileRevision: revisionSchema,
    kind: v2PublicProfileReportRequestSchema.shape.kind,
    status: z.enum(["open", "reviewing", "resolved", "dismissed"]),
    resolution: displayText(2000).nullable(),
    revision: revisionSchema,
    createdAt: timestampSchema,
  })
  .refine(
    (report) =>
      (report.status === "resolved" || report.status === "dismissed") ===
      (report.resolution !== null),
    "Only closed reports have a resolution",
  );
export const v2ModerationReportUpdateSchema = z
  .strictObject({
    expectedRevision: revisionSchema,
    status: z.enum(["reviewing", "resolved", "dismissed"]),
    resolution: displayText(2000).nullable(),
  })
  .refine(
    (report) =>
      (report.status === "resolved" || report.status === "dismissed") ===
      (report.resolution !== null),
    "Closed reports require a reason",
  );
export type V2Office = z.infer<typeof v2OfficeSchema>;
export type V2PortfolioAsset = z.infer<typeof v2PortfolioAssetSchema>;
export type V2LawyerAssetUploadRequest = z.infer<typeof v2LawyerAssetUploadRequestSchema>;
export type V2ProfileContent = z.infer<typeof v2ProfileContentSchema>;
export type V2ProfileRevision = z.infer<typeof v2ProfileRevisionSchema>;
export type V2LawyerApplication = z.infer<typeof v2LawyerApplicationSchema>;
export type V2PublicLawyer = z.infer<typeof v2PublicLawyerSchema>;
export type V2ApplicationDecisionRequest = z.infer<typeof v2ApplicationDecisionRequestSchema>;
export type V2ProfileDecisionRequest = z.infer<typeof v2ProfileDecisionRequestSchema>;
export type V2DirectoryQuery = z.infer<typeof v2DirectoryQuerySchema>;
export type V2ModerationReport = z.infer<typeof v2ModerationReportSchema>;
export type V2Region = z.infer<typeof v2RegionSchema>;
export type V2LegalField = z.infer<typeof v2LegalFieldSchema>;
export type V2Contact = z.infer<typeof v2ContactSchema>;
export type V2PublicAsset = z.infer<typeof v2PublicAssetSchema>;
export type V2PortfolioItem = z.infer<typeof v2PortfolioItemSchema>;
export type V2ProfileDraftContent = z.infer<typeof v2ProfileDraftContentSchema>;
export type V2ProfileEditRequest = z.infer<typeof v2ProfileEditRequestSchema>;
export type V2ProfileSubmitRequest = z.infer<typeof v2ProfileSubmitRequestSchema>;
export type V2ProfileWithdrawRequest = z.infer<typeof v2ProfileWithdrawRequestSchema>;
export type V2VerificationAsset = z.infer<typeof v2VerificationAssetSchema>;
export type V2LawyerApplicationRequest = z.infer<typeof v2LawyerApplicationRequestSchema>;
export type V2LawyerApplicationDraftRequest = z.infer<typeof v2LawyerApplicationDraftRequestSchema>;
export type V2PublicVerification = z.infer<typeof v2PublicVerificationSchema>;
export type V2DirectionsSelection = z.infer<typeof v2DirectionsSelectionSchema>;
export type V2DirectorySnapshot = z.infer<typeof v2DirectorySnapshotSchema>;
export type V2PublicProfileReportRequest = z.infer<typeof v2PublicProfileReportRequestSchema>;
export type V2ModerationReportUpdate = z.infer<typeof v2ModerationReportUpdateSchema>;
