import { z } from "zod";

const failures = [
  "ANDROID_PACKAGE_MANAGER_OWNED_PREFLIGHT_REQUIRED",
  "ANDROID_PACKAGE_MANAGER_DEADLINE_INVALID",
  "ANDROID_PACKAGE_MANAGER_DEADLINE_EXPIRED",
  "ANDROID_PACKAGE_MANAGER_WAIT_FAILED",
  "ANDROID_PACKAGE_MANAGER_UNCONFIRMED",
] as const;
export function androidPackageReadinessFailureCode(error: unknown) {
  return (
    failures.find((code) => error instanceof Error && error.message === code) ??
    "ANDROID_PACKAGE_MANAGER_WAIT_FAILED"
  );
}
export const androidPackageReadinessSchema = z.strictObject({
  kind: z.literal("owned-android-package-manager-readiness"),
  observedAt: z.iso.datetime(),
  handlersCompleted: z.tuple([z.literal("foreground"), z.literal("background")]),
  handlerTimeoutsMs: z.tuple([
    z.number().int().min(1).max(15000),
    z.number().int().min(1).max(15000),
  ]),
  commandsCompleted: z.literal(2),
  sharedFirstColdBudgetMaxMs: z.literal(120000),
  rootCauseConfirmed: z.literal(false),
  launcherReadinessVerified: z.literal(false),
  dialogDismissed: z.literal(false),
});
export interface AndroidPackageReadinessDiagnostic {
  stage: "foreground" | "background" | "complete";
  commandsCompleted: number;
  timeoutMs: number | null;
  failureCode: ReturnType<typeof androidPackageReadinessFailureCode> | null;
}

/** Package queues only. Launcher health still requires its separate, unchanged readiness check. */
export async function observeAndroidPackageReadiness(context: {
  shell(args: string[], timeoutMs: number): Promise<string>;
  deviceSerial: string;
  avdName: string;
  freshOwnedEmulator: boolean;
  productLaunchStarted: boolean;
  captureBoundaryEntered: boolean;
  deadline: number;
  now?: () => number;
  diagnostic(value: AndroidPackageReadinessDiagnostic): void;
}) {
  if (
    !/^emulator-\d{4,5}$/.test(context.deviceSerial) ||
    !/^baro_runtime_[a-f0-9]{12}$/.test(context.avdName) ||
    context.freshOwnedEmulator !== true ||
    context.productLaunchStarted !== false ||
    context.captureBoundaryEntered !== false
  )
    throw Error("ANDROID_PACKAGE_MANAGER_OWNED_PREFLIGHT_REQUIRED");
  const now = context.now ?? Date.now,
    initial = now();
  if (
    !Number.isSafeInteger(initial) ||
    initial < 0 ||
    !Number.isSafeInteger(context.deadline) ||
    context.deadline <= initial ||
    context.deadline > initial + 120000
  )
    throw Error("ANDROID_PACKAGE_MANAGER_DEADLINE_INVALID");
  const timeouts: number[] = [];
  let lastTime = initial;
  const currentTime = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < lastTime)
      throw Error("ANDROID_PACKAGE_MANAGER_DEADLINE_EXPIRED");
    lastTime = value;
    return value;
  };
  let stage: AndroidPackageReadinessDiagnostic["stage"] = "foreground",
    timeoutMs: number | null = null;
  const report = (failureCode: AndroidPackageReadinessDiagnostic["failureCode"] = null) =>
    context.diagnostic({ stage, commandsCompleted: timeouts.length, timeoutMs, failureCode });
  try {
    for (const handler of ["foreground", "background"] as const) {
      stage = handler;
      const remaining = context.deadline - currentTime();
      if (remaining <= 0) throw Error("ANDROID_PACKAGE_MANAGER_DEADLINE_EXPIRED");
      timeoutMs = Math.min(15000, remaining);
      report();
      let output: string;
      try {
        output = await context.shell(
          [
            "pm",
            handler === "foreground" ? "wait-for-handler" : "wait-for-background-handler",
            "--timeout",
            String(timeoutMs),
          ],
          timeoutMs,
        );
      } catch {
        throw Error("ANDROID_PACKAGE_MANAGER_WAIT_FAILED");
      }
      if (output.length > 128 || output.trim() !== "Success")
        throw Error("ANDROID_PACKAGE_MANAGER_UNCONFIRMED");
      if (currentTime() >= context.deadline)
        throw Error("ANDROID_PACKAGE_MANAGER_DEADLINE_EXPIRED");
      timeouts.push(timeoutMs);
      report();
    }
    stage = "complete";
    report();
    const observedAt = currentTime();
    if (observedAt >= context.deadline) throw Error("ANDROID_PACKAGE_MANAGER_DEADLINE_EXPIRED");
    return androidPackageReadinessSchema.parse({
      kind: "owned-android-package-manager-readiness",
      observedAt: new Date(observedAt).toISOString(),
      handlersCompleted: ["foreground", "background"],
      handlerTimeoutsMs: timeouts,
      commandsCompleted: 2,
      sharedFirstColdBudgetMaxMs: 120000,
      rootCauseConfirmed: false,
      launcherReadinessVerified: false,
      dialogDismissed: false,
    });
  } catch (error) {
    report(androidPackageReadinessFailureCode(error));
    throw error;
  }
}
