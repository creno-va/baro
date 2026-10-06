import type { ConsentInput } from "../../contracts/consent";
import { authClient } from "../auth";
import { ApiError, apiMode, request } from "./core";
import type { AccountType, Provider, SessionView } from "./types";
import "./mock/session";
export const roleStart = (session: SessionView) =>
  session.needsConsent ? "/consent" : session.user?.accountType === "lawyer" ? "/lawyer" : "/cases";
export const sessionApi = {
  async get(): Promise<SessionView> {
    return request("session.get", undefined, { path: "/api/me/session" });
  },
  async signIn(provider: Provider, accountType: AccountType): Promise<SessionView | undefined> {
    if (apiMode === "mock") return request("session.signIn", { provider, accountType });
    sessionStorage.setItem("baro-account-type", accountType);
    const result = await authClient.signIn.social({
      provider,
      callbackURL: "/consent",
      errorCallbackURL: "/login?error=oauth",
    });
    if (result.error)
      throw new ApiError("UNAVAILABLE", "로그인을 시작하지 못했어요. 다시 시도해 주세요.", true);
  },
  getConsent: () =>
    request<{ required: ConsentInput; consent: unknown; needsConsent: boolean }>(
      "session.getConsent",
      undefined,
      { path: "/api/me/consent" },
    ),
  async saveConsent(input: ConsentInput): Promise<SessionView> {
    if (apiMode === "mock") return request("session.saveConsent", input);
    await request("session.saveConsent", input, {
      path: "/api/me/consent",
      method: "PUT",
      body: input,
    });
    return sessionApi.get();
  },
  async signOut() {
    if (apiMode === "mock") await request("session.signOut");
    else {
      const result = await authClient.signOut();
      if (result.error)
        throw new ApiError("UNAVAILABLE", "로그아웃하지 못했어요. 다시 시도해 주세요.", true);
    }
  },
};
