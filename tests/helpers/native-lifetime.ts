/** Own native fixtures across Bun timeouts, which do not await the test body. */
export function createNativeLifetime() {
  const controller = new AbortController();
  let cleanup: (() => Promise<void>) | undefined;
  let disposal: Promise<void> | undefined;
  const check = () => controller.signal.throwIfAborted();
  return {
    signal: controller.signal,
    check,
    own(dispose: () => Promise<void>) {
      check();
      if (cleanup) throw new Error("Native runtime already registered");
      cleanup = dispose;
    },
    dispose() {
      controller.abort(new Error("Native test stopped"));
      // Both the body finally and afterEach join this one disposal attempt.
      disposal ??= Promise.resolve().then(() => cleanup?.());
      return disposal;
    },
  };
}

export type NativeLifetime = ReturnType<typeof createNativeLifetime>;

export function createNativeTestRegistry() {
  const active = new Set<{ lifetime: NativeLifetime; settled: Promise<void> }>();
  return {
    run<T>(action: (lifetime: NativeLifetime) => Promise<T>) {
      const lifetime = createNativeLifetime();
      const task = Promise.resolve()
        .then(() => {
          lifetime.check();
          return action(lifetime);
        })
        .finally(() => lifetime.dispose());
      // Observe completion for cleanup without changing the returned rejection.
      const entry = {
        lifetime,
        settled: task.then(
          () => {},
          () => {},
        ),
      };
      active.add(entry);
      void entry.settled.then(() => active.delete(entry));
      return task;
    },
    async stop() {
      await Promise.all(
        [...active].map(async ({ lifetime, settled }) => {
          try {
            await lifetime.dispose();
          } finally {
            // Closing the runtime rejects pending native IO; wait for the old
            // body to unwind before Bun starts the next fixture.
            await settled;
          }
        }),
      );
    },
  };
}
