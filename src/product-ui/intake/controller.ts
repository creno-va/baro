import { ApiError } from "../../client/api/errors";
import type { SessionView } from "../../client/api/types";
import { sessionDestination } from "../../client/return-path";
import { isExplicitSignOut } from "../../client/session-events";

export type CasePurpose = "prepare_claim" | "respond_to_claim";

// This is a web entry requirement, not a change to saved or native narratives.
export const APP_NARRATIVE_MIN_LENGTH = 10;
export const APP_NARRATIVE_MAX_LENGTH = 5000;

export function narrativeLength(narrative: string) {
  return [...narrative.trim()].length;
}

export function narrativeLengthError(narrative: string) {
  const count = narrativeLength(narrative);
  if (count < APP_NARRATIVE_MIN_LENGTH)
    return `어떤 일이 있었는지 ${APP_NARRATIVE_MIN_LENGTH}자 이상 적어주세요. 짧게 시작하고 나중에 보완해도 괜찮아요.`;
  if (count > APP_NARRATIVE_MAX_LENGTH)
    return "이야기는 5,000자까지 적을 수 있어요. 내용을 조금 줄여주세요.";
  return "";
}

export type CaseInputState = {
  session: SessionView | null;
  loading: boolean;
  sessionError: unknown;
  narrative: string;
  casePurpose: CasePurpose;
  busy: boolean;
  error: unknown;
  created: string | null;
  lengthError: string;
};

type ControllerPorts = {
  getSession: () => Promise<SessionView>;
  createCase: (
    input: { narrative: string; subjectContext: "individual"; casePurpose: CasePurpose },
    options: { expectedOwner: string },
  ) => Promise<{ id: string }>;
  requireSession: () => boolean;
  pathname: () => string;
  replace: (href: string) => void;
  assign: (href: string) => void;
};

/** Transient state belongs to one composer. Nothing is persisted or placed in
 * the shared UI-preferences store. Tickets fence late session/create results. */
export function createCaseInputController(ports: ControllerPorts) {
  let state: CaseInputState = {
    session: null,
    loading: true,
    sessionError: null,
    narrative: "",
    casePurpose: "prepare_claim",
    busy: false,
    error: null,
    created: null,
    lengthError: "",
  };
  const listeners = new Set<() => void>();
  let pending = false;
  let identity: string | undefined;
  let sessionRequest = 0;
  let operation = 0;
  let mounted = false;
  let signedOut = false;

  const update = (next: Partial<CaseInputState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  function clearDraft() {
    ++operation;
    pending = false;
    update({
      busy: false,
      narrative: "",
      casePurpose: "prepare_claim",
      created: null,
      error: null,
      lengthError: "",
    });
  }

  async function loadSession() {
    if (signedOut) return null;
    const ticket = ++sessionRequest;
    const current = () => mounted && !signedOut && ticket === sessionRequest;
    update({ loading: true, sessionError: null });
    const accept = (next: SessionView) => {
      if (!current()) return null;
      const nextIdentity = JSON.stringify([
        next.user?.id ?? null,
        next.user?.accountType ?? null,
        next.needsConsent,
      ]);
      if (identity !== undefined && identity !== nextIdentity) clearDraft();
      identity = nextIdentity;
      update({ session: next });
      if (ports.requireSession() && (!next.user || next.needsConsent)) {
        ports.replace(sessionDestination(next, ports.pathname()));
      }
      return next;
    };
    try {
      return accept(await ports.getSession());
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "UNAUTHENTICATED")
        return accept({ user: null, needsConsent: false });
      if (current()) update({ sessionError: cause });
      return null;
    } finally {
      if (current()) update({ loading: false });
    }
  }

  async function create() {
    const { session, loading, sessionError, created, narrative, casePurpose } = state;
    if (!session?.user || session.needsConsent || loading || sessionError || pending || created)
      return;
    const lengthError = narrativeLengthError(narrative);
    if (lengthError) {
      update({ lengthError });
      return;
    }
    const ticket = ++operation;
    const current = () => mounted && ticket === operation;
    pending = true;
    update({ busy: true, error: null });
    try {
      const fresh = await loadSession();
      if (!current() || !fresh?.user || fresh.needsConsent) return;
      const item = await ports.createCase(
        {
          narrative: narrative.trim(),
          // Preserve the installed-client compatibility field, not an owner classification.
          subjectContext: "individual",
          casePurpose,
        },
        { expectedOwner: fresh.user.id },
      );
      await loadSession();
      if (!current()) return;
      update({ created: item.id });
      ports.assign(`/cases/${encodeURIComponent(item.id)}/intake`);
    } catch (cause) {
      if (current()) update({ error: cause });
    } finally {
      if (current()) {
        update({ busy: false });
        pending = false;
      }
    }
  }

  function sessionChanged(event: Event) {
    if (!isExplicitSignOut(event)) {
      void loadSession();
      return;
    }
    signedOut = ports.requireSession();
    ++sessionRequest;
    clearDraft();
    identity = JSON.stringify([null, null, false]);
    update({
      session: { user: null, needsConsent: false },
      loading: false,
      sessionError: null,
    });
    // The same-tab menu owns navigation; peer tabs need their own redirect.
    if (ports.requireSession() && event.type === "storage") ports.replace("/login");
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    connect: () => {
      mounted = true;
      signedOut = false;
    },
    disconnect: () => {
      mounted = false;
      ++sessionRequest;
      ++operation;
    },
    loadSession,
    create,
    sessionChanged,
    setNarrative: (narrative: string) => update({ narrative }),
    setCasePurpose: (casePurpose: CasePurpose) => update({ casePurpose }),
    dismissLengthError: () => update({ lengthError: "" }),
  };
}
