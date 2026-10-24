import { expect, test } from "bun:test";
import {
  type NativeStartupPort,
  startNativeProcessor,
} from "../src/server/modules/file-processing/native-startup";

const unavailable = () =>
  new Error("there is no container instance that can be provided to this durable object");
function pending() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const state = { running: false, starts: 0, pings: 0, idle: 0, time: 0 };
  const monitors: ReturnType<typeof pending>[] = [];
  const port: NativeStartupPort = {
    running: () => state.running,
    start: () => {
      state.starts++;
      state.running = true;
    },
    monitor: () => {
      const monitor = pending();
      monitors.push(monitor);
      return monitor.promise;
    },
    configureIdle: async () => {
      state.idle++;
    },
    ready: async () => {
      state.pings++;
      return true;
    },
  };
  const options = {
    now: () => state.time,
    pause: async () => {
      state.time += 300;
    },
  };
  return {
    state,
    port,
    monitors,
    options,
    run: (signal = new AbortController().signal) => startNativeProcessor(port, signal, options),
  };
}

test("temporary allocation loss after destroy is retried before readiness, without source dispatch", async () => {
  const f = fixture();
  f.port.start = () => {
    if (++f.state.starts <= 2) throw unavailable();
    f.state.running = true;
  };
  await f.run();
  expect(f.state).toEqual({ running: true, starts: 3, pings: 1, idle: 1, time: 600 });
});

test("idle timeout is configured only on an allocated ready instance, including the next unit", async () => {
  const f = fixture();
  f.port.configureIdle = async () => {
    if (!f.state.running) throw unavailable();
    expect(f.state.pings).toBeGreaterThan(0);
    f.state.idle++;
  };
  await f.run();
  f.state.running = false;
  await f.run();
  expect(f.state.starts).toBe(2);
  expect(f.state.idle).toBe(2);
});

test("asynchronous unavailable allocation can restart within the same bounded readiness phase", async () => {
  const f = fixture();
  f.port.ready = async () => {
    f.state.pings++;
    if (f.state.pings === 1) {
      f.state.running = false;
      f.monitors[0]?.reject(unavailable());
      throw unavailable();
    }
    return true;
  };
  await f.run();
  expect(f.state.starts).toBe(2);
  expect(f.state.pings).toBe(2);
});

test("an allocated port waits for listening without starting another VM", async () => {
  const f = fixture();
  f.port.ready = async () => {
    if (++f.state.pings < 3) throw new Error("the container is not listening");
    return true;
  };
  await f.run();
  expect(f.state.starts).toBe(1);
  expect(f.state.pings).toBe(3);
});

test("an exited process is a failed attempt, not another allocation retry", async () => {
  const f = fixture();
  f.port.ready = async () => {
    f.state.pings++;
    throw new Error("the container is not listening");
  };
  f.options.pause = async () => {
    f.state.time += 300;
    f.state.running = false;
    f.monitors[0]?.reject(new Error("Container exited with unexpected exit code:1"));
  };
  await expect(f.run()).rejects.toThrow();
  expect(f.state.starts).toBe(1);
  expect(f.state.pings).toBe(1);
});

test("provider rate refusal and idle configuration failure are not retried", async () => {
  for (const phase of ["idle", "start"] as const) {
    const f = fixture();
    if (phase === "idle")
      f.port.configureIdle = async () => {
        throw new Error("synthetic configuration failure");
      };
    else
      f.port.start = () => {
        f.state.starts++;
        throw new Error("you are requesting too many containers per second");
      };
    await expect(f.run()).rejects.toThrow();
    expect(f.state.starts).toBe(1);
    expect(f.state.pings).toBe(phase === "idle" ? 1 : 0);
  }
});

test("exit during idle configuration cannot admit source after a stale healthy ping", async () => {
  const f = fixture();
  f.port.configureIdle = async () => {
    f.state.running = false;
    f.monitors[0]?.reject(new Error("Container exited while setting idle timeout"));
  };
  await expect(f.run()).rejects.toThrow("Container exited");
  expect(f.state.starts).toBe(1);
});

test("cancellation interrupts pending idle configuration without starting another process", async () => {
  const f = fixture(),
    signal = new AbortController(),
    entered = pending();
  f.port.configureIdle = async () => {
    entered.resolve();
    await pending().promise;
  };
  const execution = f.run(signal.signal);
  await entered.promise;
  signal.abort();
  await expect(execution).rejects.toThrow("ABORTED");
  expect(f.state.starts).toBe(1);
});

test("unavailable allocation stays within15seconds and50 start commands", async () => {
  const f = fixture();
  f.port.start = () => {
    f.state.starts++;
    throw unavailable();
  };
  await expect(f.run()).rejects.toThrow();
  expect(f.state.starts).toBe(50);
  expect(f.state.time).toBe(15_000);
  expect(f.state.pings).toBe(0);
});

test("readiness remains bounded by20seconds and67 polls", async () => {
  const f = fixture();
  f.port.ready = async () => {
    f.state.pings++;
    return false;
  };
  await expect(f.run()).rejects.toThrow("Container did not start");
  expect(f.state.starts).toBe(1);
  expect(f.state.pings).toBe(67);
});

test("late readiness cannot outrun the elapsed deadline if a timer is delayed", async () => {
  const f = fixture();
  f.port.ready = async () => {
    f.state.pings++;
    f.state.time = 20_001;
    return true;
  };
  await expect(f.run()).rejects.toThrow("Container did not start");
  expect(f.state.starts).toBe(1);
});

test("cancellation interrupts a pending ping even if the transport ignores its signal", async () => {
  const f = fixture(),
    signal = new AbortController(),
    entered = pending();
  f.port.ready = async () => {
    entered.resolve();
    await pending().promise;
    return true;
  };
  const execution = f.run(signal.signal);
  await entered.promise;
  signal.abort();
  await expect(execution).rejects.toThrow("ABORTED");
  expect(f.state.starts).toBe(1);
});

test("a previous unit's late monitor cannot clear or fail the new unit", async () => {
  const f = fixture();
  await f.run();
  const previous = f.monitors[0];
  f.state.running = false;
  f.port.ready = async () => {
    f.state.pings++;
    if (f.state.pings === 2) {
      previous?.reject(new Error("Container exited from previous unit"));
      return false;
    }
    return true;
  };
  await f.run();
  expect(f.state.starts).toBe(2);
  expect(f.state.pings).toBe(3);
});

test("a stopped allocation cannot admit source bytes with a stale ready response", async () => {
  const f = fixture();
  f.port.ready = async () => {
    f.state.pings++;
    f.state.running = false;
    f.monitors[0]?.reject(new Error("Container exited before readiness"));
    await Promise.resolve();
    return true;
  };
  await expect(f.run()).rejects.toThrow("Container exited before readiness");
  expect(f.state.starts).toBe(1);
});

test("aborted or unreset native state never starts a process", async () => {
  const f = fixture(),
    signal = new AbortController();
  signal.abort();
  await expect(f.run(signal.signal)).rejects.toThrow("ABORTED");
  f.state.running = true;
  await expect(f.run()).rejects.toThrow("Container still running after reset");
  expect(f.state.starts).toBe(0);
  expect(f.state.idle).toBe(0);
});
