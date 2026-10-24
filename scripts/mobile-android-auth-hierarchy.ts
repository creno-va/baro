import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type AndroidHierarchyDumpOutcome,
  androidHierarchyDumpOutcome,
} from "./mobile-android-command-observation";

export const androidAuthHierarchyDiagnosticSchema = z.strictObject({
  outcome: z.enum(["saved", "idle-timeout", "root-unavailable", "unknown"]).nullable(),
  primaryFailureCode: z
    .enum([
      "ANDROID_AUTH_DUMP_FAILED",
      "ANDROID_AUTH_DUMP_UNCONFIRMED",
      "ANDROID_AUTH_HIERARCHY_READ_FAILED",
    ])
    .nullable(),
  cleanupFailureCode: z.literal("ANDROID_AUTH_HIERARCHY_CLEANUP_FAILED").nullable(),
});
export type AndroidAuthHierarchyDiagnostic = z.infer<typeof androidAuthHierarchyDiagnosticSchema>;

/** Never read an unconfirmed or reused dump, and never hide failed cleanup behind a successful observation. */
export async function readAndroidAuthHierarchy(context: {
  shell(args: string[]): Promise<string>;
  /** Actual command wrapper classifies combined stdout/stderr without exporting either. */
  dumpHierarchy?: (file: string) => Promise<AndroidHierarchyDumpOutcome>;
  diagnostic(value: AndroidAuthHierarchyDiagnostic): void;
}): Promise<string | null> {
  const file = `/sdcard/baro-auth-${randomUUID()}.xml`;
  let outcome: AndroidAuthHierarchyDiagnostic["outcome"] = null;
  let primaryFailureCode: AndroidAuthHierarchyDiagnostic["primaryFailureCode"] = null;
  let cleanupFailureCode: AndroidAuthHierarchyDiagnostic["cleanupFailureCode"] = null;
  let xml: string | null = null;
  try {
    try {
      outcome = context.dumpHierarchy
        ? await context.dumpHierarchy(file)
        : androidHierarchyDumpOutcome(
            await context.shell(["uiautomator", "dump", "--compressed", file]),
            "",
            file,
          );
    } catch {
      primaryFailureCode = "ANDROID_AUTH_DUMP_FAILED";
    }
    if (!primaryFailureCode) {
      if (outcome === "saved") {
        try {
          xml = await context.shell(["cat", file]);
        } catch {
          primaryFailureCode = "ANDROID_AUTH_HIERARCHY_READ_FAILED";
        }
      } else if (outcome !== "idle-timeout" && outcome !== "root-unavailable") {
        primaryFailureCode = "ANDROID_AUTH_DUMP_UNCONFIRMED";
      }
    }
  } finally {
    try {
      await context.shell(["rm", "-f", file]);
    } catch {
      cleanupFailureCode = "ANDROID_AUTH_HIERARCHY_CLEANUP_FAILED";
    }
    context.diagnostic(
      androidAuthHierarchyDiagnosticSchema.parse({
        outcome,
        primaryFailureCode,
        cleanupFailureCode,
      }),
    );
  }
  if (primaryFailureCode) throw new Error(primaryFailureCode);
  if (cleanupFailureCode) throw new Error(cleanupFailureCode);
  return xml;
}
