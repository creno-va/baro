import { CURRENT_POLICY_VERSIONS, consentInputSchema } from "../../../contracts/consent";
import { ApiError } from "../errors";
import type { AccountType, SessionView } from "../types";
import { readStore, registerMockHandlers, writeStore } from "./runtime";

const empty: SessionView = { user: null, needsConsent: false };
registerMockHandlers({
  "session.get": () => readStore("session", empty),
  "session.signIn": ({ accountType }: { accountType: AccountType }) => {
    if (accountType !== "customer" && accountType !== "lawyer")
      throw new ApiError("VALIDATION_ERROR", "이용 유형을 선택해 주세요.");
    const id = `example-${accountType}`,
      consent = readStore<Record<string, unknown>>("consents", {});
    const session: SessionView = {
      user: { id, name: accountType === "customer" ? "예시 고객" : "예시 변호사", accountType },
      needsConsent: !consent[id],
    };
    writeStore("session", session);
    return session;
  },
  "session.getConsent": () => {
    const session = readStore("session", empty);
    if (!session.user) throw new ApiError("UNAUTHENTICATED", "로그인이 필요해요.");
    return {
      required: CURRENT_POLICY_VERSIONS,
      consent: readStore<Record<string, unknown>>("consents", {})[session.user.id] ?? null,
      needsConsent: session.needsConsent,
    };
  },
  "session.saveConsent": (input) => {
    const parsed = consentInputSchema.safeParse(input);
    if (!parsed.success)
      throw new ApiError("VALIDATION_ERROR", "필수 동의와 만 14세 이상 여부를 확인해 주세요.");
    const session = readStore("session", empty);
    if (!session.user) throw new ApiError("UNAUTHENTICATED", "로그인이 필요해요.");
    const consent = readStore<Record<string, unknown>>("consents", {});
    consent[session.user.id] = parsed.data;
    writeStore("consents", consent);
    session.needsConsent = false;
    writeStore("session", session);
    return session;
  },
  "session.signOut": () => {
    writeStore("session", empty);
    return empty;
  },
});
