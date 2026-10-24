import { z } from "zod";

const operation = z.enum([
  "hierarchy-dump",
  "hierarchy-dump-all-windows",
  "file-read",
  "file-remove",
  "display-read",
  "activity-read",
  "ime-read",
  "rotation-setting",
  "rotation-control",
  "tap",
  "swipe",
  "input-text",
  "keyevent",
  "other",
]);
export const androidNativeCommandFailureSchema = z
  .strictObject({
    operation,
    category: z.enum(["nonzero-exit", "timeout", "spawn-or-stream-failed"]),
    exitCode: z.number().int().nullable(),
    timedOut: z.boolean(),
  })
  .refine(
    (v) =>
      (v.category === "timeout") === v.timedOut &&
      (v.category !== "nonzero-exit" || (v.exitCode !== null && v.exitCode !== 0)),
  );
type Failure = z.infer<typeof androidNativeCommandFailureSchema>;
export type AndroidHierarchyDumpOutcome = "saved" | "idle-timeout" | "root-unavailable" | "unknown";
export function androidHierarchyDumpOutcome(
  stdout: string,
  stderr: string,
  expectedFile: string,
): AndroidHierarchyDumpOutcome {
  if (
    stdout.length + stderr.length > 65536 ||
    !/^\/sdcard\/baro-(?:directory|launcher|auth)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.xml$/.test(
      expectedFile,
    )
  )
    return "unknown";
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/);
  const saved = lines.filter((line) => line.startsWith("UI hierchary dumped to:"));
  const errors = lines.filter((line) => line.startsWith("ERROR:"));
  if (errors.length === 1 && saved.length === 0) {
    if (errors[0] === "ERROR: could not get idle state.") return "idle-timeout";
    if (errors[0] === "ERROR: null root node returned by UiTestAutomationBridge.")
      return "root-unavailable";
  }
  return errors.length === 0 &&
    saved.length === 1 &&
    saved[0] === `UI hierchary dumped to: ${expectedFile}`
    ? "saved"
    : "unknown";
}

/** Classify structure only; never return executable, device, arguments, paths or input. */
export function androidNativeCommandOperation(args: readonly string[]): z.infer<typeof operation> {
  if (
    args[0]?.split("/").at(-1) !== "adb" ||
    args[1] !== "-s" ||
    !/^emulator-\d{4,5}$/.test(args[2] ?? "") ||
    args[3] !== "shell"
  )
    return "other";
  const command = args.slice(4);
  if (command[0] === "uiautomator" && command[1] === "dump")
    return command.includes("--windows") ? "hierarchy-dump-all-windows" : "hierarchy-dump";
  if (command[0] === "cat") return "file-read";
  if (command[0] === "rm") return "file-remove";
  if (command.slice(0, 3).join(" ") === "dumpsys window displays") return "display-read";
  if (command.slice(0, 3).join(" ") === "dumpsys activity activities") return "activity-read";
  if (command.slice(0, 4).join(" ") === "settings get secure default_input_method")
    return "ime-read";
  if (command.slice(0, 4).join(" ") === "settings get system user_rotation")
    return "rotation-setting";
  if (command[0] === "wm" && command[1] === "user-rotation") return "rotation-control";
  if (command[0] === "input") {
    if (command[1] === "tap") return "tap";
    if (command[1] === "swipe") return "swipe";
    if (command[1] === "text") return "input-text";
    if (command[1] === "keyevent") return "keyevent";
  }
  return "other";
}
export function androidPostBoundaryCommandFailures() {
  let first: Failure | null = null,
    last: Failure | null = null,
    count = 0;
  return {
    record(value: Failure) {
      const safe = androidNativeCommandFailureSchema.parse(value);
      first ??= safe;
      last = safe;
      count += 1;
    },
    snapshot() {
      return { count, first: first && { ...first }, last: last && { ...last } };
    },
  };
}

/** Same bounded process execution, with fixed failure facts and no persisted output. */
export async function runAndroidHomeCommand(context: {
  args: readonly string[];
  cwd: string;
  env: Record<string, string | undefined>;
  input?: string;
  timeoutMs?: number;
  onFailure: (failure: Failure) => void;
  onHierarchyDump?: (outcome: AndroidHierarchyDumpOutcome) => void;
}) {
  const timeout = context.timeoutMs ?? 120000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000)
    throw Error("BUNDLED_HOME_COMMAND_FAILED");
  let timedOut = false,
    exitCode: number | null = null,
    recorded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let terminate: (() => void) | undefined;
  const fail = (category: Failure["category"]) => {
    recorded = true;
    context.onFailure({
      operation: androidNativeCommandOperation(context.args),
      category,
      exitCode,
      timedOut,
    });
  };
  try {
    const child = Bun.spawn([...context.args], {
      cwd: context.cwd,
      env: context.env,
      stdin: context.input === undefined ? "ignore" : new Blob([context.input]),
      stdout: "pipe",
      stderr: "pipe",
    });
    terminate = () => {
      try {
        child.kill();
      } catch {
        /* Retain only fixed command failure facts. */
      }
    };
    timer = setTimeout(() => {
      timedOut = true;
      terminate?.();
    }, timeout);
    const [body, stderr] = await Promise.all([
      new Response(child.stdout).arrayBuffer(),
      new Response(child.stderr).arrayBuffer(),
    ]);
    exitCode = await child.exited;
    const kind = androidNativeCommandOperation(context.args);
    if (kind === "hierarchy-dump" || kind === "hierarchy-dump-all-windows")
      context.onHierarchyDump?.(
        androidHierarchyDumpOutcome(
          new TextDecoder().decode(body),
          new TextDecoder().decode(stderr),
          context.args.at(-1) ?? "",
        ),
      );
    if (timedOut || exitCode !== 0) {
      fail(timedOut ? "timeout" : "nonzero-exit");
      throw Error("BUNDLED_HOME_COMMAND_FAILED");
    }
    return new Uint8Array(body);
  } catch {
    if (!recorded) {
      terminate?.();
      fail(timedOut ? "timeout" : "spawn-or-stream-failed");
    }
    throw Error("BUNDLED_HOME_COMMAND_FAILED");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
