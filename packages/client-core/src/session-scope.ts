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
    set(_target, key, value) {
      refresh();
      return Reflect.set(current, key, value);
    },
    get(_target, key) {
      refresh();
      const value = Reflect.get(current, key);
      if (typeof value !== "function") return value;
      const readGeneration = generation;
      return (...args: unknown[]) => {
        refresh();
        // A held method remains callable when wrapped within the same instance.
        // Only an identity change redirects it to the fresh account's method.
        const method = generation === readGeneration ? value : Reflect.get(current, key);
        if (typeof method !== "function") throw new Error("CLIENT_METHOD_UNAVAILABLE");
        return Reflect.apply(method, current, args);
      };
    },
  });
}
