import { expect, test } from "bun:test";
import {
  createResolutionSelectionFailureTracker,
  type ResolutionSelectionFailureStep,
  resolutionErrorDiagnostic,
} from "../src/components/resolution/error-diagnostic";

const reads = ["files_read", "report_read", "resolution_read"] as const;
function deferred() {
  let reject = (_error: unknown) => {};
  const promise = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  return { promise, reject };
}

test.each([...reads])(
  "%s remains the first failure after the other parallel reads reject",
  async (first) => {
    const tracker = createResolutionSelectionFailureTracker();
    const entries = reads.map((step) => ({
      step,
      gate: deferred(),
      error: new Error("SYNTHETIC-STEP-PRIVATE"),
    }));
    const observed = entries.map(({ step, gate }) => tracker.observe(step, () => gate.promise));
    const settled = Promise.all(observed).catch((error: unknown) => error);
    expect(tracker.snapshot()).toBe("unknown");
    const entry = entries.find(({ step }) => step === first);
    if (!entry) throw Error("synthetic read missing");
    entry.gate.reject(entry.error);
    expect(await settled).toBe(entry.error);
    const snapshot = tracker.snapshot();
    expect(snapshot).toBe(first);
    for (const other of entries) if (other !== entry) other.gate.reject(other.error);
    await Promise.allSettled(observed);
    expect(tracker.snapshot()).toBe(first);
    expect(snapshot).toBe(first);
  },
);

test("selection failure preserves the exact error and finite metadata, never its arbitrary step", async () => {
  const tracker = createResolutionSelectionFailureTracker();
  const error = Object.assign(new Error("SYNTHETIC-STEP-PRIVATE"), {
    code: "CONFLICT",
    httpStatus: 409,
    transportFailure: "unknown",
    step: "SYNTHETIC-STEP-PRIVATE",
    body: "SYNTHETIC-STEP-PRIVATE",
  });
  const before = Object.getOwnPropertyDescriptors(error);
  const result = await tracker
    .observe("selection_update", async () => {
      throw error;
    })
    .catch((failure: unknown) => failure);
  expect(result).toBe(error);
  expect(Object.getOwnPropertyDescriptors(error)).toEqual(before);
  expect(tracker.snapshot()).toBe("selection_update");
  expect(resolutionErrorDiagnostic(result)).toEqual({
    code: "CONFLICT",
    httpStatus: 409,
    transport: "unknown",
  });
});

test("successful and pending methods are never labelled as failures and are each invoked once", async () => {
  const tracker = createResolutionSelectionFailureTracker();
  let count = 0;
  for (const step of [...reads, "selection_update"] as const) {
    expect(
      await tracker.observe(step, async () => {
        count++;
        return step;
      }),
    ).toBe(step);
    expect(tracker.snapshot()).toBe("unknown");
  }
  expect(count).toBe(4);
});

test("synchronous throws are preserved and old trackers cannot affect a new attempt or its snapshot", async () => {
  const old = createResolutionSelectionFailureTracker();
  const current = createResolutionSelectionFailureTracker();
  const gate = deferred();
  const pending = old.observe("report_read", () => gate.promise).catch((error: unknown) => error);
  const error = new Error("SYNTHETIC-STEP-PRIVATE");
  let actual: unknown;
  try {
    current.observe("selection_update", () => {
      throw error;
    });
  } catch (failure) {
    actual = failure;
  }
  expect(actual).toBe(error);
  const snapshot: ResolutionSelectionFailureStep = current.snapshot();
  gate.reject(error);
  expect(await pending).toBe(error);
  expect(old.snapshot()).toBe("report_read");
  expect(current.snapshot()).toBe("selection_update");
  expect(snapshot).toBe("selection_update");
});
