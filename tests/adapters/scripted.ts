/** Test-only deterministic dependencies: no network, timers, credentials or paid inference. */
export type Failure = "network" | "rate_limited" | "unavailable" | "timeout" | "schema";
export type Outcome<T> = { value: T } | { failure: Failure };

export class OfflineDependencyError extends Error {
  constructor(readonly code: Failure | "script_exhausted") {
    super(`Offline dependency: ${code}`);
    this.name = "OfflineDependencyError";
  }
}

export function scriptedAdapter<T>(outcomes: readonly Outcome<T>[]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    get remaining() {
      return Math.max(0, outcomes.length - calls);
    },
    async call(_input: unknown): Promise<T> {
      const outcome = outcomes[calls++];
      if (!outcome) throw new OfflineDependencyError("script_exhausted");
      if ("failure" in outcome) throw new OfflineDependencyError(outcome.failure);
      return structuredClone(outcome.value);
    },
  };
}

// Raw output is intentional: consumers must exercise their own schema/citation validation.
export const createModelAdapter = (outcomes: readonly Outcome<unknown>[]) =>
  scriptedAdapter(outcomes);
export const createLegalAdapter = (outcomes: readonly Outcome<unknown>[]) =>
  scriptedAdapter(outcomes);

export function createTurnstileAdapter(options: {
  hostname: string;
  tokens: readonly { token: string; expiresAt: number; action?: string; hostname?: string }[];
  now: () => number;
  unavailable?: boolean;
}) {
  const consumed = new Set<string>();
  const tokens = new Map(options.tokens.map((token) => [token.token, token]));
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async verify(token: string) {
      calls++;
      if (options.unavailable) throw new OfflineDependencyError("timeout");
      const configured = tokens.get(token);
      if (!configured || consumed.has(token) || configured.expiresAt <= options.now())
        return { success: false as const, code: "invalid_or_expired" as const };
      consumed.add(token);
      if (
        (configured.action ?? "case_create") !== "case_create" ||
        (configured.hostname ?? options.hostname) !== options.hostname
      )
        return { success: false as const, code: "context_mismatch" as const };
      return { success: true as const, action: "case_create", hostname: options.hostname };
    },
  };
}
