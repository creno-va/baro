/** An identity change invalidates pending results; it never grants server permissions. */
export function createSessionScope() {
  let generation = 0;
  let identity: string | null = null;
  let controller = new AbortController();
  const invalidate = () => {
    generation++;
    controller.abort();
    controller = new AbortController();
  };
  return {
    snapshot: () => generation,
    signal: () => controller.signal,
    isCurrent: (value: number) => value === generation,
    invalidate,
    transition(nextIdentity: string | null) {
      if (nextIdentity !== identity) {
        identity = nextIdentity;
        invalidate();
      }
    },
  };
}
export type SessionScope = ReturnType<typeof createSessionScope>;

/** Resolve a fresh domain instance when permissions change; old requests retain their old scope. */
export function createSessionBoundClient<T extends object>(
  scope: SessionScope,
  create: () => T,
): T {
  let generation = scope.snapshot();
  let current = create();
  const refresh = () => {
    if (generation !== scope.snapshot()) {
      const nextGeneration = scope.snapshot();
      const next = create();
      current = next;
      generation = nextGeneration;
    }
  };
  return new Proxy(current, {
    get(_target, key) {
      refresh();
      const value = Reflect.get(current, key);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        refresh();
        const method = Reflect.get(current, key);
        if (typeof method !== "function") throw new Error("CLIENT_METHOD_UNAVAILABLE");
        return Reflect.apply(method, current, args);
      };
    },
  });
}
