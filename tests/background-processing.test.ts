import { expect, spyOn, test } from "bun:test";
import { backgroundDispatch } from "../src/server/modules/workspace/background-dispatch";
import { runScheduledTasks } from "../src/server/runtime/scheduled-tasks";

test("admission returns while durable dispatch is still pending, independently of the request", async () => {
  const gate = Promise.withResolvers<void>();
  const tasks: Promise<unknown>[] = [];
  let started = false,
    finished = false;
  const dependencies = backgroundDispatch(
    {
      dispatch: async () => {
        started = true;
        await gate.promise;
        finished = true;
      },
    },
    (task) => {
      tasks.push(task);
    },
  );
  await dependencies.dispatch?.();
  expect(started).toBe(true);
  expect(finished).toBe(false);
  expect(tasks).toHaveLength(1);
  gate.resolve();
  await Promise.all(tasks);
  expect(finished).toBe(true);
});

test("a failed dispatch/context is recoverable and a cleanup failure does not skip later recovery", async () => {
  await backgroundDispatch(
    {
      dispatch: async () => {
        throw new Error("SYNTHETIC_BINDING");
      },
    },
    () => {
      throw new Error("SYNTHETIC_CLOSED_CONTEXT");
    },
  ).dispatch?.();
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  const order: number[] = [];
  try {
    await runScheduledTasks([
      {
        stage: "auth_cleanup",
        run: async () => {
          order.push(1);
          throw new Error("SYNTHETIC_CLEANUP_FAILURE");
        },
      },
      {
        stage: "legacy_dispatch",
        run: async () => {
          order.push(2);
        },
      },
    ]);
    expect(order).toEqual([1, 2]);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0]?.[0]).not.toContain("SYNTHETIC");
  } finally {
    warning.mockRestore();
  }
});
