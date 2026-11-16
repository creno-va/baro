import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

function accessWasRevoked(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return error.code === "UNAUTHENTICATED" || error.code === "CONSENT_REQUIRED";
}

/** Create one client for each mounted application, including each SSR request. */
export function createWebQueryClient(onAccessFailure?: () => void) {
  const onError = (error: unknown) => {
    if (accessWasRevoked(error)) onAccessFailure?.();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        retry: false,
        // The session provider checks permission before exposing private views again.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchIntervalInBackground: false,
      },
      mutations: { retry: false },
    },
  });
}

// `owner` is the provider's opaque owner + generation identity, not an API header.
const privateKey = (owner: string | null, resource: string, id?: string) =>
  id === undefined
    ? (["private", owner, resource] as const)
    : (["private", owner, resource, id] as const);

export const queryKeys = {
  cases: (owner: string | null) => privateKey(owner, "cases"),
  case: (owner: string | null, id: string) => privateKey(owner, "case", id),
  workspace: (owner: string | null, id: string) => privateKey(owner, "workspace", id),
  files: (owner: string | null, id: string) => privateKey(owner, "files", id),
  report: (owner: string | null, id: string) => privateKey(owner, "report", id),
  conversation: (owner: string | null, id: string) => privateKey(owner, "conversation", id),
  progress: (owner: string | null, id: string) => privateKey(owner, "progress", id),
};
