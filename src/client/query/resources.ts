import type { SessionView } from "@baro/client-core";
import type { QueryClient } from "@tanstack/react-query";

export { queryKeys } from "./client";

export type WebSessionSnapshot = {
  session: SessionView | undefined;
  /** Opaque cache scope. Use session.user.id for API expectedOwner headers. */
  owner: string | null;
  ready: boolean;
  error: unknown;
};

const initialSnapshot: WebSessionSnapshot = {
  session: undefined,
  owner: null,
  ready: false,
  error: null,
};
const anonymous: SessionView = { user: null, needsConsent: false };

/**
 * One authorization source for the entire island. Notifications only revoke local
 * access. A fresh server response is required before private content is exposed.
 */
export function createWebSessionController(deps: {
  client: QueryClient;
  readSession: () => Promise<SessionView>;
  invalidateTransport: () => void;
  signOut: () => Promise<void>;
}) {
  let snapshot = initialSnapshot;
  let generation = 0;
  let identity: string | null = null;
  let currentOwner: string | null = null;
  let pending: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: WebSessionSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const clearPrivateState = () => {
    generation++;
    pending = undefined;
    identity = null;
    currentOwner = null;
    // clear() destroys queries and cancels their retries/read signals. Already
    // admitted server mutations continue; their old generation cannot become visible.
    deps.client.clear();
    deps.invalidateTransport();
  };
  const invalidate = (signedOut = false) => {
    clearPrivateState();
    publish({
      session: signedOut ? anonymous : undefined,
      owner: null,
      ready: signedOut,
      error: null,
    });
  };
  const refresh = (): Promise<void> => {
    if (pending) return pending;
    const ticket = generation;
    const previouslyVerified =
      snapshot.ready && snapshot.session?.user !== null && currentOwner !== null;
    const previousIdentity = identity;
    const previousOwner = currentOwner;
    // Preserve a verified view and unsent drafts during ordinary focus checks.
    // Explicit auth notifications/pagehide already revoke it synchronously.
    if (!snapshot.ready || !snapshot.session)
      publish({ session: undefined, owner: null, ready: false, error: null });
    const request = Promise.resolve()
      .then(deps.readSession)
      .then((value) => {
        if (ticket !== generation) return;
        const nextIdentity = value.user
          ? JSON.stringify([value.user.id, value.user.accountType, value.needsConsent])
          : null;
        if (nextIdentity !== identity) {
          // A role/consent change is a permissions change even for the same user.
          clearPrivateState();
          identity = nextIdentity;
          currentOwner = value.user ? JSON.stringify([value.user.id, generation]) : null;
        }
        publish({
          session: { ...value, user: value.user ? { ...value.user } : null },
          owner: currentOwner,
          ready: true,
          error: null,
        });
        // Revalidate visible data only after the same server-verified identity
        // returns. Initial authorization and identity transitions mount their own
        // fresh queries; invalidating them again would duplicate startup work.
        if (
          previouslyVerified &&
          ticket === generation &&
          nextIdentity === previousIdentity &&
          currentOwner === previousOwner
        )
          void deps.client.invalidateQueries({
            queryKey: ["private", currentOwner],
            refetchType: "active",
          });
      })
      .catch((error: unknown) => {
        if (ticket !== generation) return;
        clearPrivateState();
        // An unavailable authorization service is not an anonymous session.
        publish({ session: undefined, owner: null, ready: true, error });
      })
      .finally(() => {
        if (pending === request) pending = undefined;
      });
    pending = request;
    return request;
  };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initialSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    invalidate,
    refresh,
    async signOut() {
      invalidate();
      try {
        await deps.signOut();
        invalidate(true);
      } catch (error) {
        clearPrivateState();
        publish({ session: undefined, owner: null, ready: true, error });
        throw error;
      }
    },
  };
}

export type WebSessionController = ReturnType<typeof createWebSessionController>;
