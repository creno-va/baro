import { type SyntheticEvent, useEffect, useRef, useState } from "react";
import { api, apiMode } from "../client/api";
import { ApiError } from "../client/api/errors";
import { accessHref, returnPathFromLocation, sessionDestination } from "../client/return-path";
import { CURRENT_POLICY_VERSIONS } from "../contracts/consent";

type ConsentState = "loading" | "required" | "redirecting";

export function ConsentForm() {
  const [state, setState] = useState<ConsentState>("loading");
  const [accepted, setAccepted] = useState(false);
  const [over14, setOver14] = useState(false);
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
    if (!accepted || !over14) return;

    setSubmitting(true);
    setError(null);

    try {
      const session = await api.session.saveConsent({
        ...CURRENT_POLICY_VERSIONS,
        over14Confirmed: true,
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

  if (state === "loading") {
    return error ? (
      <div className="consent-status">
        <h1>이용 상태를 확인할 수 없어요</h1>
        <p className="form-error" role="alert">
          {error}
        </p>
        <button className="primary-action" type="button" onClick={() => window.location.reload()}>
          다시 불러오기
        </button>
      </div>
    ) : (
      <p className="consent-status" role="status">
        이용 상태를 확인하고 있어요.
      </p>
    );
  }

  if (state === "redirecting") {
    return (
      <p className="consent-status" role="status">
        내 화면으로 이동하고 있어요.
      </p>
    );
  }

  return (
    <section className="consent-content" aria-labelledby="consent-title">
      <header className="consent-intro">
        <p className="eyebrow">서비스 이용을 위한 필수 확인</p>
        <h1 id="consent-title">
          시작 전에 <br />
          확인해 주세요
        </h1>
        <p>
          서비스 정책과 이용 연령을 확인해 주세요.
          <br />
          동의를 마치면 이용하던 화면으로 이어집니다.
        </p>
      </header>
      <form className="consent-form" onSubmit={submit} aria-busy={submitting}>
        {apiMode === "mock" && <p className="case-muted">API 예시 모드 · 합성 동의 기록입니다.</p>}
        <label>
          <input
            checked={accepted}
            disabled={submitting}
            onChange={(event) => setAccepted(event.currentTarget.checked)}
            type="checkbox"
          />
          <span>
            <strong>[필수] 서비스 정책 동의</strong>
            <span className="consent-description">
              이용약관, 개인정보 처리방침, AI 이용 고지를 확인하고 동의합니다.
            </span>
          </span>
        </label>
        <label>
          <input
            checked={over14}
            disabled={submitting}
            onChange={(event) => setOver14(event.currentTarget.checked)}
            type="checkbox"
          />
          <span>
            <strong>[필수] 만 14세 이상입니다.</strong>
            <span className="consent-description">생년월일은 수집하지 않아요.</span>
          </span>
        </label>
        <nav className="consent-policy-links" aria-label="정책 원문">
          <a href="/policies/terms" target="_blank" rel="noopener noreferrer">
            이용약관<span className="sr-only"> (새 창)</span>
          </a>
          <a href="/policies/privacy" target="_blank" rel="noopener noreferrer">
            개인정보 처리방침<span className="sr-only"> (새 창)</span>
          </a>
          <a href="/policies/ai" target="_blank" rel="noopener noreferrer">
            AI 이용 고지<span className="sr-only"> (새 창)</span>
          </a>
        </nav>
        <button
          className="primary-action"
          ref={submitButton}
          disabled={!accepted || !over14 || submitting}
          type="submit"
        >
          {submitting ? "저장 중…" : "동의하고 계속하기"}
        </button>
        <a
          href={accessHref("login", returnPathFromLocation() ?? undefined)}
          className="consent-cancel"
        >
          취소하고 돌아가기
        </a>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
