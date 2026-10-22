/** An identity change invalidates pending results; it never grants server permissions. */
export function createSessionScope() {
  let generation = 0;
  let identity: string | null = null;
  return {
    snapshot: () => generation,
    isCurrent: (value: number) => value === generation,
    invalidate() {
      generation++;
    },
    transition(nextIdentity: string | null) {
      if (nextIdentity !== identity) {
        identity = nextIdentity;
        generation++;
      }
    },
  };
}
export type SessionScope = ReturnType<typeof createSessionScope>;
