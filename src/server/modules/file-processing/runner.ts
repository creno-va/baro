import type { WorkflowStep } from "cloudflare:workers";
import type { FileProcessingExecution } from "./execution";

/** Workflow history contains only bounded counts and statuses. Native bodies,
 * observations and transcripts remain encrypted in the execution repository.
 * Each media unit is 30 seconds; the deadline applies to a step, not a file.
 */
export async function runFileProcessing(execution: FileProcessingExecution, step: WorkflowStep) {
  const bounded = <T extends Rpc.Serializable<T>>(
    name: string,
    work: (signal: AbortSignal) => Promise<T>,
  ) =>
    step.do(name, { retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" }, async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 240000);
      try {
        return await work(controller.signal);
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    });
  try {
    const initial = await bounded("initialize", () => execution.initialize());
    if (initial.status === "ready") return { status: "ready" as const };
    for (let unit = 0; unit < initial.totalUnits; unit++) {
      const native = await bounded(`extract ${unit}`, (signal) =>
        execution.extractUnit(unit, signal),
      );
      for (let index = 0; index < native.artifactCount; index++)
        await bounded(`interpret ${unit} ${index}`, (signal) =>
          execution.interpretArtifact(unit, index, signal),
        );
      await bounded(`prepare unit ${unit}`, (signal) => execution.prepareUnit(unit, signal));
    }
    const publication = await bounded("prepare publication", (signal) =>
      execution.preparePublication(initial.totalUnits, signal),
    );
    for (let index = 0; index < publication.partCount; index++)
      await bounded(`coverage ${index}`, (signal) => execution.stageCoveragePart(index, signal));
    for (let unit = 0; unit < initial.totalUnits; unit++) {
      const plan = await bounded(`result count ${unit}`, (signal) =>
        execution.prepareUnit(unit, signal),
      );
      for (let index = 0; index < plan.artifactCount; index++) {
        const pages = await bounded(`result pages ${unit} ${index}`, () =>
          execution.resultPages(unit, index),
        );
        for (let page = 0; page < pages.pageCount; page++)
          await bounded(`result ${unit} ${index} ${page}`, (signal) =>
            execution.stageResultPage(unit, index, page, signal),
          );
      }
    }
    return await bounded("publish", (signal) => execution.publish(signal));
  } catch (error) {
    // Failure records are sanitized by execution; exception text/stack and
    // provider bodies must never become durable Workflow return values.
    return step.do("record stopped processing", () => execution.fail(error));
  }
}
