import { z } from "zod";

const fields = {
  LawSearch: ["list", "object"],
  law: ["candidates", "object_or_array"],
  totalCnt: ["total_count", "integer"],
  법령: ["detail", "object"],
  기본정보: ["basic_info", "object"],
  법령ID: ["law_id", "digits"],
  법령일련번호: ["law_version", "digits"],
  법령명한글: ["law_title", "text"],
  법령명_한글: ["law_title", "text"],
  시행일자: ["effective_date", "date"],
  공포일자: ["promulgation_date", "date"],
  공포번호: ["promulgation_number", "text_or_integer"],
  조문: ["articles", "object"],
  조문단위: ["article_rows", "object_or_array"],
  조문번호: ["article_number", "digits"],
  조문가지번호: ["article_branch", "digits"],
  조문여부: ["article_kind", "text"],
  조문내용: ["article_text", "text_or_array"],
  조문시행일자: ["article_effective_date", "date"],
  항: ["paragraph", "object_or_array"],
  항내용: ["paragraph_text", "text"],
  호: ["item", "object_or_array"],
  호내용: ["item_text", "text"],
  목: ["subitem", "object_or_array"],
  목내용: ["subitem_text", "text"],
} as const;
export const legalSchemaDiagnosticSchema = z.strictObject({
  stage: z.enum(["statute_list", "statute_detail", "statute_nested", "response_json"]),
  issues: z
    .array(
      z.strictObject({
        field: z.enum([
          "root",
          "response",
          "unknown",
          ...Object.values(fields).map(([field]) => field),
        ]),
        expected: z.enum([
          "object",
          "object_or_array",
          "integer",
          "digits",
          "text",
          "date",
          "text_or_integer",
          "text_or_array",
          "json",
          "unknown",
        ]),
      }),
    )
    .min(1)
    .max(4),
});
export type LegalSchemaDiagnostic = z.infer<typeof legalSchemaDiagnosticSchema>;

/** Output only fixed labels. Never retain a Zod message, input, path index or unknown key. */
export function legalSchemaDiagnostic(
  stage: LegalSchemaDiagnostic["stage"],
  error: z.ZodError,
): LegalSchemaDiagnostic {
  const issues: LegalSchemaDiagnostic["issues"] = [];
  const visit = (
    entries: readonly z.core.$ZodIssue[],
    depth = 0,
    parentPath: readonly PropertyKey[] = [],
  ) => {
    if (depth > 4 || issues.length >= 4) return;
    for (const issue of entries) {
      if (issues.length >= 4) return;
      const path = [...parentPath, ...issue.path];
      if (issue.code === "invalid_union") {
        for (const branch of issue.errors) visit(branch, depth + 1, path);
        continue;
      }
      const key = path
        .reverse()
        .find((part) => typeof part === "string" && Object.hasOwn(fields, part));
      const [field, expected] =
        typeof key === "string"
          ? fields[key as keyof typeof fields]
          : path.length
            ? (["unknown", "unknown"] as const)
            : (["root", "object"] as const);
      if (!issues.some((existing) => existing.field === field && existing.expected === expected))
        issues.push({ field, expected });
    }
  };
  visit(error.issues);
  return { stage, issues: issues.length ? issues : [{ field: "unknown", expected: "unknown" }] };
}

export function safeLegalSchemaDiagnostic(value: unknown) {
  const parsed = legalSchemaDiagnosticSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
