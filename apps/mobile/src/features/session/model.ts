import { ApiError, errorMessage } from "@baro/api-client";
import type { AccountType, Provider, SessionScope } from "@baro/client-core";
import { type ConsentInput, consentInputSchema } from "@baro/contracts/consent";
import type { ClientSession, ConsentStatus } from "@baro/contracts/session";
import type { NativeLoginResult } from "../../platform/auth/login";

export interface SessionState {
  phase: "checking" | "anonymous" | "authorizing" | "consent" | "ready" | "error";
  session: ClientSession | null;
  role: AccountType;
  busy: boolean;
  consent: ConsentStatus | null;
  error: string | null;
  authPurpose?: "reauthenticate";
  reauthentication?: {
    providers: Provider[];
    verified: boolean;
    checking: boolean;
    error: string | null;
  };
}
export function createSessionModel(dependencies: {
  scope: SessionScope;
  readSession: () => Promise<ClientSession>;
  getConsent: () => Promise<ConsentStatus>;
  saveConsent: (input: ConsentInput) => Promise<unknown>;
  login: {
    start(
      provider: Provider,
      role: AccountType,
      purpose?: "reauthenticate",
    ): Promise<NativeLoginResult>;
    complete(raw: string): Promise<NativeLoginResult>;
    cancel(): Promise<void>;
  };
  ownsReturn: (raw: string) => Promise<boolean>;
  signOut: () => Promise<{ serverRevoked: boolean }>;
  openPolicy: (policy: "terms" | "privacy" | "ai") => Promise<void>;
  readReauthentication?: (ownerId: string) => Promise<{ providers: Provider[]; verified: boolean }>;
}) {
  let state: SessionState = {
    phase: "checking",
    session: null,
    role: "customer",
    busy: false,
    consent: null,
    error: null,
  };
  let version = 0;
  let paused = false;
  let loggingOut = false;
  let returnLookups = 0;
  let pendingReauthentication = false;
  const subscribers = new Set<() => void>();
  const publish = (next: SessionState) => {
    state = next;
    for (const listener of subscribers) listener();
  };
  const current = (captured: number) => captured === version;
  const ordinary = () => {
    const { reauthentication: _proof, authPurpose: _purpose, ...rest } = state;
    return rest;
  };
  async function loadReauthentication() {
    const ownerId = state.session?.user?.id;
    if (
      !ownerId ||
      !["ready", "consent"].includes(state.phase) ||
      state.reauthentication?.checking ||
      !dependencies.readReauthentication
    )
      return;
    const captured = version;
    publish({
      ...state,
      reauthentication: { providers: [], verified: false, checking: true, error: null },
    });
    try {
      const result = await dependencies.readReauthentication(ownerId);
      if (current(captured) && state.session?.user?.id === ownerId)
        publish({ ...state, reauthentication: { ...result, checking: false, error: null } });
    } catch (error) {
      if (!current(captured)) return;
      if (error instanceof ApiError && error.code === "UNAUTHENTICATED") {
        fail(captured, error);
        return;
      }
      publish({
        ...state,
        reauthentication: {
          providers: [],
          verified: false,
          checking: false,
          error: errorMessage(error),
        },
      });
    }
  }
  const fail = (captured: number, error: unknown) => {
    if (!current(captured)) return;
    dependencies.scope.transition(null);
    publish({
      ...ordinary(),
      phase: "error",
      session: null,
      consent: null,
      busy: false,
      error: errorMessage(error),
    });
  };
  const apply = async (session: ClientSession, captured: number) => {
    if (!current(captured)) return;
    if (paused) {
      publish({ ...state, phase: "checking", session: null, consent: null, busy: false });
      return;
    }
    const consent = session.user && session.needsConsent ? await dependencies.getConsent() : null;
    if (!current(captured)) return;
    if (paused) {
      publish({ ...state, phase: "checking", session: null, consent: null, busy: false });
      return;
    }
    dependencies.scope.transition(
      session.user
        ? `${session.user.id}:${session.user.accountType}:${session.needsConsent}`
        : null,
    );
    publish({
      ...ordinary(),
      session,
      consent,
      role: session.user?.accountType ?? state.role,
      busy: false,
      error: null,
      phase: !session.user ? "anonymous" : session.needsConsent ? "consent" : "ready",
    });
    if (pendingReauthentication && session.user) {
      pendingReauthentication = false;
      await loadReauthentication();
    }
  };
  const checking = (phase: "checking" | "authorizing", purpose?: "reauthenticate") =>
    publish({
      ...ordinary(),
      phase,
      busy: true,
      session: null,
      consent: null,
      error: null,
      ...(purpose ? { authPurpose: purpose } : {}),
    });
  async function refresh() {
    if (paused || state.busy || loggingOut || returnLookups) return;
    const captured = ++version;
    checking("checking");
    try {
      await apply(await dependencies.readSession(), captured);
    } catch (error) {
      fail(captured, error);
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    refresh,
    loadReauthentication,
    selectRole(role: AccountType) {
      if (state.busy || (state.phase !== "anonymous" && state.phase !== "error")) return;
      publish({ ...state, role });
    },
    async signIn(provider: Provider) {
      if (state.busy || loggingOut || returnLookups) return;
      const captured = ++version,
        role = state.role;
      pendingReauthentication = false;
      dependencies.scope.invalidate();
      checking("authorizing");
      try {
        const result = await dependencies.login.start(provider, role);
        if (!current(captured)) return;
        await apply(
          result.type === "verified" ? result.session : await dependencies.readSession(),
          captured,
        );
      } catch (error) {
        fail(captured, error);
      }
    },
    async reauthenticate(provider: Provider) {
      if (
        state.busy ||
        loggingOut ||
        returnLookups ||
        !state.session?.user ||
        !["ready", "consent"].includes(state.phase)
      )
        return;
      if (!state.reauthentication?.providers.includes(provider)) {
        publish({ ...state, error: "연결된 로그인 수단을 먼저 확인해 주세요." });
        return;
      }
      const role = state.session.user.accountType,
        captured = ++version;
      pendingReauthentication = false;
      dependencies.scope.invalidate();
      checking("authorizing", "reauthenticate");
      try {
        const result = await dependencies.login.start(provider, role, "reauthenticate");
        if (!current(captured)) return;
        pendingReauthentication = result.type === "verified" && Boolean(result.reauthentication);
        await apply(
          result.type === "verified" ? result.session : await dependencies.readSession(),
          captured,
        );
      } catch (error) {
        if (!current(captured)) return;
        try {
          await apply(await dependencies.readSession(), captured);
          if (current(captured)) publish({ ...state, error: errorMessage(error) });
        } catch (readError) {
          fail(captured, readError);
        }
      }
    },
    async receiveReturn(raw: string) {
      if (loggingOut) return;
      const observed = version;
      returnLookups++;
      try {
        if (!(await dependencies.ownsReturn(raw)) || !current(observed)) return;
      } catch (error) {
        fail(observed, error);
        return;
      } finally {
        returnLookups--;
      }
      const captured = ++version;
      dependencies.scope.invalidate();
      checking("authorizing");
      try {
        const result = await dependencies.login.complete(raw);
        if (!current(captured)) return;
        pendingReauthentication = result.type === "verified" && Boolean(result.reauthentication);
        await apply(
          result.type === "verified" ? result.session : await dependencies.readSession(),
          captured,
        );
      } catch (error) {
        fail(captured, error);
      }
    },
    async cancelLogin() {
      pendingReauthentication = false;
      const captured = ++version;
      checking("checking");
      try {
        await dependencies.login.cancel();
        await apply(await dependencies.readSession(), captured);
      } catch (error) {
        fail(captured, error);
      }
    },
    async acceptConsent(input: { policies: boolean; over14: boolean }) {
      if (state.phase !== "consent" || state.busy || !state.session?.user || !state.consent) return;
      const parsed = consentInputSchema.safeParse({
        ...state.consent.required,
        over14Confirmed: input.over14,
      });
      if (!input.policies || !parsed.success) {
        publish({
          ...state,
          error:
            input.policies && input.over14
              ? "현재 정책을 확인할 수 없어요. 앱 업데이트를 확인해 주세요."
              : "필수 정책과 만 14세 이상 여부를 확인해 주세요.",
        });
        return;
      }
      const captured = ++version,
        owner = state.session.user.id;
      publish({ ...state, busy: true, error: null });
      try {
        await dependencies.saveConsent(parsed.data);
        if (!current(captured)) return;
        const session = await dependencies.readSession();
        if (session.user?.id !== owner)
          throw new ApiError("UNAUTHENTICATED", "이용 계정을 다시 확인해 주세요.");
        await apply(session, captured);
      } catch (error) {
        fail(captured, error);
      }
    },
    async signOut() {
      if (state.busy) return;
      loggingOut = true;
      pendingReauthentication = false;
      const captured = ++version;
      dependencies.scope.invalidate();
      checking("checking");
      try {
        const result = await dependencies.signOut();
        if (!current(captured)) return;
        dependencies.scope.transition(null);
        publish({
          ...state,
          phase: "anonymous",
          session: null,
          consent: null,
          busy: false,
          error: result.serverRevoked
            ? null
            : "기기에서 로그아웃했어요. 서버 연결은 확인하지 못했어요.",
        });
      } catch (error) {
        fail(captured, error);
      } finally {
        loggingOut = false;
      }
    },
    async openPolicy(policy: "terms" | "privacy" | "ai") {
      const captured = version;
      try {
        await dependencies.openPolicy(policy);
      } catch {
        if (current(captured))
          publish({
            ...state,
            error: "정책 문서를 열지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
          });
      }
    },
    pause() {
      paused = true;
      // Private work was retired before authorization began. Backgrounding the
      // system browser must not abort its current cookie exchange or role IO.
      if (state.phase === "authorizing") return;
      dependencies.scope.invalidate();
      if (loggingOut || returnLookups) return;
      version++;
      publish({
        ...state,
        phase: "checking",
        busy: false,
        session: null,
        consent: null,
        error: null,
      });
    },
    resume() {
      paused = false;
      return refresh();
    },
  };
}
export type SessionModel = ReturnType<typeof createSessionModel>;
