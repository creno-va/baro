import { z } from "zod";

export const iosAuditTypes = [
  "contrast",
  "dynamic-type",
  "element-detection",
  "hit-region",
  "element-description",
  "text-clipped",
  "trait",
] as const;
const count = z.number().int().min(0).max(10000);
const viewportSchema = z
  .strictObject({
    viewport: z.enum(["home-initial", "home-action", "guide-initial", "guide-action"]),
    completed: z.literal(true),
    issueCount: count,
    findings: z
      .array(
        z.strictObject({
          category: z.enum([...iosAuditTypes, "other"]),
          target: z.enum([
            "home-title",
            "guide-title",
            "guide-button",
            "return-button",
            "browse-button",
            "account-button",
            "cases-button",
            "static-text",
            "button",
            "image",
            "other",
          ]),
          count: count.min(1),
        }),
      )
      .max(88),
  })
  .refine(
    (value) =>
      value.issueCount === value.findings.reduce((sum, finding) => sum + finding.count, 0) &&
      new Set(value.findings.map((finding) => `${finding.category}:${finding.target}`)).size ===
        value.findings.length,
    "IOS_AUDIT_FINDINGS_MUST_ACCOUNT_FOR_EVERY_ISSUE",
  );
export const iosAccessibilityResultSchema = z
  .strictObject({
    kind: z.literal("ios-anonymous-home-guide-accessibility-audit"),
    applicationId: z.literal("site.baro.app.preview"),
    requestedAuditTypes: z
      .array(z.enum(iosAuditTypes))
      .length(iosAuditTypes.length)
      .refine((types) => types.join(",") === iosAuditTypes.join(",")),
    viewports: z.array(viewportSchema).length(4),
    issueCount: count,
    auditPassed: z.boolean(),
    defaultIssueReportingReplacedByFixedCounts: z.literal(true),
    unreportedIssueCount: z.literal(0),
    voiceOverVerified: z.literal(false),
    publicDataNavigation: z.literal(false),
    authenticationNavigation: z.literal(false),
    privateDataAccess: z.literal(false),
  })
  .refine(
    (value) =>
      value.viewports.map((viewport) => viewport.viewport).join(",") ===
        "home-initial,home-action,guide-initial,guide-action" &&
      value.issueCount ===
        value.viewports.reduce((sum, viewport) => sum + viewport.issueCount, 0) &&
      value.auditPassed === (value.issueCount === 0),
    "IOS_AUDIT_CANNOT_HIDE_ISSUES_OR_MISSING_VIEWPORTS",
  );
export function parseIosAccessibilityResult(output: string) {
  const prefix = "BARO_HOME_ACCESSIBILITY_RESULT:",
    lines = output.split(/\r?\n/).filter((line) => line.startsWith(prefix));
  if (lines.length !== 1 || !lines[0]) throw Error("INTERNAL_IOS_AUDIT_SINGLE_RESULT_REQUIRED");
  return iosAccessibilityResultSchema.parse(JSON.parse(lines[0].slice(prefix.length)));
}
