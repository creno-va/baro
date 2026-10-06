import type { ConsentInput } from "../../contracts/consent";
import { authClient } from "../auth";
import { ApiError, apiMode, request } from "./core";
import type { AccountType, Provider, SessionView } from "./types";
import "./mock/session";
export const roleStart = (session: SessionView) =>
  session.needsConsent ? "/consent" : session.user?.accountType === "lawyer" ? "/lawyer" : "/";
/** Non-sensitive invalidation only; never share a session, role or token across tabs. */
export function notifySessionChanged() {
  try {
    localStorage.setItem("baro-session-changed", crypto.randomUUID());
  } catch {
    // Session operations remain usable when optional cross-tab storage is disabled.
  }
  window.dispatchEvent(new Event("baro-session-changed"));
}
export const sessionApi = {
  async get(): Promise<SessionView> {
    const session = await request<SessionView>("session.get", undefined, {
      path: "/api/me/session",
    });
    if (apiMode === "real" && session.user) {
      const selected = sessionStorage.getItem("baro-account-type");
      if (selected === "customer" || selected === "lawyer") {
        await request(
          "session.accountType",
          { accountType: selected },
          { path: "/api/me/account-type", method: "PUT", body: { accountType: selected } },
        );
        sessionStorage.removeItem("baro-account-type");
        session.user.accountType = selected;
        notifySessionChanged();
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
    sessionStorage.setItem("baro-account-type", accountType);
    const result = await authClient.signIn
      .social({
        provider,
        callbackURL: "/consent",
        errorCallbackURL: "/login?error=oauth",
      })
      .catch(() => {
        throw new ApiError("UNAVAILABLE", "로그인을 시작하지 못했어요. 다시 시도해 주세요.", true);
      });
    if (result.error)
      throw new ApiError("UNAVAILABLE", "로그인을 시작하지 못했어요. 다시 시도해 주세요.", true);
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
    notifySessionChanged();
  },
};
