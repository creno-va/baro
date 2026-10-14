import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeTestRegistry } from "./helpers/native-lifetime";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("native completion disposes once even when body finally and afterEach both close it", async () => {
  const registry = createNativeTestRegistry();
  let disposals = 0;
  const value = await registry.run(async (lifetime) => {
    lifetime.own(async () => {
      disposals++;
    });
    try {
      lifetime.check();
      return "completed";
    } finally {
      await lifetime.dispose();
    }
  });
  await registry.stop();
  await registry.stop();
  expect(value).toBe("completed");
  expect(disposals).toBe(1);
});

test("native shutdown aborts work, joins pending cleanup and prevents follow-on IO", async () => {
  const registry = createNativeTestRegistry();
  const started = deferred();
  const released = deferred();
  const disposalStarted = deferred();
  const disposalFinished = deferred();
  let disposals = 0,
    followOnIO = 0,
    stopped = false;
  const task = registry.run(async (lifetime) => {
    lifetime.own(async () => {
      disposals++;
      disposalStarted.resolve();
      await disposalFinished.promise;
      released.resolve();
    });
    started.resolve();
    await released.promise;
    lifetime.check();
    followOnIO++;
  });
  await started.promise;
  const stop = registry.stop().then(() => {
    stopped = true;
  });
  await disposalStarted.promise;
  expect(stopped).toBe(false);
  disposalFinished.resolve();
  await expect(task).rejects.toThrow("Native test stopped");
  await stop;
  await registry.stop();
  expect(stopped).toBe(true);
  expect(followOnIO).toBe(0);
  expect(disposals).toBe(1);
});

test("native body failure stays rejected and cleanup failure is never silently retried", async () => {
  const registry = createNativeTestRegistry();
  const failure = new Error("Synthetic test failure");
  let disposals = 0;
  await expect(
    registry.run(async (lifetime) => {
      lifetime.own(async () => {
        disposals++;
      });
      throw failure;
    }),
  ).rejects.toBe(failure);
  await registry.stop();
  expect(disposals).toBe(1);

  const cleanupFailure = new Error("Synthetic cleanup failure");
  await expect(
    registry.run(async (lifetime) => {
      lifetime.own(async () => {
        disposals++;
        throw cleanupFailure;
      });
      return "completed";
    }),
  ).rejects.toBe(cleanupFailure);
  await registry.stop();
  expect(disposals).toBe(2);
});

test("Bun timeout cleanup finishes before the next test starts, unlike body-only finally", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baro-native-lifetime-"));
  const helper = new URL("./helpers/native-lifetime.ts", import.meta.url).pathname;
  try {
    for (const joinCleanup of [false, true]) {
      const path = join(directory, "timeout.test.ts");
      await Bun.write(
        path,
        `import { afterEach, expect, test } from "bun:test";
import { createNativeTestRegistry } from ${JSON.stringify(helper)};
const registry = createNativeTestRegistry();
let disposed = 0, cleanupDone = false, resumed = false, lateIO = 0;
afterEach(() => ${joinCleanup ? "registry.stop()" : "Promise.resolve()"});
test("synthetic stalled native body", () => registry.run(async (lifetime) => {
  lifetime.own(async () => {
    disposed++;
    await Promise.resolve();
    cleanupDone = true;
  });
  await new Promise((resolve) => lifetime.signal.addEventListener("abort", resolve, { once: true }));
  resumed = true;
  lifetime.check();
  lateIO++;
}), 30);
test("next fixture starts after cleanup", () => {
  expect(disposed).toBe(1);
  expect(cleanupDone).toBe(true);
  expect(resumed).toBe(true);
  expect(lateIO).toBe(0);
  console.log("NEXT_FIXTURE_CLEAN");
});`,
      );
      const child = Bun.spawn([process.execPath, "test", path], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exit).toBe(1); // The deliberately stalled first test must still fail.
      expect(stdout.includes("NEXT_FIXTURE_CLEAN")).toBe(joinCleanup);
      expect(stderr).toContain(joinCleanup ? "1 pass" : "0 pass");
      expect(stderr).toContain(joinCleanup ? "1 fail" : "2 fail");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
