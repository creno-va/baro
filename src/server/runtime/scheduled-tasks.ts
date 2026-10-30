/** A failed cleanup must not prevent durable job recovery in the same minute.
 * Keep tasks sequential so existing capacity/deletion transaction order holds. */
type ScheduledStage =
  | "v2_dispatch"
  | "legacy_deletion"
  | "auth_cleanup"
  | "directory_cleanup"
  | "legacy_dispatch"
  | "legacy_timeouts"
  | "upload_cleanup"
  | "v2_deletion";
export async function runScheduledTasks(
  tasks: readonly { stage: ScheduledStage; run: () => Promise<unknown> }[],
) {
  for (const task of tasks) {
    try {
      await task.run();
    } catch {
      // Never log case contents, SQL, tokens or provider error bodies.
      console.warn(JSON.stringify({ event: "scheduled_task_failure", stage: task.stage }));
    }
  }
}
