import { type SyntheticEvent, useEffect, useRef, useState } from "react";
import { api, apiMode } from "../../client/api";
import { ApiError } from "../../client/api/errors";
import { accessHref, returnPathFromLocation, sessionDestination } from "../../client/return-path";
import { CURRENT_POLICY_VERSIONS } from "../../contracts/consent";

type ConsentState = "loading" | "required" | "redirecting";
export function useConsentController() {
  const [state, setState] = useState<ConsentState>("loading");
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (error && !submitting) submitButton.current?.focus();
  }, [error, submitting]);

  useEffect(() => {
    let active = true;
    api.session
      .get()
      .then(async (session) => {
        if (!active) return;
        if (!session.user) {
          window.location.replace(
            accessHref("login", returnPathFromLocation() ?? undefined, "session_expired"),
          );
          return;
        }
        const consent = await api.session.getConsent();
        if (!active) return;
        if (!consent.needsConsent) {
          setState("redirecting");
          window.location.replace(sessionDestination({ ...session, needsConsent: false }));
          return;
        }
        setState("required");
      })
      .catch((failure) => {
        if (!active) return;
        if (failure instanceof ApiError && failure.code === "UNAUTHENTICATED") {
          window.location.replace(
            accessHref("login", returnPathFromLocation() ?? undefined, "session_expired"),
          );
          return;
        }
        setError("동의 상태를 불러오지 못했어요. 다시 불러와 주세요.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accepted) return;

    setSubmitting(true);
    setError(null);

    try {
      const session = await api.session.saveConsent({
        ...CURRENT_POLICY_VERSIONS,
      });
      if (!session.user || session.needsConsent) {
        setError("동의 저장 상태를 확인하지 못했어요. 다시 시도해 주세요.");
        setSubmitting(false);
        return;
      }
      setState("redirecting");
      window.location.replace(sessionDestination(session));
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "UNAUTHENTICATED") {
        window.location.replace(
          accessHref("login", returnPathFromLocation() ?? undefined, "session_expired"),
        );
        return;
      }
      setError("동의를 저장하지 못했어요. 다시 시도해 주세요.");
      setSubmitting(false);
      return;
    }
  }

  return {
    state,
    accepted,
    submitting,
    error,
    submitButton,
    setAccepted,
    submit,
    mock: apiMode === "mock",
  };
}
export type ConsentController = ReturnType<typeof useConsentController>;
