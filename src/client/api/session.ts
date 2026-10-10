import type { ConsentInput } from "../../contracts/consent";
import { authClient } from "../auth";
import { accessHref, returnPathFromLocation } from "../return-path";
import { notifySessionChanged } from "../session-events";

import { ApiError, apiMode, request } from "./core";
import type { AccountType, Provider, SessionView } from "./types";

export { notifySessionChanged } from "../session-events";

export const roleStart = (session: SessionView) =>
  !session.user
    ? "/login"
    : session.needsConsent
      ? "/consent"
      : session.user.accountType === "lawyer"
        ? "/lawyer"
        : "/app";
let pendingSelection: { attempt: string; ownerId: string; promise: Promise<unknown> } | undefined;
export const sessionApi = {
  async get(): Promise<SessionView> {
    const session = await request<SessionView>("session.get", undefined, {
      path: "/api/me/session",
    });
    if (apiMode === "real" && typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const raw = sessionStorage.getItem("baro-account-type");
      let selected: { accountType?: unknown; attempt?: unknown; createdAt?: unknown } | null = null;
      try {
        selected = raw ? JSON.parse(raw) : null;
      } catch {
        sessionStorage.removeItem("baro-account-type");
      }
      if (params.get("error") === "oauth") sessionStorage.removeItem("baro-account-type");
      else if (
        session.user &&
        window.location.pathname === "/consent" &&
        selected &&
        (selected.accountType === "customer" || selected.accountType === "lawyer") &&
        typeof selected.attempt === "string" &&
        selected.attempt === params.get("loginAttempt") &&
        typeof selected.createdAt === "number" &&
        Date.now() - selected.createdAt >= 0 &&
        Date.now() - selected.createdAt < 10 * 60_000
      ) {
        const accountType = selected.accountType;
        const attempt = selected.attempt;
        const ownerId = session.user.id;
        if (pendingSelection?.attempt !== attempt || pendingSelection.ownerId !== ownerId) {
          pendingSelection = {
            attempt,
            ownerId,
            promise: request(
              "session.accountType",
              { accountType },
              {
                path: "/api/me/account-type",
                method: "PUT",
                body: { accountType },
              },
            )
              .then((value) => {
                if (sessionStorage.getItem("baro-account-type") === raw)
                  sessionStorage.removeItem("baro-account-type");
                notifySessionChanged();
                return value;
              })
              .catch((error: unknown) => {
                pendingSelection = undefined;
                throw error;
              }),
          };
        }
        await pendingSelection.promise;
        session.user.accountType = accountType;
      }
    }
    return session;
  },
  async signIn(provider: Provider, accountType: AccountType): Promise<SessionView | undefined> {
    if (apiMode === "mock") {
      const session = await request<SessionView>("session.signIn", { provider, accountType });
      notifySessionChanged();
      return session;
    }
    pendingSelection = undefined;
    const attempt = crypto.randomUUID();
    sessionStorage.setItem(
      "baro-account-type",
      JSON.stringify({ accountType, attempt, createdAt: Date.now() }),
    );
    const callback = new URL(
      accessHref("consent", returnPathFromLocation() ?? undefined),
      window.location.origin,
    );
    callback.searchParams.set("loginAttempt", attempt);
    const result = await authClient.signIn
      .social({
        provider,
        callbackURL: `${callback.pathname}${callback.search}`,
        errorCallbackURL: accessHref("login", returnPathFromLocation() ?? undefined, "oauth"),
      })
      .catch(() => {
        sessionStorage.removeItem("baro-account-type");
        throw new ApiError("UNAVAILABLE", "로그인을 시작하지 못했어요. 다시 시도해 주세요.", true);
      });
    if (result.error) {
      sessionStorage.removeItem("baro-account-type");
      throw new ApiError("UNAVAILABLE", "로그인을 시작하지 못했어요. 다시 시도해 주세요.", true);
    }
    return undefined;
  },
  getConsent: () =>
    request<{ required: ConsentInput; consent: unknown; needsConsent: boolean }>(
      "session.getConsent",
      undefined,
      { path: "/api/me/consent" },
    ),
  async saveConsent(input: ConsentInput): Promise<SessionView> {
    if (apiMode === "mock") {
      const session = await request<SessionView>("session.saveConsent", input);
      notifySessionChanged();
      return session;
    }
    await request("session.saveConsent", input, {
      path: "/api/me/consent",
      method: "PUT",
      body: input,
    });
    const session = await sessionApi.get();
    notifySessionChanged();
    return session;
  },
  async signOut() {
    if (apiMode === "mock") await request("session.signOut");
    else {
      const result = await authClient.signOut();
      if (result.error)
        throw new ApiError("UNAVAILABLE", "로그아웃하지 못했어요. 다시 시도해 주세요.", true);
    }
    notifySessionChanged("signout");
  },
};
